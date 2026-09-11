// Command migrate runs goose migrations against DATABASE_URL:
// usage: go run ./cmd/migrate [up|down|status|version] (default up).
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/wizzyszn/Telemex/internal/config"
	"github.com/wizzyszn/Telemex/internal/logger"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

func main() {
	cfg := config.Load()
	if err := logger.Init(cfg.Environment == "production"); err != nil {
		fmt.Fprintf(os.Stderr, "logger init: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	cmd := "up"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var err error
	switch cmd {
	case "up":
		err = postgres.Up(ctx, cfg.DatabaseURL)
	case "down":
		err = postgres.Down(ctx, cfg.DatabaseURL)
	case "status":
		err = postgres.Status(ctx, cfg.DatabaseURL)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q (want up|down|status)\n", cmd)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "migrate %s: %v\n", cmd, err)
		os.Exit(1)
	}
}
