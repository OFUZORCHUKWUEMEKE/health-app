// Package response implements the standard API envelope captured in
// docs/contract/quirks.md. Success and error shapes must stay identical
// to the NestJS contract the React frontend already parses.
package response

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

// Envelope is the wire shape for every API response.
type Envelope struct {
	Success             bool    `json:"success"`
	ResponseCode        string  `json:"response_code"`
	ResponseDescription string  `json:"response_description"`
	Data                any     `json:"data"`
	Message             any     `json:"message,omitempty"`
	RequestID           *string `json:"request_id"`
	Path                *string `json:"path"`
	Timestamp           string  `json:"timestamp"`
}

// CodeForStatus maps an HTTP status to the legacy numeric-string response
// code. Ported from health-app/src/common/filters/exceptions/http-exception.filter.ts.
func CodeForStatus(status int) string {
	switch status {
	case http.StatusNotFound:
		return "004"
	case http.StatusBadRequest:
		return "006"
	case http.StatusBadGateway:
		return "007"
	case http.StatusGatewayTimeout:
		return "008"
	case http.StatusForbidden:
		return "009"
	case http.StatusUnauthorized:
		return "011"
	case http.StatusUnprocessableEntity:
		return "012"
	case http.StatusRequestTimeout:
		return "013"
	case http.StatusRequestURITooLong:
		return "014"
	case http.StatusUnsupportedMediaType:
		return "015"
	case http.StatusNotAcceptable, http.StatusServiceUnavailable:
		return "016"
	case http.StatusNotModified:
		return "017"
	case http.StatusNotImplemented:
		return "018"
	case http.StatusInternalServerError:
		return "An error encountered"
	default:
		return "Internal Server error"
	}
}

func meta(c *gin.Context) (requestID *string, path *string) {
	if v, ok := c.Get("requestID"); ok {
		if s, ok := v.(string); ok {
			requestID = &s
		}
	}
	p := c.Request.URL.RequestURI()
	path = &p
	return requestID, path
}

// Success writes a standard success envelope (HTTP 200/201 chosen by caller
// via status). Description defaults to "Success" when empty.
func Success(c *gin.Context, status int, data any, description string) {
	if description == "" {
		description = "Success"
	}
	rid, path := meta(c)
	c.JSON(status, Envelope{
		Success:             true,
		ResponseCode:        "00",
		ResponseDescription: description,
		Data:                data,
		RequestID:           rid,
		Path:                path,
		Timestamp:           time.Now().UTC().Format(time.RFC3339Nano),
	})
}

// OK is Success with HTTP 200.
func OK(c *gin.Context, data any) {
	Success(c, http.StatusOK, data, "Success")
}

// Fail writes the standard error envelope. message defaults to description
// and may be a string or a validation-detail slice (400 path).
func Fail(c *gin.Context, status int, description string, message any) {
	if description == "" {
		description = http.StatusText(status)
	}
	if message == nil {
		message = description
	}
	rid, path := meta(c)
	c.JSON(status, Envelope{
		Success:             false,
		ResponseCode:        CodeForStatus(status),
		ResponseDescription: description,
		Data:                nil,
		Message:             message,
		RequestID:           rid,
		Path:                path,
		Timestamp:           time.Now().UTC().Format(time.RFC3339Nano),
	})
}

// FailValidation writes the 400 envelope for request validation failures.
// details is the per-field message array the frontend reads from `message`
// (mirrors BadRequestException through HttpExceptionFilter); description
// defaults to the first detail.
func FailValidation(c *gin.Context, description string, details []string) {
	if description == "" && len(details) > 0 {
		description = details[0]
	}
	if description == "" {
		description = "Bad Request"
	}
	Fail(c, http.StatusBadRequest, description, details)
}

// Bind binds the JSON body into obj. On failure it writes FailValidation
// with one detail per broken field ("field: rule") and returns false.
func Bind(c *gin.Context, obj any) bool {
	if err := c.ShouldBindJSON(obj); err != nil {
		FailValidation(c, "Validation failed", validationDetails(err))
		return false
	}
	return true
}

func validationDetails(err error) []string {
	var out []string
	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range verrs {
			out = append(out, fe.Field()+": failed "+fe.Tag()+" validation")
		}
		return out
	}
	return []string{err.Error()}
}
