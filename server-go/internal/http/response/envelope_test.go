package response

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func testCtx() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/x", nil)
	c.Set("requestID", "test-req-id")
	return c, w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) Envelope {
	t.Helper()
	var env Envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("not an envelope: %v (%s)", err, w.Body.String())
	}
	return env
}

func TestFailValidationShape(t *testing.T) {
	c, w := testCtx()
	FailValidation(c, "", []string{"email: failed required validation", "password: failed min validation"})
	env := decode(t, w)
	if w.Code != 400 || !env.Success == false {
		t.Errorf("status/success: got %d success=%v", w.Code, env.Success)
	}
	if env.ResponseCode != "006" {
		t.Errorf("code = %q, want 006", env.ResponseCode)
	}
	msgs, ok := env.Message.([]any)
	if !ok || len(msgs) != 2 {
		t.Errorf("message = %#v, want 2-detail array", env.Message)
	}
	if env.ResponseDescription != "email: failed required validation" {
		t.Errorf("description = %q, want first detail", env.ResponseDescription)
	}
	if env.RequestID == nil || *env.RequestID != "test-req-id" {
		t.Errorf("request_id = %v", env.RequestID)
	}
	if env.Path == nil || env.Timestamp == "" {
		t.Error("path/timestamp missing")
	}
}

func TestBindRejectsBadJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/x",
		jsonBody(`{"email":"not-an-email"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("requestID", "r1")

	var body struct {
		Email string `json:"email" binding:"required,email"`
	}
	if Bind(c, &body) {
		t.Error("Bind accepted invalid email, want false")
	}
	env := decode(t, w)
	if w.Code != 400 || env.ResponseCode != "006" {
		t.Errorf("got %d %q, want 400/006", w.Code, env.ResponseCode)
	}
}

func jsonBody(s string) *strings.Reader { return strings.NewReader(s) }
