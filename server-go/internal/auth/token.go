// Package auth holds token minting/verification, password hashing, and the
// CurrentUser identity carried by the auth middleware. It ports
// health-app/src/auth/token.service.ts claim-for-claim so tokens issued by
// either backend verify on the other during the transition.
package auth

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Token purposes for one-time JWTs.
const (
	PurposeRegistration  = "patient_registration"
	PurposePasswordReset = "password_reset"
)

// Roles (lowercase wire values, matching Nest Role).
const (
	RoleAdmin   = "admin"
	RoleDoctor  = "doctor"
	RolePatient = "patient"
)

var (
	// ErrExpired marks an expired token (callers translate to 400 for
	// user-supplied tokens, mirroring verifyUserSuppliedToken).
	ErrExpired = errors.New("token has expired")
	// ErrInvalid marks any other verification failure.
	ErrInvalid = errors.New("invalid token")
)

// Claims mirrors the Nest payloads: {sub, email, role} for session tokens,
// {email, purpose, jti} for one-time tokens.
type Claims struct {
	jwt.RegisteredClaims
	Email   string `json:"email,omitempty"`
	Role    string `json:"role,omitempty"`
	Purpose string `json:"purpose,omitempty"`
}

// Issuer mints and verifies all four token types. Secrets fall back exactly
// like Nest: registration/reset use their own secret or JWT_SECRET.
type Issuer struct {
	AccessSecret  string
	RefreshSecret string
	RegSecret     string
	ResetSecret   string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
	RegTTL        time.Duration
	ResetTTL      time.Duration
}

// IssuerConfig is the string form from env (durations like "7d", "90d", "15m").
type IssuerConfig struct {
	JWTSecret, JWTRefreshSecret string
	RegSecret, ResetSecret      string
	AccessExp, RefreshExp       string
	RegExp, ResetExp            string
}

// NewIssuer builds an Issuer, applying Nest-compatible defaults.
func NewIssuer(c IssuerConfig) (*Issuer, error) {
	def := func(s, fallback string) string {
		if strings.TrimSpace(s) == "" {
			return fallback
		}
		return s
	}
	parse := func(s string, fallback time.Duration) (time.Duration, error) {
		if strings.TrimSpace(s) == "" {
			return fallback, nil
		}
		return ParseDuration(s)
	}
	accessTTL, err := parse(c.AccessExp, 7*24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("auth: bad access expiration: %w", err)
	}
	refreshTTL, err := parse(c.RefreshExp, 90*24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("auth: bad refresh expiration: %w", err)
	}
	regTTL, err := parse(c.RegExp, 15*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("auth: bad registration expiration: %w", err)
	}
	resetTTL, err := parse(c.ResetExp, 15*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("auth: bad reset expiration: %w", err)
	}
	if strings.TrimSpace(c.JWTSecret) == "" || strings.TrimSpace(c.JWTRefreshSecret) == "" {
		return nil, errors.New("auth: JWT_SECRET and JWT_REFRESH_SECRET are required")
	}
	return &Issuer{
		AccessSecret:  c.JWTSecret,
		RefreshSecret: c.JWTRefreshSecret,
		RegSecret:     def(c.RegSecret, c.JWTSecret),
		ResetSecret:   def(c.ResetSecret, c.JWTSecret),
		AccessTTL:     accessTTL,
		RefreshTTL:    refreshTTL,
		RegTTL:        regTTL,
		ResetTTL:      resetTTL,
	}, nil
}

// ParseDuration accepts Nest/ms-style strings: "15m", "24h", "7d", "90d",
// "30s", or bare seconds ("3600").
func ParseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("empty duration")
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return time.Duration(n) * time.Second, nil
	}
	if strings.HasSuffix(s, "d") {
		n, err := strconv.ParseInt(strings.TrimSuffix(s, "d"), 10, 64)
		if err != nil {
			return 0, fmt.Errorf("bad duration %q", s)
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("bad duration %q", s)
	}
	return d, nil
}

func sign(claims Claims, secret string) (string, error) {
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(secret))
}

func sessionClaims(userID, email, role string, ttl time.Duration) Claims {
	now := time.Now()
	return Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
		Email: email,
		Role:  role,
	}
}

// GenerateAccess mints {sub, email, role} under JWT_SECRET.
func (iss *Issuer) GenerateAccess(userID, email, role string) (string, error) {
	return sign(sessionClaims(userID, email, role, iss.AccessTTL), iss.AccessSecret)
}

// GenerateRefresh mints {sub, email, role} under JWT_REFRESH_SECRET.
func (iss *Issuer) GenerateRefresh(userID, email, role string) (string, error) {
	return sign(sessionClaims(userID, email, role, iss.RefreshTTL), iss.RefreshSecret)
}

// GenerateRegistration mints {email, purpose, jti} and returns token + jti
// (the jti is stored on the pending row for single-use enforcement).
func (iss *Issuer) GenerateRegistration(email string) (token, jti string, err error) {
	return iss.oneTime(email, PurposeRegistration, iss.RegSecret, iss.RegTTL)
}

// GenerateReset mints {email, purpose, jti} for forgot-password.
func (iss *Issuer) GenerateReset(email string) (token, jti string, err error) {
	return iss.oneTime(email, PurposePasswordReset, iss.ResetSecret, iss.ResetTTL)
}

func (iss *Issuer) oneTime(email, purpose, secret string, ttl time.Duration) (string, string, error) {
	now := time.Now()
	jti := uuid.NewString()
	tok, err := sign(Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        jti,
		},
		Email:   email,
		Purpose: purpose,
	}, secret)
	return tok, jti, err
}

func parse(token, secret string) (*Claims, error) {
	claims := &Claims{}
	tok, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpired
		}
		return nil, ErrInvalid
	}
	if !tok.Valid {
		return nil, ErrInvalid
	}
	return claims, nil
}

// VerifyAccess checks a Bearer access token.
func (iss *Issuer) VerifyAccess(token string) (*Claims, error) {
	return parse(token, iss.AccessSecret)
}

// VerifyRefresh checks a refresh token (rotation logic lives in M7).
func (iss *Issuer) VerifyRefresh(token string) (*Claims, error) {
	return parse(token, iss.RefreshSecret)
}

// VerifyRegistration checks a registration token and its purpose.
func (iss *Issuer) VerifyRegistration(token string) (*Claims, error) {
	c, err := parse(token, iss.RegSecret)
	if err != nil {
		return nil, err
	}
	if c.Purpose != PurposeRegistration {
		return nil, ErrInvalid
	}
	return c, nil
}

// VerifyReset checks a password-reset token and its purpose.
func (iss *Issuer) VerifyReset(token string) (*Claims, error) {
	c, err := parse(token, iss.ResetSecret)
	if err != nil {
		return nil, err
	}
	if c.Purpose != PurposePasswordReset {
		return nil, ErrInvalid
	}
	return c, nil
}
