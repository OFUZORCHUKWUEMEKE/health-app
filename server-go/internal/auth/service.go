package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/mrn"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// OTP rules mirror auth.service.ts constants.
const (
	otpExpiryMinutes   = 10
	otpCooldownSeconds = 60
	otpMaxAttempts     = 5
	otpMaxResendsHour  = 3
)

// Error is a status-coded service failure. The HTTP layer maps it straight
// into the standard envelope (codes 004/006/009/011, 409 default).
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

func BadRequest(msg string) *Error   { return &Error{Status: 400, Message: msg} }
func Unauthorized(msg string) *Error { return &Error{Status: 401, Message: msg} }
func Forbidden(msg string) *Error    { return &Error{Status: 403, Message: msg} }
func NotFound(msg string) *Error     { return &Error{Status: 404, Message: msg} }
func Conflict(msg string) *Error     { return &Error{Status: 409, Message: msg} }

// Service implements the auth flows (ports auth.service.ts). It is pure
// business logic over sqlc queries; HTTP mapping lives in http.go.
type Service struct {
	DB          *postgres.Pool
	Issuer      *Issuer
	Mail        mail.Sender
	Copy        mail.Copy
	FrontendURL string
	IncludeOTP  bool
	Google      GoogleConfig
	// Expiration labels echoed in verify responses
	// (was REGISTRATION_TOKEN_EXPIRATION || '15m').
	RegExpLabel   string
	ResetExpLabel string
}

// GoogleConfig for patient OAuth.
type GoogleConfig struct {
	ClientID, ClientSecret, CallbackURL string
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

func lower(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func text(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

func isNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// --- OTP plumbing -----------------------------------------------------------

// OTPResult is the initiate/resend response payload.
type OTPResult struct {
	Message          string `json:"message"`
	Email            string `json:"email"`
	ExpiresInMinutes int    `json:"expires_in_minutes"`
	CooldownSeconds  int    `json:"cooldown_seconds"`
	OTP              string `json:"otp,omitempty"`
}

func (s *Service) newOTP() (otp, hash string, expires time.Time, err error) {
	otp, err = GenerateOTP()
	if err != nil {
		return "", "", time.Time{}, err
	}
	hash, err = HashOTP(otp)
	if err != nil {
		return "", "", time.Time{}, err
	}
	return otp, hash, time.Now().Add(otpExpiryMinutes * time.Minute), nil
}

// resendMeta computes the hourly rate-limit counters (was computeResendMeta).
// Returns resend_count for the new row and whether the caller is over limit.
func resendMeta(now time.Time, existing bool, count int32, window pgtype.Timestamptz) (int32, pgtype.Timestamptz) {
	if !existing || !window.Valid || now.Sub(window.Time) > time.Hour {
		return 1, ts(now)
	}
	return count + 1, window
}

func (s *Service) otpResult(email, message, otp string) OTPResult {
	r := OTPResult{
		Message: message, Email: email,
		ExpiresInMinutes: otpExpiryMinutes, CooldownSeconds: otpCooldownSeconds,
	}
	if s.IncludeOTP {
		r.OTP = otp
	}
	return r
}

func (s *Service) sendMail(to, subject, html string) {
	if err := s.Mail.Send(context.Background(), to, subject, html); err != nil {
		// Sending never fails the request (M7 deviation, documented).
		_ = err
	}
}

// --- patient registration ---------------------------------------------------

// InitiateRegistration starts OTP registration (no cooldown check, hourly
// rate-limit only — matching Nest).
func (s *Service) InitiateRegistration(ctx context.Context, email string) (OTPResult, error) {
	email = lower(email)
	if _, err := s.q().GetPatientByEmail(ctx, email); err == nil {
		return OTPResult{}, Conflict("User already exists")
	} else if !isNotFound(err) {
		return OTPResult{}, err
	}
	otp, hash, expires, err := s.newOTP()
	if err != nil {
		return OTPResult{}, err
	}
	var existing bool
	var count int32
	var window pgtype.Timestamptz
	if row, err := s.q().GetPendingRegistration(ctx, email); err == nil {
		existing, count, window = true, row.ResendCount, row.ResendWindowStartedAt
	} else if !isNotFound(err) {
		return OTPResult{}, err
	}
	now := time.Now()
	newCount, newWindow := resendMeta(now, existing, count, window)
	if newCount > otpMaxResendsHour {
		return OTPResult{}, BadRequest("Too many OTP requests. Try again later.")
	}
	_, err = s.q().UpsertPendingRegistration(ctx, gen.UpsertPendingRegistrationParams{
		Email: email, OtpHash: hash, OtpExpiresAt: ts(expires),
		AttemptCount: 0, ResendCount: newCount, ResendWindowStartedAt: newWindow,
		CooldownUntil: ts(now.Add(otpCooldownSeconds * time.Second)),
		Verified:      false, VerifiedAt: pgtype.Timestamptz{},
		RegistrationTokenJti: pgtype.Text{},
	})
	if err != nil {
		return OTPResult{}, err
	}
	subject, body := s.Copy.RegistrationOTP()
	s.sendMail(email, subject, body(otp, otpExpiryMinutes))
	return s.otpResult(email, "OTP sent to your email.", otp), nil
}

// ResendRegistrationOTP enforces the 60s cooldown on top of the hourly limit.
func (s *Service) ResendRegistrationOTP(ctx context.Context, email string) (OTPResult, error) {
	email = lower(email)
	row, err := s.q().GetPendingRegistration(ctx, email)
	if err != nil {
		if isNotFound(err) {
			return OTPResult{}, NotFound("No pending registration for this email. Initiate registration first.")
		}
		return OTPResult{}, err
	}
	now := time.Now()
	if row.CooldownUntil.Valid && row.CooldownUntil.Time.After(now) {
		return OTPResult{}, BadRequest("Please wait before requesting another OTP.")
	}
	otp, hash, expires, err := s.newOTP()
	if err != nil {
		return OTPResult{}, err
	}
	newCount, newWindow := resendMeta(now, true, row.ResendCount, row.ResendWindowStartedAt)
	if newCount > otpMaxResendsHour {
		return OTPResult{}, BadRequest("Too many OTP requests. Try again later.")
	}
	_, err = s.q().UpsertPendingRegistration(ctx, gen.UpsertPendingRegistrationParams{
		Email: email, OtpHash: hash, OtpExpiresAt: ts(expires),
		AttemptCount: 0, ResendCount: newCount, ResendWindowStartedAt: newWindow,
		CooldownUntil: ts(now.Add(otpCooldownSeconds * time.Second)),
		Verified:      false, VerifiedAt: pgtype.Timestamptz{},
		RegistrationTokenJti: pgtype.Text{},
	})
	if err != nil {
		return OTPResult{}, err
	}
	subject, body := s.Copy.RegistrationOTP()
	s.sendMail(email, subject, body(otp, otpExpiryMinutes))
	return s.otpResult(email, "OTP resent to your email.", otp), nil
}

// VerifyRegistrationOTP checks the OTP and returns the registration token.
func (s *Service) VerifyRegistrationOTP(ctx context.Context, email, otp string) (map[string]any, error) {
	email = lower(email)
	row, err := s.q().GetPendingRegistration(ctx, email)
	if err != nil {
		if isNotFound(err) {
			return nil, NotFound("No pending registration for this email.")
		}
		return nil, err
	}
	if row.OtpExpiresAt.Time.Before(time.Now()) {
		return nil, BadRequest("OTP has expired. Request a new one.")
	}
	if row.AttemptCount >= otpMaxAttempts {
		return nil, Forbidden("Too many invalid OTP attempts. Request a new OTP.")
	}
	if !CompareOTP(otp, row.OtpHash) {
		_ = s.q().BumpRegistrationAttempts(ctx, email)
		return nil, Unauthorized("Invalid or expired OTP")
	}
	token, jti, err := s.Issuer.GenerateRegistration(email)
	if err != nil {
		return nil, err
	}
	if err := s.q().MarkRegistrationVerified(ctx, gen.MarkRegistrationVerifiedParams{
		Email: email, RegistrationTokenJti: text(jti),
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"message":            "OTP verified successfully",
		"registration_token": token,
		"expires_in":         s.RegExpiresIn(),
	}, nil
}

// CompleteRegistration creates the patient (verified=true) and deletes the
// pending row (single use). Mirrors buildPatientCreatePayload.
func (s *Service) CompleteRegistration(ctx context.Context, token, first, last, middle, phone, password string) (map[string]any, error) {
	claims, err := s.Issuer.VerifyRegistration(token)
	if err != nil {
		return nil, Unauthorized("Invalid or expired registration token")
	}
	email := lower(claims.Email)
	if _, err := s.q().GetPatientByEmail(ctx, email); err == nil {
		return nil, Conflict("User already exists")
	} else if !isNotFound(err) {
		return nil, err
	}
	pending, err := s.q().GetPendingRegistration(ctx, email)
	if err != nil || !pending.Verified || !pending.RegistrationTokenJti.Valid ||
		pending.RegistrationTokenJti.String != claims.ID {
		return nil, Unauthorized("Registration verification is required")
	}
	out, err := s.createPatient(ctx, email, first, last, middle, phone, password, "", true, RolePatient)
	if err != nil {
		return nil, err
	}
	// Single use: consume the pending row (was delete pending).
	_ = s.q().DeletePendingRegistration(ctx, email)
	return out, nil
}

// PatientSignup is the direct (no-OTP) signup, verified=false.
func (s *Service) PatientSignup(ctx context.Context, first, last, middle, email, password string) (map[string]any, error) {
	email = lower(email)
	if _, err := s.q().GetPatientByEmail(ctx, email); err == nil {
		return nil, Conflict("User already exists")
	} else if !isNotFound(err) {
		return nil, err
	}
	out, err := s.createPatient(ctx, email, first, last, middle, "", password, "", false, RolePatient)
	if err != nil {
		return nil, err
	}
	confirmURL := s.FrontendURL + "/auth/confirm-email/pending"
	subject, body := s.Copy.EmailConfirmation(confirmURL)
	s.sendMail(email, subject, body)
	return out, nil
}

// createPatient allocates identifiers (with collision retry — stricter than
// Nest, which never retried) and returns the Nest-shaped payload.
func (s *Service) createPatient(ctx context.Context, email, first, last, middle, phone, password, picture string, verified bool, _ string) (map[string]any, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	mrnValue, err := mrn.Generate(ctx, s.q(), "patient")
	if err != nil {
		return nil, err
	}
	var user gen.Patient
	for i := 0; i < 5; i++ {
		regNo, err := RegistrationNo()
		if err != nil {
			return nil, err
		}
		user, err = s.q().CreatePatient(ctx, gen.CreatePatientParams{
			RegistrationNo: regNo, Mrn: text(mrnValue),
			FirstName: first, LastName: last,
			MiddleName: text(middle), FullName: text(first + " " + last),
			Email: email, PhoneNumber: text(phone),
			PasswordHash: text(hash), Provider: "LOCAL", Verified: verified,
			ProfilePictureUrl: text(picture), RefreshTokenHash: pgtype.Text{},
		})
		if err == nil {
			break
		}
		if !isUniqueViolation(err) || i == 4 {
			return nil, errToConflict(err)
		}
	}
	mrn.Claim(ctx, s.q(), mrnValue, user.ID.String())
	access, refresh, err := s.mintSession(user.ID.String(), email, RolePatient)
	if err != nil {
		return nil, err
	}
	if err := s.q().SetPatientRefreshHash(ctx, gen.SetPatientRefreshHashParams{
		ID: user.ID, RefreshTokenHash: text(refresh.hash),
	}); err != nil {
		return nil, err
	}
	if verified {
		subject, body := s.Copy.Welcome(RolePatient)
		s.sendMail(email, subject, body(first))
	}
	return map[string]any{
		"user": patientJSON(user), "token": access,
		"refresh_token": refresh.token, "role": RolePatient,
	}, nil
}

func errToConflict(err error) error {
	if isUniqueViolation(err) {
		return Conflict("User already exists")
	}
	return err
}

// --- login / refresh / logout -----------------------------------------------

// Login verifies credentials per role and rotates in a fresh refresh hash.
// Response keys preserve Nest verbatim: user|doctor|admin + token +
// refresh_token + role. Inactive doctors are rejected here and in middleware.
func (s *Service) Login(ctx context.Context, role, email, password string) (map[string]any, error) {
	email = lower(email)
	switch role {
	case RolePatient:
		user, err := s.q().GetPatientByEmail(ctx, email)
		if err != nil || !user.PasswordHash.Valid || !ComparePassword(password, user.PasswordHash.String) {
			return nil, Unauthorized("Invalid email or password")
		}
		return s.patientSession(ctx, user)
	case RoleDoctor:
		doc, err := s.q().GetDoctorByEmail(ctx, email)
		if err != nil || !ComparePassword(password, doc.PasswordHash) {
			return nil, Unauthorized("Invalid email or password")
		}
		if !doc.Active {
			return nil, Unauthorized("Doctor account is deactivated. Contact admin.")
		}
		return s.doctorSession(ctx, doc)
	case RoleAdmin:
		admin, err := s.q().GetAdminByEmail(ctx, email)
		if err != nil || !ComparePassword(password, admin.PasswordHash) {
			return nil, Unauthorized("Invalid email or password")
		}
		return s.adminSession(ctx, admin)
	default:
		return nil, BadRequest("Invalid role")
	}
}

type session struct {
	access string
	token  string
	hash   string
}

func (s *Service) mintSession(userID, email, role string) (access string, refresh session, err error) {
	access, err = s.Issuer.GenerateAccess(userID, email, role)
	if err != nil {
		return "", session{}, err
	}
	rt, err := s.Issuer.GenerateRefresh(userID, email, role)
	if err != nil {
		return "", session{}, err
	}
	hash, err := HashToken(rt)
	if err != nil {
		return "", session{}, err
	}
	return access, session{token: rt, hash: hash}, nil
}

func (s *Service) patientSession(ctx context.Context, user gen.Patient) (map[string]any, error) {
	access, refresh, err := s.mintSession(user.ID.String(), user.Email, RolePatient)
	if err != nil {
		return nil, err
	}
	if err := s.q().SetPatientRefreshHash(ctx, gen.SetPatientRefreshHashParams{
		ID: user.ID, RefreshTokenHash: text(refresh.hash),
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"user": userReload(ctx, s, user.ID.String()), "token": access,
		"refresh_token": refresh.token, "role": RolePatient,
	}, nil
}
