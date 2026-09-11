package admin

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves admin routes (all ADMIN role).
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

// Register mounts /admin routes. :id stays last (route-ordering rule).
func (h *Handler) Register(rg *gin.RouterGroup) {
	a := rg.Group("/admin")
	a.Use(middleware.Authenticate(h.issuer, h.users, auth.RoleAdmin))

	a.POST("/doctors", h.createDoctor)
	a.GET("/patients", h.listPatients)
	a.GET("/patients/:id", h.patientDetail)
	a.GET("/doctors", h.listDoctors)
	a.GET("/metrics", h.metrics)
}

type createDoctorDTO struct {
	Email       string `json:"email" binding:"required,email"`
	FirstName   string `json:"first_name" binding:"required"`
	LastName    string `json:"last_name" binding:"required"`
	Password    string `json:"password" binding:"required"`
	PhoneNumber string `json:"phone_number"`
}

func (h *Handler) createDoctor(c *gin.Context) {
	var b createDoctorDTO
	if !response.Bind(c, &b) {
		return
	}
	data, err := h.svc.CreateDoctor(c.Request.Context(), DoctorInput{
		FirstName: b.FirstName, LastName: b.LastName, Email: b.Email,
		PhoneNumber: b.PhoneNumber, Password: b.Password,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	// Description is 'Doctor created successfully', not 'Success' (Nest parity).
	response.Success(c, http.StatusCreated, data, "Doctor created successfully")
}

func pageLimit(c *gin.Context, defLimit int) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit == 0 {
		limit, _ = strconv.Atoi(c.Query("perPage"))
	}
	if limit == 0 {
		limit = defLimit
	}
	return page, limit
}

func (h *Handler) listPatients(c *gin.Context) {
	page, limit := pageLimit(c, 20)
	data, err := h.svc.ListPatients(c.Request.Context(), c.Query("q"), page, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientDetail(c *gin.Context) {
	data, err := h.svc.PatientDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) listDoctors(c *gin.Context) {
	page, limit := pageLimit(c, 20)
	data, err := h.svc.ListDoctors(c.Request.Context(), page, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) metrics(c *gin.Context) {
	data, err := h.svc.Metrics(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}
