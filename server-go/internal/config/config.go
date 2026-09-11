// Package config loads service configuration via Viper.
// Values come from the environment, with an optional `.env` file as fallback.
// PORT defaults to 4000 to mirror the NestJS service being replaced.
package config

import (
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Port         int
	CORSOrigins  []string
	Environment  string
	AllowAdminBS bool
	DatabaseURL  string

	JWTSecret            string
	JWTRefreshSecret     string
	JWTAccessExpiration  string
	JWTRefreshExpiration string
	RegTokenSecret       string
	ResetTokenSecret     string
	RegTokenExpiration   string
	ResetTokenExpiration string

	FrontendURL         string
	EmailHost           string
	EmailPort           string
	EmailUser           string
	EmailPassword       string
	EmailFrom           string
	EmailSecure         bool
	GoogleClientID      string
	GoogleClientSecret  string
	GoogleCallbackURL   string
	AdminBootstrapKey   string
	ReturnOTPInResponse string

	CloudinaryCloudName           string
	CloudinaryAPIKey              string
	CloudinaryAPISecret           string
	CloudinaryProfileFolder       string
	CloudinaryInvestigationFolder string

	BookingMode string

	ReminderDispatchKey string

	DailyAPIKey string
}

func Load() Config {
	v := viper.New()
	v.SetConfigFile(".env")
	_ = v.ReadInConfig() // optional: env vars alone are fine
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	v.SetDefault("PORT", 4000)
	v.SetDefault("CORS_ORIGINS", "")
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("DATABASE_URL", "")
	v.SetDefault("JWT_SECRET", "")
	v.SetDefault("JWT_REFRESH_SECRET", "")
	v.SetDefault("JWT_ACCESS_EXPIRATION", "7d")
	v.SetDefault("JWT_REFRESH_EXPIRATION", "90d")
	v.SetDefault("REGISTRATION_TOKEN_SECRET", "")
	v.SetDefault("PASSWORD_RESET_TOKEN_SECRET", "")
	v.SetDefault("REGISTRATION_TOKEN_EXPIRATION", "15m")
	v.SetDefault("PASSWORD_RESET_TOKEN_EXPIRATION", "15m")
	v.SetDefault("FRONTEND_URL", "http://localhost:3000")
	v.SetDefault("EMAIL_HOST", "")
	v.SetDefault("EMAIL_PORT", "587")
	v.SetDefault("EMAIL_USER", "")
	v.SetDefault("EMAIL_PASSWORD", "")
	v.SetDefault("EMAIL_FROM", "")
	v.SetDefault("EMAIL_SECURE", false)
	v.SetDefault("GOOGLE_CLIENT_ID", "")
	v.SetDefault("GOOGLE_CLIENT_SECRET", "")
	v.SetDefault("GOOGLE_CALLBACK_URL", "")
	v.SetDefault("ADMIN_BOOTSTRAP_KEY", "")
	v.SetDefault("RETURN_OTP_IN_RESPONSE", "")
	v.SetDefault("CLOUDINARY_CLOUD_NAME", "")
	v.SetDefault("CLOUDINARY_API_KEY", "")
	v.SetDefault("CLOUDINARY_API_SECRET", "")
	v.SetDefault("CLOUDINARY_PROFILE_FOLDER", "health-app/profile-pictures")
	v.SetDefault("CLOUDINARY_INVESTIGATION_FOLDER", "health-app/investigation-results")
	v.SetDefault("BOOKING_MODE", "auto")
	v.SetDefault("REMINDER_DISPATCH_KEY", "")
	v.SetDefault("DAILY_API_KEY", "")

	return Config{
		Port:                          v.GetInt("PORT"),
		CORSOrigins:                   splitList(v.GetString("CORS_ORIGINS")),
		Environment:                   strings.ToLower(v.GetString("APP_ENV")),
		AllowAdminBS:                  v.GetBool("ALLOW_ADMIN_BOOTSTRAP"),
		DatabaseURL:                   v.GetString("DATABASE_URL"),
		JWTSecret:                     v.GetString("JWT_SECRET"),
		JWTRefreshSecret:              v.GetString("JWT_REFRESH_SECRET"),
		JWTAccessExpiration:           v.GetString("JWT_ACCESS_EXPIRATION"),
		JWTRefreshExpiration:          v.GetString("JWT_REFRESH_EXPIRATION"),
		RegTokenSecret:                v.GetString("REGISTRATION_TOKEN_SECRET"),
		ResetTokenSecret:              v.GetString("PASSWORD_RESET_TOKEN_SECRET"),
		RegTokenExpiration:            v.GetString("REGISTRATION_TOKEN_EXPIRATION"),
		ResetTokenExpiration:          v.GetString("PASSWORD_RESET_TOKEN_EXPIRATION"),
		FrontendURL:                   v.GetString("FRONTEND_URL"),
		EmailHost:                     v.GetString("EMAIL_HOST"),
		EmailPort:                     v.GetString("EMAIL_PORT"),
		EmailUser:                     v.GetString("EMAIL_USER"),
		EmailPassword:                 v.GetString("EMAIL_PASSWORD"),
		EmailFrom:                     v.GetString("EMAIL_FROM"),
		EmailSecure:                   v.GetBool("EMAIL_SECURE"),
		GoogleClientID:                v.GetString("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:            v.GetString("GOOGLE_CLIENT_SECRET"),
		GoogleCallbackURL:             v.GetString("GOOGLE_CALLBACK_URL"),
		AdminBootstrapKey:             v.GetString("ADMIN_BOOTSTRAP_KEY"),
		ReturnOTPInResponse:           v.GetString("RETURN_OTP_IN_RESPONSE"),
		CloudinaryCloudName:           v.GetString("CLOUDINARY_CLOUD_NAME"),
		CloudinaryAPIKey:              v.GetString("CLOUDINARY_API_KEY"),
		CloudinaryAPISecret:           v.GetString("CLOUDINARY_API_SECRET"),
		CloudinaryProfileFolder:       v.GetString("CLOUDINARY_PROFILE_FOLDER"),
		CloudinaryInvestigationFolder: v.GetString("CLOUDINARY_INVESTIGATION_FOLDER"),
		BookingMode:                   v.GetString("BOOKING_MODE"),
		ReminderDispatchKey:           v.GetString("REMINDER_DISPATCH_KEY"),
		DailyAPIKey:                   v.GetString("DAILY_API_KEY"),
	}
}

// AllowAllOrigins reports whether CORS should reflect any origin.
// Mirrors NestJS main.ts: empty allowlist (or "*") means allow all.
func (c Config) AllowAllOrigins() bool {
	if len(c.CORSOrigins) == 0 {
		return true
	}
	for _, o := range c.CORSOrigins {
		if o == "*" {
			return true
		}
	}
	return false
}

func splitList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Redacted returns the log-safe operational summary: every non-secret
// field that identifies what is running where. Secrets (URLs with
// credentials, tokens, keys, passwords) are never included — startup logs
// use this instead of the raw Config.
func (c Config) Redacted() map[string]interface{} {
	return map[string]any{
		"port":                    c.Port,
		"environment":             c.Environment,
		"cors_origins":            c.CORSOrigins,
		"allow_admin_bootstrap":   c.AllowAdminBS,
		"frontend_url":            c.FrontendURL,
		"email_host":              c.EmailHost,
		"email_port":              c.EmailPort,
		"email_secure":            c.EmailSecure,
		"jwt_access_expiration":   c.JWTAccessExpiration,
		"jwt_refresh_expiration":  c.JWTRefreshExpiration,
		"cloudinary_cloud_name":   c.CloudinaryCloudName,
		"cloudinary_folders":      []string{c.CloudinaryProfileFolder, c.CloudinaryInvestigationFolder},
		"booking_mode":            c.BookingMode,
		"google_oauth_configured": c.GoogleClientID != "" && c.GoogleClientSecret != "",
		"cloudinary_configured":   c.CloudinaryCloudName != "" && c.CloudinaryAPIKey != "" && c.CloudinaryAPISecret != "",
		"daily_configured":        c.DailyAPIKey != "",
	}
}
