// Package router wires the global middleware chain and versioned routes.
package router

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/admin"
	"github.com/wizzyszn/Telemex/internal/authhttp"
	"github.com/wizzyszn/Telemex/internal/booking"
	"github.com/wizzyszn/Telemex/internal/config"
	"github.com/wizzyszn/Telemex/internal/consult"
	"github.com/wizzyszn/Telemex/internal/docs"
	"github.com/wizzyszn/Telemex/internal/doctors"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
	"github.com/wizzyszn/Telemex/internal/notifications"
	"github.com/wizzyszn/Telemex/internal/patients"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/version"
	"github.com/wizzyszn/Telemex/internal/video"
)

// Deps carries the shared infrastructure domain handlers need. Handler
// fields are nil-safe: nil handlers stay unmounted so /health + /readyz
// keep working without secrets or a database.
type Deps struct {
	Config   config.Config
	Pool     *postgres.Pool
	Authed   *authhttp.Handler
	Patients *patients.Handler
	Doctors  *doctors.Handler
	Admin    *admin.Handler
	Booking  *booking.Handler
	Consult  *consult.Handler
	Notify   *notifications.Handler
	Video    *video.Handler
}

// New builds the Gin engine. Middleware order: request ID, request log,
// CORS, recovery, then routes.
func New(d Deps) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	r.Use(middleware.RequestID())
	r.Use(middleware.RequestLog())
	r.Use(middleware.CORS(d.Config.AllowAllOrigins(), d.Config.CORSOrigins))
	r.Use(middleware.Recovery())

	r.NoRoute(func(c *gin.Context) {
		response.Fail(c, http.StatusNotFound, "Not Found", "Not Found")
	})
	r.NoMethod(func(c *gin.Context) {
		response.Fail(c, http.StatusMethodNotAllowed, "Method Not Allowed", "Method Not Allowed")
	})

	v1 := r.Group("/api/v1")
	v1.GET("/health", func(c *gin.Context) {
		response.OK(c, gin.H{"status": "ok"})
	})
	v1.GET("/version", versionInfo())
	v1.GET("/readyz", readiness(d.Pool))
	docs.Register(r)
	if d.Authed != nil {
		d.Authed.Register(v1)
	}
	if d.Patients != nil {
		d.Patients.Register(v1)
	}
	if d.Doctors != nil {
		d.Doctors.Register(v1)
	}
	if d.Admin != nil {
		d.Admin.Register(v1)
	}
	if d.Booking != nil {
		d.Booking.Register(v1)
	}
	if d.Consult != nil {
		d.Consult.Register(v1)
	}
	if d.Notify != nil {
		d.Notify.Register(v1)
	}
	if d.Video != nil {
		d.Video.Register(v1)
	}

	return r
}

// versionInfo serves build metadata so deployments can confirm what is
// running where.
func versionInfo() gin.HandlerFunc {
	return func(c *gin.Context) {
		response.OK(c, version.Info())
	}
}

// readiness reports database connectivity: 200 when the pool pings,
// 503 when the database is unconfigured or unreachable — both in the
// standard envelope so the frontend error path keeps working.
// The 200 body carries pool utilization so saturation is visible.
func readiness(pool *postgres.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if pool == nil {
			response.Fail(c, http.StatusServiceUnavailable, "Service Unavailable", "database unconfigured")
			return
		}
		if err := pool.Health(c.Request.Context()); err != nil {
			response.Fail(c, http.StatusServiceUnavailable, "Service Unavailable", "database unreachable")
			return
		}
		response.OK(c, gin.H{"status": "ready", "database": "ok", "pool": pool.Stats()})
	}
}
