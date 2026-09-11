// Package files abstracts object-storage uploads behind a Provider.
// Cloudinary is used when configured; otherwise every upload fails with a
// controlled 503 ("Cloudinary is not configured", Nest parity) instead of
// a 500. Profile pictures land in the profile folder (512px limit);
// investigation result images land in the investigation folder (2000px
// limit, no overwrite — each upload is a distinct clinical artifact).
package files

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Provider uploads images and returns their public URLs.
type Provider interface {
	UploadProfileImage(ctx context.Context, data []byte, contentType, userType, userID string) (string, error)
	UploadInvestigationImage(ctx context.Context, data []byte, contentType, patientID, listID string) (string, error)
}

// Upload is one file's bytes plus its claimed content type.
type Upload struct {
	Data        []byte
	ContentType string
	Filename    string
}

// Disabled is returned when Cloudinary is not configured.
type Disabled struct{}

func (Disabled) UploadProfileImage(_ context.Context, _ []byte, _, _, _ string) (string, error) {
	return "", ErrNotConfigured
}

func (Disabled) UploadInvestigationImage(_ context.Context, _ []byte, _, _, _ string) (string, error) {
	return "", ErrNotConfigured
}

// ErrNotConfigured maps to 503 (was ServiceUnavailableException).
type configurationError struct{ msg string }

func (e *configurationError) Error() string { return e.msg }

var ErrNotConfigured = &configurationError{"Cloudinary is not configured"}

// IsNotConfigured reports the controlled 503 case.
func IsNotConfigured(err error) bool { return err == ErrNotConfigured }

// Config for the Cloudinary provider. Folders default when empty.
type Config struct {
	CloudName, APIKey, APISecret string
	Folder                       string
	InvestigationFolder          string
}

// Validate reports which required credentials are missing. Empty means
// fully configured; any entries mean the provider is disabled and uploads
// fail with the controlled 503. Partial config is indistinguishable from
// absent at request time by design (never hint at which secret exists).
func (c Config) Validate() []string {
	var missing []string
	if strings.TrimSpace(c.CloudName) == "" {
		missing = append(missing, "CLOUDINARY_CLOUD_NAME")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		missing = append(missing, "CLOUDINARY_API_KEY")
	}
	if strings.TrimSpace(c.APISecret) == "" {
		missing = append(missing, "CLOUDINARY_API_SECRET")
	}
	return missing
}

// New picks Cloudinary when fully configured, else Disabled.
func New(cfg Config) Provider {
	if len(cfg.Validate()) > 0 {
		return Disabled{}
	}
	if cfg.Folder == "" {
		cfg.Folder = "health-app/profile-pictures"
	}
	if cfg.InvestigationFolder == "" {
		cfg.InvestigationFolder = "health-app/investigation-results"
	}
	return &Cloudinary{cfg: cfg, http: &http.Client{Timeout: 30 * time.Second}}
}

// Fake is an in-memory Provider for tests: uploads succeed with
// deterministic URLs unless Err is set, in which case every call fails.
// Calls records each invocation in order.
type Fake struct {
	Err   error
	Calls []FakeCall
}

// FakeCall describes one Fake upload.
type FakeCall struct {
	Kind              string
	Data              []byte
	ContentType       string
	UserType, UserID  string
	PatientID, ListID string
}

func (f *Fake) UploadProfileImage(_ context.Context, data []byte, contentType, userType, userID string) (string, error) {
	if f.Err != nil {
		return "", f.Err
	}
	f.Calls = append(f.Calls, FakeCall{Kind: "profile", Data: data, ContentType: contentType, UserType: userType, UserID: userID})
	return fmt.Sprintf("https://fake.cloudinary/%s/%s.png", userType, userID), nil
}

func (f *Fake) UploadInvestigationImage(_ context.Context, data []byte, contentType, patientID, listID string) (string, error) {
	if f.Err != nil {
		return "", f.Err
	}
	f.Calls = append(f.Calls, FakeCall{Kind: "investigation", Data: data, ContentType: contentType, PatientID: patientID, ListID: listID})
	return fmt.Sprintf("https://fake.cloudinary/inv/%s/%d.png", listID, len(f.Calls)), nil
}

// Cloudinary uploads via the signed REST API: base64 semantics preserved by
// sending raw bytes as the file part, public_id `{type}-{userID}-{ts}`,
// overwrite, 512px limit + auto quality/format transformations.
type Cloudinary struct {
	cfg  Config
	http *http.Client
}

func (c *Cloudinary) UploadProfileImage(ctx context.Context, data []byte, contentType, userType, userID string) (string, error) {
	if len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return "", fmt.Errorf("files: invalid file payload")
	}
	timestamp := time.Now().Unix()
	// Base64 semantics from Nest are preserved by sending raw bytes as the
	// file part; public_id `{type}-{userID}-{ts}` with overwrite keeps one
	// live picture per account.
	return c.upload(ctx, data, map[string]string{
		"api_key":        c.cfg.APIKey,
		"folder":         c.cfg.Folder,
		"overwrite":      "true",
		"public_id":      fmt.Sprintf("%s-%s-%d", userType, userID, timestamp),
		"resource_type":  "image",
		"timestamp":      fmt.Sprintf("%d", timestamp),
		"transformation": "w_512,h_512,c_limit/q_auto/f_auto",
	})
}

// UploadInvestigationImage stores one result image. Unlike profile
// pictures there is no overwrite: every upload is a distinct artifact,
// named `inv-{listID}-{patientID}-{ts}` in the investigation folder.
func (c *Cloudinary) UploadInvestigationImage(ctx context.Context, data []byte, contentType, patientID, listID string) (string, error) {
	if len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return "", fmt.Errorf("files: invalid file payload")
	}
	timestamp := time.Now().Unix()
	return c.upload(ctx, data, map[string]string{
		"api_key":        c.cfg.APIKey,
		"folder":         c.cfg.InvestigationFolder,
		"public_id":      fmt.Sprintf("inv-%s-%s-%d", listID, patientID, timestamp),
		"resource_type":  "image",
		"timestamp":      fmt.Sprintf("%d", timestamp),
		"transformation": "w_2000,h_2000,c_limit/q_auto/f_auto",
	})
}

func (c *Cloudinary) upload(ctx context.Context, data []byte, params map[string]string) (string, error) {
	params["signature"] = signParams(params, c.cfg.APISecret)

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range params {
		if k == "resource_type" {
			continue
		}
		_ = w.WriteField(k, v)
	}
	fw, err := w.CreateFormFile("file", "upload")
	if err != nil {
		return "", fmt.Errorf("files: %w", err)
	}
	if _, err := fw.Write(data); err != nil {
		return "", fmt.Errorf("files: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("files: %w", err)
	}
	endpoint := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/image/upload", c.cfg.CloudName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return "", fmt.Errorf("files: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("files: upload failed: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("files: upload failed: status %d", resp.StatusCode)
	}
	var parsed struct {
		SecureURL string `json:"secure_url"`
		Error     *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("files: upload failed: bad response")
	}
	if parsed.Error != nil || parsed.SecureURL == "" {
		return "", fmt.Errorf("files: upload failed")
	}
	return parsed.SecureURL, nil
}

// signParams creates the Cloudinary request signature: SHA-1 over the
// sorted `key=value` pairs (excluding file/resource_type/cloud_name) plus
// the API secret.
func signParams(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "file" || k == "resource_type" || k == "cloud_name" || k == "signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for i, k := range keys {
		if i > 0 {
			sb.WriteString("&")
		}
		sb.WriteString(k + "=" + params[k])
	}
	sb.WriteString(secret)
	sum := sha1.Sum([]byte(sb.String()))
	return hex.EncodeToString(sum[:])
}

// PickedFile is one uploaded file candidate.
type PickedFile struct {
	Data        []byte
	ContentType string
	// Oversize marks a present-but-too-large file (reads as failed validation).
	Oversize bool
}

// PickFile returns the first present key in file > image > profile_picture
// order (Nest parity, shared by patient and doctor profile routes).
func PickFile(form *multipart.Form, maxBytes int64) *PickedFile {
	if form == nil {
		return nil
	}
	for _, key := range []string{"file", "image", "profile_picture"} {
		fhs := form.File[key]
		if len(fhs) == 0 {
			continue
		}
		fh := fhs[0]
		if fh.Size > maxBytes {
			return &PickedFile{Oversize: true}
		}
		f, err := fh.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
		f.Close()
		if err != nil || len(data) == 0 {
			continue
		}
		return &PickedFile{Data: data, ContentType: fh.Header.Get("Content-Type")}
	}
	return nil
}
