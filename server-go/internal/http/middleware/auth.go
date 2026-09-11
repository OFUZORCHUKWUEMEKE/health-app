package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/response"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// CurrentUser is the authenticated identity injected into the request
// context. It mirrors req.user + req.userRole from RolesGuard.
type CurrentUser struct {
	ID    string
	Email string
	Role  string
}

// ResolvedUser is one account row looked up by role + email.
type ResolvedUser struct {
	Found  bool
	ID     string
	Email  string
	Role   string
	Active bool // doctors only; always true for other roles
}

// UserResolver maps (role, email) to an account row. The pg implementation
// below is used in production; tests may substitute a stub.
type UserResolver interface {
	ResolveUser(ctx context.Context, role, email string) (ResolvedUser, error)
}

// DBResolver resolves accounts against patients/doctors/admins by email,
// exactly like RolesGuard.resolveUser (lookup by email, not sub).
type DBResolver struct {
	pool *postgres.Pool
}

// NewDBResolver builds the production resolver. A nil pool rejects every
// request with 401 instead of panicking (fail closed without a database).
func NewDBResolver(pool *postgres.Pool) *DBResolver { return &DBResolver{pool: pool} }

// ResolveUser implements UserResolver.
func (r *DBResolver) ResolveUser(ctx context.Context, role, email string) (ResolvedUser, error) {
	if r.pool == nil {
		return ResolvedUser{}, nil
	}
	var id string
	var active bool
	// Per-table queries stay column-exact (only doctors has active).
	var query string
	switch role {
	case auth.RoleDoctor:
		query = "SELECT id::text, active FROM doctors WHERE email = $1"
	case auth.RolePatient:
		query = "SELECT id::text, true FROM patients WHERE email = $1"
	case auth.RoleAdmin:
		query = "SELECT id::text, true FROM admins WHERE email = $1"
	default:
		return ResolvedUser{}, nil
	}
	err := r.pool.Inner().QueryRow(ctx, query, strings.ToLower(email)).Scan(&id, &active)
	if err != nil {
		return ResolvedUser{}, nil // not found (or DB hiccup) -> 401, never 500
	}
	return ResolvedUser{Found: true, ID: id, Email: strings.ToLower(email), Role: role, Active: active}, nil
}

// Authenticate verifies the Bearer access token, resolves the account, and
// injects CurrentUser. With roles given it enforces membership; without, any
// authenticated identity passes (mirrors @Roles()-less handlers).
//
// Status semantics preserve Nest verbatim, including role mismatch as 401:
//   - no token → 401 "Missing authorization token"
//   - bad token → 401 "Invalid or expired token"
//   - no role claim → 401 "Token is missing role claim"
//   - unknown account → 401 "User not found or account deactivated"
//   - inactive doctor → 401 "Doctor account is deactivated"
//   - wrong role → 401 "Access denied. Required roles: ..."
//
// All in the standard 011 error envelope.
func Authenticate(iss *auth.Issuer, resolver UserResolver, roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			unauthorized(c, "Missing authorization token")
			return
		}
		claims, err := iss.VerifyAccess(token)
		if err != nil {
			unauthorized(c, "Invalid or expired token")
			return
		}
		if strings.TrimSpace(claims.Role) == "" {
			unauthorized(c, "Token is missing role claim")
			return
		}
		user, err := resolver.ResolveUser(c.Request.Context(), claims.Role, claims.Email)
		if err != nil || !user.Found {
			unauthorized(c, "User not found or account deactivated")
			return
		}
		if user.Role == auth.RoleDoctor && !user.Active {
			unauthorized(c, "Doctor account is deactivated")
			return
		}
		if len(roles) > 0 && !hasRole(roles, user.Role) {
			unauthorized(c, "Access denied. Required roles: "+strings.Join(roles, ", "))
			return
		}
		c.Set("user", CurrentUser{ID: user.ID, Email: user.Email, Role: user.Role})
		c.Set("userRole", user.Role)
		c.Next()
	}
}

// RequireAnyAuth authenticates without a role restriction.
func RequireAnyAuth(iss *auth.Issuer, resolver UserResolver) gin.HandlerFunc {
	return Authenticate(iss, resolver)
}

// CurrentUserFrom returns the identity injected by Authenticate.
func CurrentUserFrom(c *gin.Context) (CurrentUser, bool) {
	v, ok := c.Get("user")
	if !ok {
		return CurrentUser{}, false
	}
	u, ok := v.(CurrentUser)
	return u, ok
}

func unauthorized(c *gin.Context, description string) {
	response.Fail(c, http.StatusUnauthorized, description, description)
	c.Abort()
}

func bearerToken(header string) string {
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func hasRole(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}
