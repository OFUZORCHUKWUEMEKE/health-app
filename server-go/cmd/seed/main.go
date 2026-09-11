// Command seed prepares a local development database: creates it when
// missing, runs migrations up, and writes baseline app_meta markers.
// Domain seed rows arrive with Milestone 5+ tables.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/config"
	"github.com/wizzyszn/Telemex/internal/logger"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"go.uber.org/zap"
)

func main() {
	cfg := config.Load()
	if err := logger.Init(cfg.Environment == "production"); err != nil {
		fmt.Fprintf(os.Stderr, "logger init: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		fmt.Fprintln(os.Stderr, "seed: DATABASE_URL is missing")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := ensureDatabase(ctx, cfg.DatabaseURL); err != nil {
		fmt.Fprintf(os.Stderr, "seed: ensure database: %v\n", err)
		os.Exit(1)
	}
	if err := postgres.Up(ctx, cfg.DatabaseURL); err != nil {
		fmt.Fprintf(os.Stderr, "seed: migrate up: %v\n", err)
		os.Exit(1)
	}
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed: connect: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	q := gen.New(pool.Inner())
	seeds := map[string]string{
		"seeded_at":        time.Now().UTC().Format(time.RFC3339),
		"seed_environment": cfg.Environment,
	}
	for k, v := range seeds {
		if _, err := q.SetMeta(ctx, gen.SetMetaParams{Key: k, Value: v}); err != nil {
			fmt.Fprintf(os.Stderr, "seed: set %s: %v\n", k, err)
			os.Exit(1)
		}
	}
	logger.L().Info("database_seeded", zap.Int("keys", len(seeds)))
}

// ensureDatabase creates the target database when it does not exist yet.
func ensureDatabase(ctx context.Context, databaseURL string) error {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return err
	}
	target := strings.TrimPrefix(u.Path, "/")
	if target == "" {
		return fmt.Errorf("DATABASE_URL has no database name")
	}
	u.Path = "/postgres"
	admin, err := sql.Open("pgx", u.String())
	if err != nil {
		return err
	}
	defer admin.Close()
	var exists bool
	if err := admin.QueryRowContext(ctx, "SELECT true FROM pg_database WHERE datname = $1", target).Scan(&exists); err != nil && err != sql.ErrNoRows {
		return err
	}
	if exists {
		return nil
	}
	_, err = admin.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", quoteIdent(target)))
	return err
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
