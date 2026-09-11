package patients

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves patient self-service routes (all PATIENT role).
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

// Register mounts /patients self routes. Literal routes stay above any
// :id-style params (route-ordering rule, preserved from Nest).
func (h *Handler) Register(rg *gin.RouterGroup) {
	p := rg.Group("/patients")
	p.Use(middleware.Authenticate(h.issuer, h.users, auth.RolePatient))

	p.GET("/me", h.wrap(h.svc.Summary))
	p.GET("/me/profile", h.wrap(h.svc.Profile))
	p.GET("/me/metrics", h.wrap(h.svc.Metrics))
	p.PATCH("/me", h.patchProfile)
	p.PATCH("/me/profile", h.patchProfile)
	p.PATCH("/me/timezone", h.timezone)
	p.PATCH("/me/profile-picture", h.pictureURL)
	p.POST("/me/profile-picture/upload", h.uploadPicture)
}

func (h *Handler) me(c *gin.Context) (string, bool) {
	u, ok := middleware.CurrentUserFrom(c)
	if !ok {
		h.fail(c, auth.Unauthorized("Invalid or expired token"))
		return "", false
	}
	return u.ID, true
}

func (h *Handler) wrap(fn func(ctx context.Context, userID string) (map[string]any, error)) gin.HandlerFunc {
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
	contentType := c.GetHeader("Content-Type")
	var patch *Patch
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := c.Request.ParseMultipartForm(MaxUploadBytes << 1); err != nil {
			h.fail(c, auth.BadRequest("Invalid multipart body"))
			return
		}
		form := map[string][]string{}
		for k, vals := range c.Request.MultipartForm.Value {
			form[k] = vals
		}
		var err error
		patch, err = DecodeFormPatch(form)
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
		patch, err = DecodeJSONPatch(body)
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
	// UploadPicture persists and returns the full profile already.
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
