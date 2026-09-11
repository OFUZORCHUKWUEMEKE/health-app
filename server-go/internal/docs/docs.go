// Package docs serves the OpenAPI specification and Swagger UI (M20+).
// The spec lives beside this package and is embedded into the binary;
// /docs renders it via Swagger UI CDN assets with the spec URL
// same-origin, so only the UI chrome needs internet.
package docs

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

//go:embed openapi.yaml
var specYAML []byte

// Spec returns the raw OpenAPI document.
func Spec() []byte { return specYAML }

// Register mounts /api/v1/openapi.yaml (raw spec) and /docs (Swagger UI).
// /docs lives outside /api/v1 so it never collides with API routes.
func Register(r *gin.Engine) {
	r.GET("/api/v1/openapi.yaml", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", specYAML)
	})
	r.GET("/docs", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerHTML))
	})
}

const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Telemex Go API — Swagger UI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.onload = function () {
  SwaggerUIBundle({
    url: "/api/v1/openapi.yaml",
    dom_id: "#swagger-ui",
    deepLinking: true,
    persistAuthorization: true,
    requestInterceptor: function (req) {
      var token = localStorage.getItem("telemex_jwt") || "";
      if (token && !req.headers["Authorization"]) {
        req.headers["Authorization"] = "Bearer " + token;
      }
      return req;
    }
  });
};
</script>
</body>
</html>`
