package postgres_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

func ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}

func TestConnectAndPing(t *testing.T) {
	pool := testdb.Setup(t)
	c, cancel := ctx()
	defer cancel()
	if err := pool.Ping(c); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if err := pool.Health(c); err != nil {
		t.Fatalf("health: %v", err)
	}
}

func TestRunTxCommitAndRollback(t *testing.T) {
	pool := testdb.Setup(t)
	c, cancel := ctx()
	defer cancel()
	q := gen.New(pool.Inner())

	if err := postgres.RunTx(c, pool, func(tx pgx.Tx) error {
		_, err := gen.New(tx).SetMeta(c, gen.SetMetaParams{Key: "tx_key", Value: "committed"})
		return err
	}); err != nil {
		t.Fatalf("commit tx: %v", err)
	}
	row, err := q.GetMeta(c, "tx_key")
	if err != nil {
		t.Fatalf("get after commit: %v", err)
	}
	if row.Value != "committed" {
		t.Errorf("value = %q, want committed", row.Value)
	}

	want := "boom"
	if err := postgres.RunTx(c, pool, func(tx pgx.Tx) error {
		if _, err := gen.New(tx).SetMeta(c, gen.SetMetaParams{Key: "tx_key", Value: "rolled back"}); err != nil {
			return err
		}
		return errors.New(want)
	}); err == nil || err.Error() != want {
		t.Fatalf("rollback tx err = %v, want %q", err, want)
	}
	row, err = q.GetMeta(c, "tx_key")
	if err != nil {
		t.Fatalf("get after rollback: %v", err)
	}
	if row.Value != "committed" {
		t.Errorf("value after rollback = %q, want committed", row.Value)
	}
}

func TestSetAndListMeta(t *testing.T) {
	pool := testdb.Setup(t)
	c, cancel := ctx()
	defer cancel()
	q := gen.New(pool.Inner())

	// Unique keys: sibling tests share this database (parallel-safe suites).
	keyA := "list_a"
	keyB := "list_b"
	if _, err := q.SetMeta(c, gen.SetMetaParams{Key: keyB, Value: "2"}); err != nil {
		t.Fatalf("set b: %v", err)
	}
	if _, err := q.SetMeta(c, gen.SetMetaParams{Key: keyA, Value: "1"}); err != nil {
		t.Fatalf("set a: %v", err)
	}
	a, err := q.GetMeta(c, keyA)
	if err != nil || a.Value != "1" {
		t.Errorf("get a = %+v, %v", a, err)
	}
	b, err := q.GetMeta(c, keyB)
	if err != nil || b.Value != "2" {
		t.Errorf("get b = %+v, %v", b, err)
	}
	// Ordering spot-check over our own keys.
	rows, err := q.ListMeta(c)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	seen := map[string]int{}
	for i, r := range rows {
		if r.Key == keyA || r.Key == keyB {
			seen[r.Key] = i
		}
	}
	if len(seen) != 2 || seen[keyA] > seen[keyB] {
		t.Errorf("ordering wrong for own keys: %+v", rows)
	}
}
