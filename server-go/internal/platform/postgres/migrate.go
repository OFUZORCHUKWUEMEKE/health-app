package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/pressly/goose/v3"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/wizzyszn/Telemex/migrations"
)

func openDB(databaseURL string) (*sql.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("postgres: DATABASE_URL is missing")
	}
	return sql.Open("pgx", databaseURL)
}

// Up applies all pending migrations. Safe on an empty database — goose
// creates its version table first. Called at API startup and by the
// migrate/seed commands and test helpers.
func Up(ctx context.Context, databaseURL string) error {
	db, err := openDB(databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrations.FS())
	return goose.UpContext(ctx, db, ".")
}

// Down rolls back one migration.
func Down(ctx context.Context, databaseURL string) error {
	db, err := openDB(databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrations.FS())
	return goose.DownContext(ctx, db, ".")
}

// Status reports applied vs pending migrations.
func Status(ctx context.Context, databaseURL string) error {
	db, err := openDB(databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrations.FS())
	return goose.StatusContext(ctx, db, ".")
}
