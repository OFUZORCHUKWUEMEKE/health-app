// Package authhttp serves the auth routes over the auth.Service. It lives
// outside internal/auth because handlers need the auth middleware, which
// itself depends on internal/auth (import cycle otherwise).
package authhttp

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// DTOs mirror the Nest validation shapes (frontend-compatible field names).

type emailDTO struct {
	Email string `json:"email" binding:"required,email"`
}

type otpDTO struct {
	Email string `json:"email" binding:"required,email"`
	OTP   string `json:"otp" binding:"required"`
}

type completeDTO struct {
	RegistrationToken string `json:"registration_token" binding:"required"`
	FirstName         string `json:"first_name" binding:"required"`
	LastName          string `json:"last_name" binding:"required"`
	MiddleName        string `json:"middle_name"`
	PhoneNumber       string `json:"phone_number"`
	Password          string `json:"password" binding:"required,min=8"`
}

type signupDTO struct {
	FirstName   string `json:"first_name" binding:"required"`
	LastName    string `json:"last_name" binding:"required"`
	MiddleName  string `json:"middle_name"`
	Email       string `json:"email" binding:"required,email"`
	PhoneNumber string `json:"phone_number"`
	Password    string `json:"password" binding:"required,min=8"`
}

type loginDTO struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type refreshDTO struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
	Role         string `json:"role" binding:"required,oneof=admin doctor patient"`
}

type changePasswordDTO struct {
	CurrentPassword    string `json:"currentPassword" binding:"required"`
	NewPassword        string `json:"newPassword" binding:"required,min=8"`
	ConfirmNewPassword string `json:"confirmNewPassword" binding:"required"`
}

type resetDTO struct {
	ResetToken      string `json:"reset_token" binding:"required"`
	Password        string `json:"password" binding:"required,min=8"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
}

type bootstrapDTO struct {
	FirstName    string `json:"first_name" binding:"required"`
	LastName     string `json:"last_name" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	PhoneNumber  string `json:"phone_number"`
	Password     string `json:"password" binding:"required,min=8"`
	Role         string `json:"role"`
	BootstrapKey string `json:"bootstrap_key" binding:"required"`
}

type doctorSignupDTO struct {
	Email       string `json:"email" binding:"required,email"`
	FirstName   string `json:"first_name" binding:"required"`
	LastName    string `json:"last_name" binding:"required"`
	Password    string `json:"password" binding:"required,min=8"`
	PhoneNumber string `json:"phone_number"`
}

// Handler serves the auth routes.
type Handler struct {
	svc      *auth.Service
	issuer   *auth.Issuer
	users    middleware.UserResolver
	allowBS  bool
	bsKey    string
	frontend string
}

func NewHandler(svc *auth.Service, issuer *auth.Issuer, users middleware.UserResolver, allowBS bool, bsKey, frontend string) *Handler {
	return &Handler{svc: svc, issuer: issuer, users: users,
		allowBS: allowBS, bsKey: bsKey, frontend: frontend}
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

func (h *Handler) ok(c *gin.Context, status int, data map[string]any) {
	response.Success(c, status, data, "Success")
}

// Register mounts /auth routes.
func (h *Handler) Register(rg *gin.RouterGroup) {
	a := rg.Group("/auth")

	a.POST("/patients/register/initiate", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b emailDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		r, err := h.svc.InitiateRegistration(c.Request.Context(), b.Email)
		return toMap(r), err
	}))
	a.POST("/patients/register/verify-otp", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b otpDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.VerifyRegistrationOTP(c.Request.Context(), b.Email, b.OTP)
	}))
	a.POST("/patients/register/resend-otp", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b emailDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		r, err := h.svc.ResendRegistrationOTP(c.Request.Context(), b.Email)
		return toMap(r), err
	}))
	a.POST("/patients/register/complete", h.wrapStatus(http.StatusCreated,
		func(c *gin.Context) (map[string]any, error) {
			var b completeDTO
			if !response.Bind(c, &b) {
				return nil, nil
			}
			return h.svc.CompleteRegistration(c.Request.Context(), b.RegistrationToken,
				b.FirstName, b.LastName, b.MiddleName, b.PhoneNumber, b.Password)
		}))
	a.POST("/patients/signup", h.wrapStatus(http.StatusCreated,
		func(c *gin.Context) (map[string]any, error) {
			var b signupDTO
			if !response.Bind(c, &b) {
				return nil, nil
			}
			return h.svc.PatientSignup(c.Request.Context(), b.FirstName, b.LastName,
				b.MiddleName, b.Email, b.Password)
		}))
	a.POST("/patients/login", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b loginDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.Login(c.Request.Context(), auth.RolePatient, b.Email, b.Password)
	}))
	a.POST("/doctors/login", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b loginDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.Login(c.Request.Context(), auth.RoleDoctor, b.Email, b.Password)
	}))
	a.POST("/doctors/signup",
		middleware.Authenticate(h.issuer, h.users, auth.RoleAdmin),
		h.wrapStatus(http.StatusCreated, func(c *gin.Context) (map[string]any, error) {
			var b doctorSignupDTO
			if !response.Bind(c, &b) {
				return nil, nil
			}
			return h.svc.DoctorSignup(c.Request.Context(), b.Email, b.FirstName,
				b.LastName, b.Password, b.PhoneNumber)
		}))
	a.POST("/admins/login", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b loginDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.Login(c.Request.Context(), auth.RoleAdmin, b.Email, b.Password)
	}))
	a.POST("/admins/bootstrap", h.wrapStatus(http.StatusCreated,
		func(c *gin.Context) (map[string]any, error) {
			var b bootstrapDTO
			if !response.Bind(c, &b) {
				return nil, nil
			}
			return h.svc.BootstrapAdmin(c.Request.Context(), auth.BootstrapInput{
				FirstName: b.FirstName, LastName: b.LastName, Email: b.Email,
				PhoneNumber: b.PhoneNumber, Password: b.Password,
				Role: b.Role, BootstrapKey: b.BootstrapKey,
			}, h.allowBS, h.bsKey)
		}))
	a.POST("/refresh", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b refreshDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.Refresh(c.Request.Context(), b.RefreshToken, b.Role)
	}))
	a.POST("/change-password",
		middleware.Authenticate(h.issuer, h.users),
		h.wrap(func(c *gin.Context) (map[string]any, error) {
			var b changePasswordDTO
			if !response.Bind(c, &b) {
				return nil, nil
			}
			u, _ := middleware.CurrentUserFrom(c)
			return h.svc.ChangePassword(c.Request.Context(), u.ID, u.Role,
				b.CurrentPassword, b.NewPassword, b.ConfirmNewPassword)
		}))
	a.POST("/logout",
		middleware.Authenticate(h.issuer, h.users),
		h.wrap(func(c *gin.Context) (map[string]any, error) {
			u, _ := middleware.CurrentUserFrom(c)
			return h.svc.Logout(c.Request.Context(), u.ID, u.Role)
		}))
	a.POST("/forgot-password/initiate", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b emailDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		r, err := h.svc.InitiateForgotPassword(c.Request.Context(), b.Email)
		return toMap(r), err
	}))
	a.POST("/forgot-password/verify-otp", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b otpDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.VerifyForgotOTP(c.Request.Context(), b.Email, b.OTP)
	}))
	a.POST("/forgot-password/reset", h.wrap(func(c *gin.Context) (map[string]any, error) {
		var b resetDTO
		if !response.Bind(c, &b) {
			return nil, nil
		}
		return h.svc.ResetPassword(c.Request.Context(), b.ResetToken, b.Password, b.ConfirmPassword)
	}))

	g := a.Group("/google")
	g.GET("", func(c *gin.Context) {
		c.Redirect(http.StatusFound, h.svc.GoogleStartURL("telemex"))
	})
	g.GET("/callback", func(c *gin.Context) {
		params, err := h.svc.HandleGoogleCallback(c.Request.Context(), c.Query("code"))
		if err != nil {
			c.Redirect(http.StatusFound, h.svc.GoogleRedirectURL(h.frontend,
				auth.ErrorParams("Google sign-in failed")))
			return
		}
		c.Redirect(http.StatusFound, h.svc.GoogleRedirectURL(h.frontend, params))
	})
}

// wrap adapts a service call into a 200-envelope handler. A nil map with nil
// error means Bind already wrote the validation response.
func (h *Handler) wrap(fn func(*gin.Context) (map[string]any, error)) gin.HandlerFunc {
	return h.wrapStatus(http.StatusOK, fn)
}

func (h *Handler) wrapStatus(status int, fn func(*gin.Context) (map[string]any, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := fn(c)
		if err != nil {
			h.fail(c, err)
			return
		}
		if data == nil {
			return
		}
		h.ok(c, status, data)
	}
}

func toMap(r auth.OTPResult) map[string]any {
	m := map[string]any{
		"message": r.Message, "email": r.Email,
		"expires_in_minutes": r.ExpiresInMinutes, "cooldown_seconds": r.CooldownSeconds,
	}
	if r.OTP != "" {
		m["otp"] = r.OTP
	}
	return m
}
