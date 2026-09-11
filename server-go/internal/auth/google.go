package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/mrn"
)

// googleProfile is the subset of the Google userinfo response we use.
type googleProfile struct {
	Email      string `json:"email"`
	GivenName  string `json:"given_name"`
	FamilyName string `json:"family_name"`
	Picture    string `json:"picture"`
}

// FetchGoogleProfile exchanges nothing — it fetches userinfo for an access
// token. It is a var so tests can stub Google out.
var FetchGoogleProfile = func(ctx context.Context, accessToken string) (googleProfile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return googleProfile{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return googleProfile{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return googleProfile{}, fmt.Errorf("google userinfo: %s", resp.Status)
	}
	var p googleProfile
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return googleProfile{}, err
	}
	return p, nil
}

func (s *Service) oauthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     s.Google.ClientID,
		ClientSecret: s.Google.ClientSecret,
		RedirectURL:  s.Google.CallbackURL,
		Scopes:       []string{"email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

// GoogleStartURL returns the consent redirect. Empty client ID means OAuth
// is unconfigured (the HTTP layer blocks with the feature flag first).
func (s *Service) GoogleStartURL(state string) string {
	return s.oauthConfig().AuthCodeURL(state, oauth2.AccessTypeOffline)
}

// GoogleRedirectURL builds the frontend landing URL (success or error),
// mirroring the Nest callback: /auth/google?token=&refresh_token=&role=
// or ?error=.
func (s *Service) GoogleRedirectURL(base string, params url.Values) string {
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	u = u.JoinPath("/auth/google")
	q := u.Query()
	for k, vs := range params {
		for _, v := range vs {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// HandleGoogleCallback exchanges the code, resolves the profile, and
// finds-or-creates the patient. Doctor/admin email collisions are rejected
// (patients-only OAuth, Nest parity). Returns redirect query params.
func (s *Service) HandleGoogleCallback(ctx context.Context, code string) (url.Values, error) {
	tok, err := s.oauthConfig().Exchange(ctx, code)
	if err != nil {
		return ErrorParams("oauth exchange failed"), nil
	}
	profile, err := FetchGoogleProfile(ctx, tok.AccessToken)
	if err != nil || profile.Email == "" {
		return ErrorParams("could not read Google profile"), nil
	}
	email := lower(profile.Email)
	if _, err := s.q().GetDoctorByEmail(ctx, email); err == nil {
		return ErrorParams("This email is registered as a doctor. Google sign-in is only available for patients."), nil
	}
	if _, err := s.q().GetAdminByEmail(ctx, email); err == nil {
		return ErrorParams("This email is registered as an admin. Google sign-in is only available for patients."), nil
	}
	user, created := s.findOrCreateGooglePatient(ctx, email, profile)
	if user == nil {
		return ErrorParams("Could not create patient account"), nil
	}
	access, refresh, err := s.mintSession(user.ID.String(), email, RolePatient)
	if err != nil {
		return ErrorParams("Could not issue session"), nil
	}
	if err := s.q().SetPatientRefreshHash(ctx, setPatientHash(user.ID, refresh.hash)); err != nil {
		return ErrorParams("Could not issue session"), nil
	}
	if created {
		subject, body := s.Copy.Welcome(RolePatient)
		s.sendMail(email, subject, body(profile.GivenName))
	}
	out := url.Values{}
	out.Set("token", access)
	out.Set("refresh_token", refresh.token)
	out.Set("role", "patient")
	return out, nil
}

// ErrorParams builds a redirect ?error= query.
func ErrorParams(msg string) url.Values {
	out := url.Values{}
	out.Set("error", msg)
	return out
}

func setPatientHash(id pgtype.UUID, hash string) gen.SetPatientRefreshHashParams {
	return gen.SetPatientRefreshHashParams{ID: id, RefreshTokenHash: text(hash)}
}

// findOrCreateGooglePatient returns the patient and whether it was created.
func (s *Service) findOrCreateGooglePatient(ctx context.Context, email string, p googleProfile) (*gen.Patient, bool) {
	if existing, err := s.q().GetPatientByEmail(ctx, email); err == nil {
		_ = s.q().SetPatientProviderVerified(ctx, gen.SetPatientProviderVerifiedParams{
			ID: existing.ID, Provider: "GOOGLE",
		})
		if p.Picture != "" && !existing.ProfilePictureUrl.Valid {
			_, _ = s.DB.Inner().Exec(ctx,
				"UPDATE patients SET profile_picture_url = $2 WHERE id = $1 AND profile_picture_url IS NULL",
				existing.ID, p.Picture)
		}
		fresh, err := s.q().GetPatientByEmail(ctx, email)
		if err != nil {
			return nil, false
		}
		return &fresh, false
	}
	mrnValue, err := mrn.Generate(ctx, s.q(), "patient")
	if err != nil {
		return nil, false
	}
	var created gen.Patient
	for i := 0; i < 5; i++ {
		regNo, err := RegistrationNo()
		if err != nil {
			return nil, false
		}
		created, err = s.q().CreatePatient(ctx, gen.CreatePatientParams{
			RegistrationNo: regNo, Mrn: text(mrnValue),
			FirstName: orDefault(p.GivenName, "Patient"),
			LastName:  orDefault(p.FamilyName, "User"),
			FullName:  text(orDefault(p.GivenName, "Patient") + " " + orDefault(p.FamilyName, "User")),
			Email:     email, Provider: "GOOGLE", Verified: true,
			ProfilePictureUrl: text(p.Picture),
			PasswordHash:      pgtype.Text{}, RefreshTokenHash: pgtype.Text{},
		})
		if err == nil {
			break
		}
		if !isUniqueViolation(err) || i == 4 {
			return nil, false
		}
	}
	mrn.Claim(ctx, s.q(), mrnValue, created.ID.String())
	return &created, true
}

func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}
