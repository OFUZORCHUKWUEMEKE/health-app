package doctors

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves doctor self-service routes (DOCTOR) plus admin-owned
// activation routes (ADMIN), mirroring doctors.controller.ts placement.
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

// Register mounts /doctors routes. Literal self routes stay above :id
// (route-ordering rule, Nest parity).
func (h *Handler) Register(rg *gin.RouterGroup) {
	d := rg.Group("/doctors")
	d.Use(middleware.Authenticate(h.issuer, h.users, auth.RoleDoctor))

	d.GET("/me", h.wrap(h.svc.Summary))
	d.GET("/me/profile", h.wrap(h.svc.Profile))
	d.GET("/me/metrics", h.wrap(h.svc.Metrics))
	d.PATCH("/me", h.patchProfile)
	d.PATCH("/me/profile", h.patchProfile)
	d.PATCH("/me/profile-picture", h.pictureURL)
	d.POST("/me/profile-picture/upload", h.uploadPicture)
	d.PATCH("/me/timezone", h.timezone)
	d.GET("/patients", h.patientList)

	admin := rg.Group("/doctors")
	admin.Use(middleware.Authenticate(h.issuer, h.users, auth.RoleAdmin))
	admin.PATCH("/:id/activate", h.activate(true))
	admin.PATCH("/:id/deactivate", h.activate(false))
}

func (h *Handler) me(c *gin.Context) (string, bool) {
	u, ok := middleware.CurrentUserFrom(c)
	if !ok {
		h.fail(c, auth.Unauthorized("Invalid or expired token"))
		return "", false
	}
	return u.ID, true
}

func (h *Handler) wrap(fn func(ctx context.Context, doctorID string) (map[string]any, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := h.me(c)
		if !ok {
			return
		}
		data, err := fn(c.Request.Context(), id)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

// patchProfile accepts JSON or multipart (file wins for the picture step).
func (h *Handler) patchProfile(c *gin.Context) {
	id, ok := h.me(c)
	if !ok {
		return
	}
	var patch *Patch
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		if err := c.Request.ParseMultipartForm(MaxUploadBytes << 1); err != nil {
			h.fail(c, auth.BadRequest("Invalid multipart body"))
			return
		}
		form := map[string][]string{}
		for k, vals := range c.Request.MultipartForm.Value {
			form[k] = vals
		}
		var err error
		patch, err = DecodePatch(nil, form)
		if err != nil {
			h.fail(c, err)
			return
		}
		if file := files.PickFile(c.Request.MultipartForm, MaxUploadBytes); file != nil {
			url, uerr := h.storeFile(c, id, file)
			if uerr != nil {
				h.fail(c, uerr)
				return
			}
			patch.ProfilePictureURL = &url
		}
	} else {
		var body map[string]any
		if !response.Bind(c, &body) {
			return
		}
		var err error
		patch, err = DecodePatch(body, nil)
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	data, err := h.svc.Apply(c.Request.Context(), id, patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) timezone(c *gin.Context) {
	id, ok := h.me(c)
	if !ok {
		return
	}
	var body struct {
		Timezone string `json:"timezone" binding:"required"`
	}
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.svc.UpdateTimezone(c.Request.Context(), id, body.Timezone)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) pictureURL(c *gin.Context) {
	id, ok := h.me(c)
	if !ok {
		return
	}
	var body struct {
		ProfilePictureURL string `json:"profile_picture_url" binding:"required"`
	}
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.svc.SetPictureURL(c.Request.Context(), id, body.ProfilePictureURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) uploadPicture(c *gin.Context) {
	id, ok := h.me(c)
	if !ok {
		return
	}
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		if err := c.Request.ParseMultipartForm(MaxUploadBytes << 1); err != nil {
			h.fail(c, auth.BadRequest("Invalid multipart body"))
			return
		}
	}
	file := files.PickFile(c.Request.MultipartForm, MaxUploadBytes)
	if file == nil {
		h.fail(c, auth.BadRequest("Profile image file is required. Use one of these form-data keys: file, image, profile_picture"))
		return
	}
	url, ferr := h.storeFile(c, id, file)
	if ferr != nil {
		h.fail(c, ferr)
		return
	}
	data, err := h.svc.SetPictureURL(c.Request.Context(), id, url)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) storeFile(c *gin.Context, id string, file *files.PickedFile) (string, *auth.Error) {
	if file.Oversize || file.Data == nil {
		return "", auth.BadRequest("File too large")
	}
	profile, err := h.svc.UploadPicture(c.Request.Context(), id, file.Data, file.ContentType)
	if err != nil {
		if svcErr, ok := err.(*auth.Error); ok {
			return "", svcErr
		}
		return "", &auth.Error{Status: 500, Message: "An error encountered"}
	}
	u, _ := profile["profile_picture_url"].(string)
	return u, nil
}

func (h *Handler) patientList(c *gin.Context) {
	id, ok := h.me(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	data, err := h.svc.PatientList(c.Request.Context(), id, c.Query("q"), page, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) activate(active bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := h.svc.SetActive(c.Request.Context(), c.Param("id"), active)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}
