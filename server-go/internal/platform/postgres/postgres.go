package postgres

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool wraps the pgx connection pool. It implements db.DB (Close + Ping)
// and exposes the pieces services need: transactions, health, and the inner
// pool for sqlc-generated queries.
type Pool struct {
	pool *pgxpool.Pool
}

// Connect opens a pgx pool for databaseURL and verifies it with a ping.
// Empty URL is a clear error, not a panic — main decides whether a missing
// database is fatal.
func Connect(ctx context.Context, databaseURL string) (*Pool, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("postgres: DATABASE_URL is missing")
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	// Sized for fan-out: concurrent helpers cap in-flight queries at or
	// below this number (see internal/concurrent), so parallel paths cannot
	// starve each other. Tunable via DB_MAX_CONNS (default 25).
	cfg.MaxConns = maxConns()
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = time.Minute
	// Slow-query visibility (M19): threshold via SLOW_QUERY_MS, off when
	// non-positive. Args are never logged — they carry PHI.
	cfg.ConnConfig.Tracer = &slowTracer{threshold: slowQueryThreshold()}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	p := &Pool{pool: pool}
	if err := p.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return p, nil
}

// Close drains the pool.
func (p *Pool) Close() { p.pool.Close() }

// Ping verifies connectivity.
func (p *Pool) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }

// Health is the readiness probe: ping with a short timeout so a wedged
// database fails fast instead of hanging the /readyz handler.
func (p *Pool) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var one int
	if err := p.pool.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		return err
	}
	if one != 1 {
		return errors.New("postgres: unexpected health result")
	}
	return nil
}

// Inner exposes the raw pool for sqlc-generated queries (gen.New(p.Inner()))
// and for code that needs pgx-native access.
func (p *Pool) Inner() *pgxpool.Pool { return p.pool }

// Stats snapshots pool utilization for /readyz and ops debugging.
// Nil pool reports zeros (unconfigured database, M2 contract).
func (p *Pool) Stats() map[string]any {
	if p == nil || p.pool == nil {
		return map[string]any{"total": 0, "idle": 0, "acquired": 0}
	}
	s := p.pool.Stat()
	return map[string]any{
		"total":    s.TotalConns(),
		"idle":     s.IdleConns(),
		"acquired": s.AcquiredConns(),
	}
}

// Begin starts a transaction.
func (p *Pool) Begin(ctx context.Context) (pgx.Tx, error) { return p.pool.Begin(ctx) }

// Beginner is anything that can start a transaction — *Pool or a test double.
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// RunTx runs fn inside a transaction: commit on nil error, rollback
// otherwise (including panics, which are re-raised after rollback).
// This is the transaction helper services use for multi-statement writes.
func RunTx(ctx context.Context, b Beginner, fn func(tx pgx.Tx) error) (err error) {
	tx, err := b.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
		} else {
			err = tx.Commit(ctx)
		}
	}()
	err = fn(tx)
	return err
}

// MaxConns reports the configured pool ceiling (for startup logs).
func MaxConns() int32 { return maxConns() }

// maxConns reads DB_MAX_CONNS with a fan-out-safe default.
func maxConns() int32 {
	if v := strings.TrimSpace(os.Getenv("DB_MAX_CONNS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 200 {
			return int32(n)
		}
	}
	return 25
}
