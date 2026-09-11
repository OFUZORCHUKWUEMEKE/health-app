package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wizzyszn/Telemex/internal/config"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

func deps(t *testing.T) Deps {
	t.Helper()
	return Deps{Config: config.Config{}}
}

func get(e interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
}, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestVersionEndpoint(t *testing.T) {
	e := New(deps(t))
	w := get(e, "/api/v1/version")
	if w.Code != 200 {
		t.Fatalf("version: got %d %s", w.Code, w.Body.String())
	}
	var env struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || !env.Success {
		t.Fatalf("version envelope: %v %s", err, w.Body.String())
	}
	for _, k := range []string{"service", "version", "commit", "built_at"} {
		if env.Data[k] == nil || env.Data[k] == "" {
			t.Errorf("version data missing %q: %v", k, env.Data)
		}
	}
}

func TestReadyzWithoutDatabase(t *testing.T) {
	e := New(deps(t))
	w := get(e, "/api/v1/readyz")
	if w.Code != 503 {
		t.Fatalf("readyz without db: got %d, want 503", w.Code)
	}
}

func TestReadyzWithDatabaseReportsPool(t *testing.T) {
	pool := testdb.Setup(t)
	d := deps(t)
	d.Pool = pool
	e := New(d)
	w := get(e, "/api/v1/readyz")
	if w.Code != 200 {
		t.Fatalf("readyz: got %d %s", w.Code, w.Body.String())
	}
	var env struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	p, _ := env.Data["pool"].(map[string]any)
	if p == nil {
		t.Fatalf("readyz data has no pool stats: %v", env.Data)
	}
	for _, k := range []string{"total", "idle", "acquired"} {
		if p[k] == nil {
			t.Errorf("pool stats missing %q: %v", k, p)
		}
	}
}
