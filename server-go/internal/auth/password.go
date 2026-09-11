package auth

import (
	"crypto/sha256"
	"encoding/hex"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost matches Nest (genSalt(10) / hash(x, 10)) so hashes stay
// comparable across backends.
const bcryptCost = 10

// HashPassword bcrypt-hashes a plaintext password for password_hash columns.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(h), err
}

// ComparePassword checks plaintext against a stored password_hash.
func ComparePassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// HashToken bcrypt-hashes a refresh token for refresh_token_hash columns.
// Refresh tokens are JWTs (~250 chars) and bcrypt caps input at 72 bytes
// (Node bcrypt silently truncates; Go errors), so the token is SHA-256
// pre-hashed first — standard practice for long API tokens. Hashes are Go-
// specific, which is safe: refresh tokens are transient and re-minted.
func HashToken(token string) (string, error) {
	sum := sha256.Sum256([]byte(token))
	h, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(sum[:])), bcryptCost)
	return string(h), err
}

// CompareToken checks a presented refresh token against its stored hash.
func CompareToken(token, hash string) bool {
	sum := sha256.Sum256([]byte(token))
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(hex.EncodeToString(sum[:]))) == nil
}

// HashOTP bcrypt-hashes a 6-digit OTP for otp_hash columns.
func HashOTP(otp string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(otp), bcryptCost)
	return string(h), err
}

// CompareOTP checks a presented OTP against its stored hash.
func CompareOTP(otp, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(otp)) == nil
}
