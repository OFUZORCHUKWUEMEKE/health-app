package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/wizzyszn/Telemex/internal/logger"
)

// CORS mirrors the NestJS bootstrap (health-app/src/main.ts): open to every
// origin by default; CORS_ORIGINS restricts to an allowlist. Because
// credentials are allowed, an allow-all response reflects the caller Origin
// instead of sending "*". x-request-id is always exposed.
func CORS(allowAll bool, allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.TrimSpace(o)] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allowAll {
			if origin != "" {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				c.Writer.Header().Set("Vary", "Origin")
			} else {
				c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
			}
		} else if origin != "" {
			if _, ok := allowed[origin]; ok {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				c.Writer.Header().Set("Vary", "Origin")
			}
		}
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "x-request-id")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")
		if c.Request.Method == http.MethodOptions {
			if req := c.GetHeader("Access-Control-Request-Headers"); req != "" {
				c.Writer.Header().Set("Access-Control-Allow-Headers", req)
			} else {
				c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, x-request-id")
			}
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// RequestLog emits one structured line per request via zap.
func RequestLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		rid, _ := c.Get("requestID")
		logger.L().Info("http_request",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.RequestURI()),
			zap.Int("status", c.Writer.Status()),
			zap.Any("request_id", rid),
			zap.String("client_ip", c.ClientIP()),
		)
	}
}
