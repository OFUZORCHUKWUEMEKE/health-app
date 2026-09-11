// Package version carries build metadata. Values are stamped at link
// time:
//
//	go build -ldflags "-X github.com/wizzyszn/Telemex/internal/version.Version=1.2.0 \
//	  -X github.com/wizzyszn/Telemex/internal/version.Commit=abc123 \
//	  -X github.com/wizzyszn/Telemex/internal/version.BuiltAt=2026-01-01T00:00:00Z"
//
// Defaults keep local builds honest: "dev", never a fake release number.
package version

// Overridden by -ldflags at release time.
var (
	Version = "dev"
	Commit  = "unknown"
	BuiltAt = "unknown"
)

// Info returns the public build metadata served by /api/v1/version.
func Info() map[string]interface{} {
	return map[string]interface{}{
		"service":  "telemex-api",
		"version":  Version,
		"commit":   Commit,
		"built_at": BuiltAt,
	}
}
