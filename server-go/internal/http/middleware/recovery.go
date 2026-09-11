package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/wizzyszn/Telemex/internal/http/response"
	"github.com/wizzyszn/Telemex/internal/logger"
)

// Recovery converts panics into the standard error envelope (HTTP 500)
// instead of Gin's default plain-text response. The panic is logged with
// the request ID so the log line joins to the request log and the
// client's error envelope.
func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		rid, _ := c.Get("requestID")
		logger.L().Error("panic_recovered",
			zap.Any("request_id", rid),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.RequestURI()),
			zap.Any("error", recovered),
		)
		response.Fail(c, http.StatusInternalServerError, "An error encountered", "An error encountered")
		c.Abort()
	})
}
