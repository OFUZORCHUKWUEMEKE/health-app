package video

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves the four video endpoints. Paths mirror Nest's empty
// @Controller() with full paths verbatim.
type Handler struct {
	svc    *Service
	issuer *auth.Issuer
	users  middleware.UserResolver
}

func NewHandler(svc *Service, issuer *auth.Issuer, users middleware.UserResolver) *Handler {
	return &Handler{svc: svc, issuer: issuer, users: users}
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

func (h *Handler) me(c *gin.Context) (middleware.CurrentUser, bool) {
	u, ok := middleware.CurrentUserFrom(c)
	if !ok {
		h.fail(c, auth.Unauthorized("Invalid or expired token"))
		return middleware.CurrentUser{}, false
	}
	return u, true
}

// Register mounts the video routes. Paths mirror Nest's empty
// @Controller() with full paths verbatim.
func (h *Handler) Register(rg *gin.RouterGroup) {
	d := rg.Group("/doctors/me/appointments")
	d.Use(middleware.Authenticate(h.issuer, h.users, auth.RoleDoctor))
	d.GET("/:id/video-token", h.doctorToken)
	d.PATCH("/:id/video/start", h.start)
	d.PATCH("/:id/video/end", h.end)

	p := rg.Group("/patients/me/appointments")
	p.Use(middleware.Authenticate(h.issuer, h.users, auth.RolePatient))
	p.GET("/:id/video-token", h.patientToken)
}

func (h *Handler) doctorToken(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.DoctorToken(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientToken(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.PatientToken(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) start(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.MarkStarted(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) end(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.MarkEnded(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}
