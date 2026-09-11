// Package middleware holds the global Gin middleware chain.
package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestID honors an inbound x-request-id header and generates a UUID when
// missing, then echoes it back as a response header. Ported from
// health-app/src/common/middleware/request-context.middleware.ts.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := strings.TrimSpace(c.GetHeader("x-request-id"))
		if rid == "" {
			rid = uuid.NewString()
		}
		c.Set("requestID", rid)
		c.Writer.Header().Set("x-request-id", rid)
		c.Next()
	}
}
