package postgres

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/wizzyszn/Telemex/internal/logger"
)

// slowQueryThreshold reads SLOW_QUERY_MS (default 500ms). Non-positive
// values disable slow-query logging entirely.
func slowQueryThreshold() time.Duration {
	if v := strings.TrimSpace(os.Getenv("SLOW_QUERY_MS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			if n <= 0 {
				return 0
			}
			return time.Duration(n) * time.Millisecond
		}
	}
	return 500 * time.Millisecond
}

// shouldLogSlow reports whether a query duration breaches the threshold.
// A zero threshold means disabled.
func shouldLogSlow(d time.Duration, threshold time.Duration) bool {
	return threshold > 0 && d >= threshold
}

// slowTracer is a pgx QueryTracer logging only breaching queries.
// The SQL text is logged; bound args never are — they carry PHI (emails,
// names, clinical text) while the text is just placeholders.
type slowTracer struct {
	threshold time.Duration
}

type traceSpan struct {
	sql   string
	start time.Time
}

type traceSpanKey struct{}

func (t *slowTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, traceSpanKey{}, traceSpan{sql: data.SQL, start: time.Now()})
}

func (t *slowTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	span, _ := ctx.Value(traceSpanKey{}).(traceSpan)
	if span.start.IsZero() {
		return
	}
	if !shouldLogSlow(time.Since(span.start), t.threshold) {
		return
	}
	logger.L().Warn("slow_query",
		zap.String("sql", truncateSQL(span.sql)),
		zap.Duration("duration", time.Since(span.start)),
		zap.Error(data.Err),
	)
}

// truncateSQL caps logged statements so a pathological batch cannot flood
// the log stream.
func truncateSQL(s string) string {
	const max = 2000
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
