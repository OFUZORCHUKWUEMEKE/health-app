// Command api boots the Telemex Go service: config, logger, router,
// and an HTTP server with graceful shutdown.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/wizzyszn/Telemex/internal/admin"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/authhttp"
	"github.com/wizzyszn/Telemex/internal/booking"
	"github.com/wizzyszn/Telemex/internal/config"
	"github.com/wizzyszn/Telemex/internal/consult"
	"github.com/wizzyszn/Telemex/internal/doctors"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/router"
	"github.com/wizzyszn/Telemex/internal/logger"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/notifications"
	"github.com/wizzyszn/Telemex/internal/patients"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/version"
	"github.com/wizzyszn/Telemex/internal/video"
)

func main() {
	cfg := config.Load()

	if err := logger.Init(cfg.Environment == "production"); err != nil {
		fmt.Fprintf(os.Stderr, "logger init: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	// Auth infrastructure (M6): token issuer is mandatory — every domain
	// milestone mounts protected routes, so missing secrets fail fast here
	// with a clear message instead of 500s at request time.
	issuer, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret:        cfg.JWTSecret,
		JWTRefreshSecret: cfg.JWTRefreshSecret,
		RegSecret:        cfg.RegTokenSecret,
		ResetSecret:      cfg.ResetTokenSecret,
		AccessExp:        cfg.JWTAccessExpiration,
		RefreshExp:       cfg.JWTRefreshExpiration,
		RegExp:           cfg.RegTokenExpiration,
		ResetExp:         cfg.ResetTokenExpiration,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "auth config: %v\n", err)
		os.Exit(1)
	}

	// Database is optional at boot (M2 contract): without DATABASE_URL the
	// service runs and /readyz reports unconfigured. With it, connect and
	// migrate fail fast on error.
	var pool *postgres.Pool
	if cfg.DatabaseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		p, err := postgres.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			cancel()
			fmt.Fprintf(os.Stderr, "database connect: %v\n", err)
			os.Exit(1)
		}
		if err := postgres.Up(ctx, cfg.DatabaseURL); err != nil {
			cancel()
			p.Close()
			fmt.Fprintf(os.Stderr, "database migrate: %v\n", err)
			os.Exit(1)
		}
		cancel()
		pool = p
		defer pool.Close()
	} else {
		logger.L().Warn("database_unconfigured", zap.String("hint", "set DATABASE_URL to enable persistence"))
	}

	users := middleware.NewDBResolver(pool)
	engine := router.New(router.Deps{
		Config: cfg, Pool: pool,
		Authed:   authHandler(cfg, issuer, pool, users),
		Patients: patientsHandler(cfg, issuer, pool, users),
		Doctors:  doctorsHandler(cfg, issuer, pool, users),
		Admin:    adminHandler(pool, issuer, users),
		Booking:  bookingHandler(cfg, pool, issuer, users),
		Consult:  consultHandler(cfg, pool, issuer, users),
		Notify:   notifyHandler(cfg, pool, issuer, users),
		Video:    videoHandler(cfg, pool, issuer, users),
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.L().Info("application_starting",
			zap.Int("port", cfg.Port),
			zap.String("environment", cfg.Environment),
			zap.Bool("cors_allow_all", cfg.AllowAllOrigins()),
			zap.String("version", version.Version),
			zap.String("commit", version.Commit),
			zap.Int32("db_max_conns", postgres.MaxConns()),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.L().Fatal("server_error", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	logger.L().Info("application_shutting_down")
	if err := srv.Shutdown(ctx); err != nil {
		logger.L().Error("shutdown_error", zap.Error(err))
		os.Exit(1)
	}
	logger.L().Info("application_stopped")
}

// authHandler wires the M7 auth module. It returns nil without a database
// (auth routes stay unmounted; /health + /readyz keep working).
func authHandler(cfg config.Config, issuer *auth.Issuer, pool *postgres.Pool, users middleware.UserResolver) *authhttp.Handler {
	if pool == nil {
		return nil
	}
	sender := mail.New(mail.Config{
		Host: cfg.EmailHost, Port: cfg.EmailPort, User: cfg.EmailUser,
		Password: cfg.EmailPassword, From: cfg.EmailFrom, Secure: cfg.EmailSecure,
	})
	svc := &auth.Service{
		DB: pool, Issuer: issuer, Mail: sender, Copy: mail.NewCopy(),
		FrontendURL: cfg.FrontendURL,
		IncludeOTP:  includeOTP(cfg), RegExpLabel: cfg.RegTokenExpiration,
		ResetExpLabel: cfg.ResetTokenExpiration,
		Google: auth.GoogleConfig{
			ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret,
			CallbackURL: cfg.GoogleCallbackURL,
		},
	}
	return authhttp.NewHandler(svc, issuer, users, cfg.AllowAdminBS, cfg.AdminBootstrapKey, cfg.FrontendURL)
}

// patientsHandler wires the M9 patients module (nil without a database).
func patientsHandler(cfg config.Config, issuer *auth.Issuer, pool *postgres.Pool, users middleware.UserResolver) *patients.Handler {
	if pool == nil {
		return nil
	}
	svc := &patients.Service{
		DB: pool,
		Files: files.New(files.Config{
			CloudName: cfg.CloudinaryCloudName, APIKey: cfg.CloudinaryAPIKey,
			APISecret: cfg.CloudinaryAPISecret, Folder: cfg.CloudinaryProfileFolder,
			InvestigationFolder: cfg.CloudinaryInvestigationFolder,
		}),
	}
	return patients.NewHandler(svc, issuer, users)
}

// bookingHandler wires the M12 booking module (nil without a database).
func bookingHandler(cfg config.Config, pool *postgres.Pool, issuer *auth.Issuer, users middleware.UserResolver) *booking.Handler {
	if pool == nil {
		return nil
	}
	mode := cfg.BookingMode
	if mode == "" {
		mode = "auto"
	}
	return booking.NewHandler(&booking.Service{DB: pool, BookingMode: mode}, issuer, users)
}

// notifyHandler wires the M15 notifications module (nil without a database).
func notifyHandler(cfg config.Config, pool *postgres.Pool, issuer *auth.Issuer, users middleware.UserResolver) *notifications.Handler {
	if pool == nil {
		return nil
	}
	return notifications.NewHandler(&notifications.Service{DB: pool}, issuer, users, cfg.ReminderDispatchKey)
}

// consultHandler wires the M13 consultations module (nil without a database).
// The M17 file provider rides along: investigation uploads 503 when
// Cloudinary is unconfigured, everything else works without it.
func consultHandler(cfg config.Config, pool *postgres.Pool, issuer *auth.Issuer, users middleware.UserResolver) *consult.Handler {
	if pool == nil {
		return nil
	}
	return consult.NewHandler(&consult.Service{DB: pool, Files: files.New(files.Config{
		CloudName: cfg.CloudinaryCloudName, APIKey: cfg.CloudinaryAPIKey,
		APISecret: cfg.CloudinaryAPISecret, Folder: cfg.CloudinaryProfileFolder,
		InvestigationFolder: cfg.CloudinaryInvestigationFolder,
	})}, issuer, users)
}

// adminHandler wires the M11 admin module (nil without a database).
func adminHandler(pool *postgres.Pool, issuer *auth.Issuer, users middleware.UserResolver) *admin.Handler {
	if pool == nil {
		return nil
	}
	return admin.NewHandler(&admin.Service{DB: pool}, issuer, users)
}

// doctorsHandler wires the M10 doctors module (nil without a database).
func doctorsHandler(cfg config.Config, issuer *auth.Issuer, pool *postgres.Pool, users middleware.UserResolver) *doctors.Handler {
	if pool == nil {
		return nil
	}
	svc := &doctors.Service{
		DB: pool,
		Files: files.New(files.Config{
			CloudName: cfg.CloudinaryCloudName, APIKey: cfg.CloudinaryAPIKey,
			APISecret: cfg.CloudinaryAPISecret, Folder: cfg.CloudinaryProfileFolder,
			InvestigationFolder: cfg.CloudinaryInvestigationFolder,
		}),
	}
	return doctors.NewHandler(svc, issuer, users)
}

// videoHandler wires the M16 video module (nil without a database).
// Daily stays optional: an empty DAILY_API_KEY mounts the routes but the
// token endpoints answer 503 (controlled, Nest parity).
func videoHandler(cfg config.Config, pool *postgres.Pool, issuer *auth.Issuer, users middleware.UserResolver) *video.Handler {
	if pool == nil {
		return nil
	}
	var daily video.Provider
	if cfg.DailyAPIKey != "" {
		daily = video.NewDaily(cfg.DailyAPIKey)
	}
	return video.NewHandler(&video.Service{DB: pool, Daily: daily}, issuer, users)
}

// includeOTP mirrors Nest: explicit RETURN_OTP_IN_RESPONSE=true/false wins,
// otherwise OTPs ride along in every non-production response.
func includeOTP(cfg config.Config) bool {
	switch cfg.ReturnOTPInResponse {
	case "true":
		return true
	case "false":
		return false
	default:
		return cfg.Environment != "production"
	}
}
