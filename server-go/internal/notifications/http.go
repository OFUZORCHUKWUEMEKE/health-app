package notifications

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves notification feeds (role-scoped) and the reminder
// dispatch endpoint (key-gated, no auth — it is called by schedulers).
type Handler struct {
	svc         *Service
	issuer      *auth.Issuer
	users       middleware.UserResolver
	dispatchKey string
}

func NewHandler(svc *Service, issuer *auth.Issuer, users middleware.UserResolver, dispatchKey string) *Handler {
	return &Handler{svc: svc, issuer: issuer, users: users, dispatchKey: dispatchKey}
}

func (h *Handler) fail(c *gin.Context, err error) {
	if svcErr, ok := err.(*auth.Error); ok {
		if svcErr.Status == http.StatusBadRequest {
			response.FailValidation(c, svcErr.Message, []string{svcErr.Message})
			return
		}
		response.Fail(c, svcErr.Status, svcErr.Message, svcErr.Message)
		return
	}
	response.Fail(c, http.StatusInternalServerError, "An error encountered", "An error encountered")
}

// Register mounts /patients|doctors/me/notifications (role-scoped) and
// POST /internal/reminders/dispatch (public, key-gated).
func (h *Handler) Register(rg *gin.RouterGroup) {
	for _, role := range []string{auth.RolePatient, auth.RoleDoctor} {
		prefix := role + "s"
		g := rg.Group("/" + prefix + "/me/notifications")
		g.Use(middleware.Authenticate(h.issuer, h.users, role))
		g.GET("", h.feed(role))
		g.GET("/unread-count", h.unread(role))
		g.PATCH("/read-all", h.readAll(role))
		g.PATCH("/:id/read", h.markRead(role))
		g.DELETE("/:id", h.delete(role))
	}
	rg.POST("/internal/reminders/dispatch", h.dispatch)
}

func (h *Handler) me(c *gin.Context, role string) (string, bool) {
	u, ok := middleware.CurrentUserFrom(c)
	if !ok || u.Role != role {
		h.fail(c, auth.Unauthorized("Invalid or expired token"))
		return "", false
	}
	return u.ID, true
}

func (h *Handler) feed(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c, role)
		if !ok {
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
		data, err := h.svc.Feed(c.Request.Context(), id, role,
			c.Query("status"), c.Query("category"), c.Query("type"), page, perPage)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) unread(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c, role)
		if !ok {
			return
		}
		data, err := h.svc.UnreadCount(c.Request.Context(), id, role)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) markRead(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c, role)
		if !ok {
			return
		}
		data, err := h.svc.MarkRead(c.Request.Context(), id, role, c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) readAll(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c, role)
		if !ok {
			return
		}
		data, err := h.svc.MarkAllRead(c.Request.Context(), id, role)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) delete(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c, role)
		if !ok {
			return
		}
		data, err := h.svc.Delete(c.Request.Context(), id, role, c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

// dispatch runs the reminder sweep. Key behavior (Nest parity): unset key
// → 403 disabled; wrong key → 403; right key → sweep + counts.
func (h *Handler) dispatch(c *gin.Context) {
	if h.dispatchKey == "" {
		response.Fail(c, http.StatusForbidden, "Forbidden", "reminder dispatch is disabled")
		c.Abort()
		return
	}
	if c.GetHeader("x-reminder-key") != h.dispatchKey {
		response.Fail(c, http.StatusForbidden, "Forbidden", "invalid reminder key")
		c.Abort()
		return
	}
	result, err := h.svc.Dispatch(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{
		"dispatched_24h": result.Dispatched24H,
		"dispatched_1h":  result.Dispatched1H,
	}, "Success")
}
