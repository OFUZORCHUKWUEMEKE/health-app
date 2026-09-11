package docs

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

func TestSpecParses(t *testing.T) {
	var doc struct {
		OpenAPI string         `yaml:"openapi"`
		Paths   map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(Spec(), &doc); err != nil {
		t.Fatalf("spec does not parse: %v", err)
	}
	if !strings.HasPrefix(doc.OpenAPI, "3.0") {
		t.Errorf("openapi = %q, want 3.0.x", doc.OpenAPI)
	}
	if len(doc.Paths) < 100 {
		t.Errorf("paths = %d, want the full surface (>=100)", len(doc.Paths))
	}
}

func TestRoutesServe(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	Register(e)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/openapi.yaml", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "openapi:") {
		t.Errorf("spec route: got %d", w.Code)
	}
	w = httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/docs", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "swagger-ui") {
		t.Errorf("docs route: got %d", w.Code)
	}
}
