// Package migrations embeds the goose SQL migrations.
// Files live here (server-side, ops-visible). Domain tables arrive with
// Milestone 5; this package only carries the M4 baseline proving the chain
// (empty database → migrate up → versioned) works end to end.
package migrations

import "embed"

// FS holds migrations/*.sql, applied oldest-first by goose.
func FS() embed.FS { return files }

//go:embed *.sql
var files embed.FS
