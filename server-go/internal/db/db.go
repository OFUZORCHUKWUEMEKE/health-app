// Package db defines the database seams. The concrete pool lives in
// internal/platform/postgres; handlers and services depend on these
// interfaces so they stay testable without a live database.
//
// Repository conventions (Milestone 4):
//   - SQL lives in server-go/db/queries/*.sql, one file per table group.
//   - server-go/db/gen holds sqlc output only — never hand-edit.
//   - Services take gen.Querier (satisfied by *pgxpool.Pool and pgx.Tx), so
//     the same service code runs inside or outside a transaction.
//   - Transaction boundaries belong in services via postgres.RunTx, never in
//     repositories.
package db

import (
	"context"
	"io"
)

// DB is the minimal contract the rest of the service needs.
type DB interface {
	io.Closer
	Ping(ctx context.Context) error
}

// Pinger is anything that can prove database connectivity.
type Pinger interface {
	Ping(ctx context.Context) error
}
