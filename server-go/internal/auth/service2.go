package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/mrn"
)

// RegExpiresIn returns the configured registration-token TTL label
// (was REGISTRATION_TOKEN_EXPIRATION || '15m' in the verify response).
func (s *Service) RegExpiresIn() string {
	if s.RegExpLabel != "" {
		return s.RegExpLabel
	}
	return "15m"
}

// ResetExpiresIn mirrors RegExpiresIn for the forgot-password response.
func (s *Service) ResetExpiresIn() string {
	if s.ResetExpLabel != "" {
		return s.ResetExpLabel
	}
	return "15m"
}

func (s *Service) doctorSession(ctx context.Context, doc gen.Doctor) (map[string]any, error) {
	access, refresh, err := s.mintSession(doc.ID.String(), doc.Email, RoleDoctor)
	if err != nil {
		return nil, err
	}
	if err := s.q().SetDoctorRefreshHash(ctx, gen.SetDoctorRefreshHashParams{
		ID: doc.ID, RefreshTokenHash: text(refresh.hash),
	}); err != nil {
		return nil, err
	}
	fresh, err := s.q().GetDoctorByID(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"doctor": doctorJSON(fresh), "token": access,
		"refresh_token": refresh.token, "role": RoleDoctor,
	}, nil
}

func (s *Service) adminSession(ctx context.Context, admin gen.Admin) (map[string]any, error) {
	access, refresh, err := s.mintSession(admin.ID.String(), admin.Email, RoleAdmin)
	if err != nil {
		return nil, err
	}
	if err := s.q().SetAdminRefreshHash(ctx, gen.SetAdminRefreshHashParams{
		ID: admin.ID, RefreshTokenHash: text(refresh.hash),
	}); err != nil {
		return nil, err
	}
	fresh, err := s.q().GetAdminByID(ctx, admin.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"admin": adminJSON(fresh), "token": access,
		"refresh_token": refresh.token, "role": RoleAdmin,
	}, nil
}

func userReload(ctx context.Context, s *Service, id string) map[string]any {
	var uid pgtype.UUID
	if err := uid.Scan(id); err != nil {
		return map[string]any{}
	}
	user, err := s.q().GetPatientByID(ctx, uid)
	if err != nil {
		return map[string]any{}
	}
	return patientJSON(user)
}

// Refresh rotates a refresh token: verify → load by sub → require stored
// hash → compare → mint + overwrite (single slot, so the old token dies).
// Response keys are camelCase here, verbatim from Nest.
func (s *Service) Refresh(ctx context.Context, refreshToken, role string) (map[string]any, error) {
	claims, err := s.Issuer.VerifyRefresh(refreshToken)
	if err != nil {
		return nil, Forbidden("Invalid refresh token")
	}
	var id, email string
	var stored pgtype.Text
	switch role {
	case RolePatient:
		var uid pgtype.UUID
		if err := uid.Scan(claims.Subject); err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		user, err := s.q().GetPatientByID(ctx, uid)
		if err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		id, email, stored = user.ID.String(), user.Email, user.RefreshTokenHash
	case RoleDoctor:
		var uid pgtype.UUID
		if err := uid.Scan(claims.Subject); err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		doc, err := s.q().GetDoctorByID(ctx, uid)
		if err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		id, email, stored = doc.ID.String(), doc.Email, doc.RefreshTokenHash
	case RoleAdmin:
		var uid pgtype.UUID
		if err := uid.Scan(claims.Subject); err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		admin, err := s.q().GetAdminByID(ctx, uid)
		if err != nil {
			return nil, Forbidden("Invalid refresh token")
		}
		id, email, stored = admin.ID.String(), admin.Email, admin.RefreshTokenHash
	default:
		return nil, BadRequest("Invalid role")
	}
	if !stored.Valid || !CompareToken(refreshToken, stored.String) {
		return nil, Forbidden("Invalid refresh token")
	}
	access, refresh, err := s.mintSession(id, email, role)
	if err != nil {
		return nil, err
	}
	hash := text(refresh.hash)
	var uid pgtype.UUID
	_ = uid.Scan(id)
	switch role {
	case RolePatient:
		err = s.q().SetPatientRefreshHash(ctx, gen.SetPatientRefreshHashParams{ID: uid, RefreshTokenHash: hash})
	case RoleDoctor:
		err = s.q().SetDoctorRefreshHash(ctx, gen.SetDoctorRefreshHashParams{ID: uid, RefreshTokenHash: hash})
	case RoleAdmin:
		err = s.q().SetAdminRefreshHash(ctx, gen.SetAdminRefreshHashParams{ID: uid, RefreshTokenHash: hash})
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"accessToken": access, "refreshToken": refresh.token}, nil
}

// Logout nulls the stored refresh hash (sessions die); admins have a real
// slot now (M5 fix), so logout works uniformly.
func (s *Service) Logout(ctx context.Context, userID, role string) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(userID); err != nil {
		return nil, Unauthorized("Invalid token subject")
	}
	empty := pgtype.Text{}
	var err error
	switch role {
	case RolePatient:
		err = s.q().SetPatientRefreshHash(ctx, gen.SetPatientRefreshHashParams{ID: uid, RefreshTokenHash: empty})
	case RoleDoctor:
		err = s.q().SetDoctorRefreshHash(ctx, gen.SetDoctorRefreshHashParams{ID: uid, RefreshTokenHash: empty})
	case RoleAdmin:
		err = s.q().SetAdminRefreshHash(ctx, gen.SetAdminRefreshHashParams{ID: uid, RefreshTokenHash: empty})
	default:
		return nil, BadRequest("Invalid role")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"message": "Logged out successfully"}, nil
}

// ChangePassword enforces current-password check and difference rule
// (camelCase DTO, verbatim). It does not rotate refresh tokens (Nest parity).
func (s *Service) ChangePassword(ctx context.Context, userID, role, current, newPass, confirm string) (map[string]any, error) {
	if newPass != confirm {
		return nil, BadRequest("New passwords do not match")
	}
	if current == newPass {
		return nil, BadRequest("New password must be different from current password")
	}
	var uid pgtype.UUID
	if err := uid.Scan(userID); err != nil {
		return nil, Unauthorized("Invalid token subject")
	}
	var hash string
	var found bool
	switch role {
	case RolePatient:
		user, err := s.q().GetPatientByID(ctx, uid)
		if err == nil && user.PasswordHash.Valid {
			hash, found = user.PasswordHash.String, true
		}
	case RoleDoctor:
		doc, err := s.q().GetDoctorByID(ctx, uid)
		if err == nil {
			hash, found = doc.PasswordHash, true
		}
	case RoleAdmin:
		admin, err := s.q().GetAdminByID(ctx, uid)
		if err == nil {
			hash, found = admin.PasswordHash, true
		}
	default:
		return nil, BadRequest("Invalid role")
	}
	if !found {
		return nil, NotFound("Account not found")
	}
	if !ComparePassword(current, hash) {
		return nil, Unauthorized("Current password is incorrect")
	}
	newHash, err := HashPassword(newPass)
	if err != nil {
		return nil, err
	}
	switch role {
	case RolePatient:
		err = s.q().SetPatientPassword(ctx, gen.SetPatientPasswordParams{ID: uid, PasswordHash: text(newHash)})
	case RoleDoctor:
		err = s.q().SetDoctorPassword(ctx, gen.SetDoctorPasswordParams{ID: uid, PasswordHash: newHash})
	case RoleAdmin:
		err = s.q().SetAdminPassword(ctx, gen.SetAdminPasswordParams{ID: uid, PasswordHash: newHash})
	}
	if err != nil {
		return nil, err
	}
	subject, body := s.Copy.PasswordChanged()
	s.sendMail(emailOf(ctx, s, uid, role), subject, body(displayName(ctx, s, uid, role)))
	return map[string]any{"message": "Password changed successfully"}, nil
}

// --- forgot password --------------------------------------------------------

// InitiateForgotPassword mirrors registration OTP rules with anti-enumeration:
// unknown emails get the generic message and no row.
func (s *Service) InitiateForgotPassword(ctx context.Context, email string) (OTPResult, error) {
	email = lower(email)
	if _, err := s.q().GetPatientByEmail(ctx, email); err != nil {
		if isNotFound(err) {
			return OTPResult{
				Message: "If your email is registered, an OTP has been sent.",
				Email:   email,
			}, nil
		}
		return OTPResult{}, err
	}
	otp, hash, expires, err := s.newOTP()
	if err != nil {
		return OTPResult{}, err
	}
	var existing bool
	var count int32
	var window pgtype.Timestamptz
	if row, err := s.q().GetPendingPasswordReset(ctx, email); err == nil {
		existing, count, window = true, row.ResendCount, row.ResendWindowStartedAt
		if row.CooldownUntil.Valid && row.CooldownUntil.Time.After(time.Now()) {
			return OTPResult{}, BadRequest("Please wait before requesting another OTP.")
		}
	} else if !isNotFound(err) {
		return OTPResult{}, err
	}
	now := time.Now()
	newCount, newWindow := resendMeta(now, existing, count, window)
	if newCount > otpMaxResendsHour {
		return OTPResult{}, BadRequest("Too many OTP requests. Try again later.")
	}
	_, err = s.q().UpsertPendingPasswordReset(ctx, gen.UpsertPendingPasswordResetParams{
		Email: email, OtpHash: hash, OtpExpiresAt: ts(expires),
		AttemptCount: 0, ResendCount: newCount, ResendWindowStartedAt: newWindow,
		CooldownUntil: ts(now.Add(otpCooldownSeconds * time.Second)),
		ResetTokenJti: pgtype.Text{},
	})
	if err != nil {
		return OTPResult{}, err
	}
	subject, body := s.Copy.ForgotOTP()
	s.sendMail(email, subject, body(otp, otpExpiryMinutes))
	return s.otpResult(email, "OTP sent to your email.", otp), nil
}

// VerifyForgotOTP checks the OTP and returns the single-use reset token.
func (s *Service) VerifyForgotOTP(ctx context.Context, email, otp string) (map[string]any, error) {
	email = lower(email)
	row, err := s.q().GetPendingPasswordReset(ctx, email)
	if err != nil {
		if isNotFound(err) {
			return nil, NotFound("No pending password reset for this email.")
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
		_ = s.q().BumpPasswordResetAttempts(ctx, email)
		return nil, Unauthorized("Invalid or expired OTP")
	}
	token, jti, err := s.Issuer.GenerateReset(email)
	if err != nil {
		return nil, err
	}
	if err := s.q().MarkPasswordResetVerified(ctx, gen.MarkPasswordResetVerifiedParams{
		Email: email, ResetTokenJti: text(jti),
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"message":            "OTP verified successfully",
		"reset_token":        token,
		"reset_redirect_url": s.FrontendURL + "/auth/reset-password?token=" + token,
		"expires_in":         s.ResetExpiresIn(),
	}, nil
}

// ResetPassword consumes the reset token (single use: row deleted) and nulls
// the refresh hash, killing existing sessions.
func (s *Service) ResetPassword(ctx context.Context, token, password, confirm string) (map[string]any, error) {
	if password != confirm {
		return nil, BadRequest("Passwords do not match")
	}
	claims, err := s.Issuer.VerifyReset(token)
	if err != nil {
		return nil, Unauthorized("Invalid or expired reset token")
	}
	email := lower(claims.Email)
	pending, err := s.q().GetPendingPasswordReset(ctx, email)
	if err != nil || !pending.ResetTokenJti.Valid || pending.ResetTokenJti.String != claims.ID {
		return nil, Unauthorized("Password reset verification is required")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	user, err := s.q().GetPatientByEmail(ctx, email)
	if err != nil {
		return nil, NotFound("Account not found")
	}
	if err := s.q().SetPatientPassword(ctx, gen.SetPatientPasswordParams{
		ID: user.ID, PasswordHash: text(hash),
	}); err != nil {
		return nil, err
	}
	if err := s.q().SetPatientRefreshHash(ctx, gen.SetPatientRefreshHashParams{
		ID: user.ID, RefreshTokenHash: pgtype.Text{},
	}); err != nil {
		return nil, err
	}
	_ = s.q().DeletePendingPasswordReset(ctx, email)
	return map[string]any{"message": "Password reset successfully"}, nil
}

// --- admin-created doctor signup --------------------------------------------

// DoctorSignup creates a doctor account (admin-only at the HTTP layer,
// doctorSignup-flagged). Returns the Nest-shaped doctor session.
func (s *Service) DoctorSignup(ctx context.Context, email, first, last, password, phone string) (map[string]any, error) {
	email = lower(email)
	if _, err := s.q().GetDoctorByEmail(ctx, email); err == nil {
		return nil, Conflict("Doctor already exists")
	} else if !isNotFound(err) {
		return nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	mrnValue, err := mrn.Generate(ctx, s.q(), "doctor")
	if err != nil {
		return nil, err
	}
	var doc gen.Doctor
	for i := 0; i < 5; i++ {
		docNo, err := DoctorNo()
		if err != nil {
			return nil, err
		}
		doc, err = s.q().CreateDoctor(ctx, gen.CreateDoctorParams{
			DoctorNo: docNo, FirstName: first, LastName: last,
			FullName: text(first + " " + last), Email: email,
			PhoneNumber: text(phone), PasswordHash: hash, Active: true,
			Specializations: []string{}, Mrn: text(mrnValue),
			RefreshTokenHash: pgtype.Text{},
		})
		if err == nil {
			break
		}
		if !isUniqueViolation(err) || i == 4 {
			return nil, errToConflict(err)
		}
	}
	mrn.Claim(ctx, s.q(), mrnValue, doc.ID.String())
	return s.doctorSession(ctx, doc)
}

// --- bootstrap --------------------------------------------------------------

type BootstrapInput struct {
	FirstName, LastName, Email, PhoneNumber, Password, Role, BootstrapKey string
}

// BootstrapAdmin creates or updates the seeded admin. Gated by
// ALLOW_ADMIN_BOOTSTRAP=true plus key match (Nest parity, incl. messages).
func (s *Service) BootstrapAdmin(ctx context.Context, in BootstrapInput, allow bool, expectedKey string) (map[string]any, error) {
	if !allow {
		return nil, Forbidden("Admin bootstrap endpoint is disabled")
	}
	if expectedKey == "" {
		return nil, Forbidden("ADMIN_BOOTSTRAP_KEY is not configured")
	}
	if in.BootstrapKey != expectedKey {
		return nil, Unauthorized("Invalid bootstrap key")
	}
	email := lower(in.Email)
	role := in.Role
	if role == "" {
		role = "super_admin"
	}
	hash, err := HashPassword(in.Password)
	if err != nil {
		return nil, err
	}
	if existing, err := s.q().GetAdminByEmail(ctx, email); err == nil {
		updated, err := s.q().UpdateAdminOnBootstrap(ctx, gen.UpdateAdminOnBootstrapParams{
			Email: email, FirstName: in.FirstName, LastName: in.LastName,
			PhoneNumber: text(in.PhoneNumber), PasswordHash: hash, Role: role,
		})
		if err != nil {
			return nil, err
		}
		_ = existing
		return s.bootstrapSession(ctx, updated, "updated")
	} else if !isNotFound(err) {
		return nil, err
	}
	created, err := s.q().CreateAdmin(ctx, gen.CreateAdminParams{
		FirstName: in.FirstName, LastName: in.LastName, Email: email,
		PhoneNumber: text(in.PhoneNumber), PasswordHash: hash, Role: role,
		RefreshTokenHash: pgtype.Text{},
	})
	if err != nil {
		return nil, errToConflict(err)
	}
	return s.bootstrapSession(ctx, created, "created")
}

func (s *Service) bootstrapSession(ctx context.Context, admin gen.Admin, mode string) (map[string]any, error) {
	access, refresh, err := s.mintSession(admin.ID.String(), admin.Email, RoleAdmin)
	if err != nil {
		return nil, err
	}
	if err := s.q().SetAdminRefreshHash(ctx, gen.SetAdminRefreshHashParams{
		ID: admin.ID, RefreshTokenHash: text(refresh.hash),
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"admin": adminJSON(admin), "token": access,
		"refresh_token": refresh.token, "role": RoleAdmin, "mode": mode,
	}, nil
}
