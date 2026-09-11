// Package video implements the Daily.co video room + token flows (M16).
// It ports health-app/src/video/video.service.ts: room creation with
// adoption, meeting tokens, timing windows, retry/backoff, and session
// start/end semantics. Disabled Daily (empty key) yields a controlled 503
// on the token endpoints only — start/end touch no Daily endpoint.
package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Timing gates. Two different gates enforce the early bound and they must
// agree: the API check below rejects the call, and the Daily room's own
// `nbf` rejects the join. Nbf is derived from EarlyJoinGrace so they cannot
// drift apart (Nest parity: EARLY_JOIN_GRACE_MS / ROOM_OVERRUN_MS).
const (
	EarlyJoinGrace = 10 * time.Minute
	RoomOverrun    = 30 * time.Minute
)

// Daily caps meeting-token `user_id` at 36 characters.
const MaxUserIDLength = 36

// Retry budget for Daily calls: 3 attempts, 200ms base. Timeouts are
// excluded from retry (the client already waited 10s; retrying stalls a
// doctor mid-appointment). Honours Retry-After when Daily sends one.
const (
	MaxAttempts = 3
	RetryBase   = 200 * time.Millisecond
	DailyBase   = "https://api.daily.co/v1"
	HTTPTimeout = 10 * time.Second
)

// Room is the persisted subset of a Daily room.
type Room struct {
	Name string
	URL  string
	Exp  int64
}

// StatusError carries the HTTP status of a failed Daily call so the
// service can adopt an existing room on 400 (deterministic names).
type StatusError struct {
	Status     int
	RetryAfter int
	Body       string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("daily: status %d", e.Status)
}

// ErrRoomNotFound is returned by GetRoom on 404.
type ErrNotFound struct{}

func (ErrNotFound) Error() string { return "daily: room not found" }

// Provider talks to Daily.co. FakeProvider in tests substitutes it.
type Provider interface {
	CreateRoom(ctx context.Context, name string, nbf, exp int64) (Room, error)
	GetRoom(ctx context.Context, name string) (Room, error)
	CreateMeetingToken(ctx context.Context, roomName string, isOwner bool, userName, userID string, exp int64) (string, error)
}

// HTTPDaily is the production Daily.co client.
type HTTPDaily struct {
	key  string
	base string
	http *http.Client
}

// NewDaily builds the production client. An empty key means unconfigured —
// the service maps that to 503 before any Daily call happens.
func NewDaily(key string) *HTTPDaily {
	return NewDailyWithBase(key, DailyBase)
}

// NewDailyWithBase allows tests to point at a stub server.
func NewDailyWithBase(key, base string) *HTTPDaily {
	return &HTTPDaily{key: key, base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: HTTPTimeout}}
}

// Configured reports whether Daily calls can be attempted.
func (d *HTTPDaily) Configured() bool { return strings.TrimSpace(d.key) != "" }

// CreateRoom creates a private 2-participant room.
func (d *HTTPDaily) CreateRoom(ctx context.Context, name string, nbf, exp int64) (Room, error) {
	body := map[string]any{
		"name": name, "privacy": "private",
		"properties": map[string]any{
			"nbf": nbf, "exp": exp,
			"max_participants":  2,
			"enable_knocking":   false,
			"eject_at_room_exp": true,
		},
	}
	var parsed struct {
		Name   string `json:"name"`
		URL    string `json:"url"`
		Config *struct {
			Exp *int64 `json:"exp"`
		} `json:"config"`
	}
	if err := d.do(ctx, http.MethodPost, "/rooms", body, &parsed); err != nil {
		return Room{}, err
	}
	roomExp := exp
	if parsed.Config != nil && parsed.Config.Exp != nil {
		roomExp = *parsed.Config.Exp
	}
	return Room{Name: parsed.Name, URL: parsed.URL, Exp: roomExp}, nil
}

// GetRoom fetches a room by name (adoption path). 404 maps to ErrNotFound.
func (d *HTTPDaily) GetRoom(ctx context.Context, name string) (Room, error) {
	var parsed struct {
		Name   string `json:"name"`
		URL    string `json:"url"`
		Config *struct {
			Exp *int64 `json:"exp"`
		} `json:"config"`
	}
	err := d.do(ctx, http.MethodGet, "/rooms/"+url.PathEscape(name), nil, &parsed)
	if se, ok := err.(*StatusError); ok && se.Status == http.StatusNotFound {
		return Room{}, ErrNotFound{}
	}
	if err != nil {
		return Room{}, err
	}
	roomExp := int64(0)
	if parsed.Config != nil && parsed.Config.Exp != nil {
		roomExp = *parsed.Config.Exp
	}
	return Room{Name: parsed.Name, URL: parsed.URL, Exp: roomExp}, nil
}

// CreateMeetingToken mints an owner (doctor) or guest (patient) token.
func (d *HTTPDaily) CreateMeetingToken(ctx context.Context, roomName string, isOwner bool, userName, userID string, exp int64) (string, error) {
	if len(userID) > MaxUserIDLength {
		userID = userID[:MaxUserIDLength]
	}
	body := map[string]any{
		"properties": map[string]any{
			"room_name": roomName, "is_owner": isOwner,
			"user_name": userName, "user_id": userID,
			"exp": exp, "eject_at_token_exp": true,
		},
	}
	var parsed struct {
		Token string `json:"token"`
	}
	if err := d.do(ctx, http.MethodPost, "/meeting-tokens", body, &parsed); err != nil {
		return "", err
	}
	// A 2xx with no token would put undefined in the response and fail in
	// the client as an unjoinable call — fail here, near the cause.
	if strings.TrimSpace(parsed.Token) == "" {
		return "", fmt.Errorf("daily: empty meeting token")
	}
	return parsed.Token, nil
}

func (d *HTTPDaily) do(ctx context.Context, method, path string, body any, out any) error {
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	var lastErr error
	for attempt := 1; ; attempt++ {
		status, retryAfter, respBody, netErr, err := d.roundTrip(ctx, method, path, raw)
		if err == nil {
			if out != nil && len(respBody) > 0 {
				if jerr := json.Unmarshal(respBody, out); jerr != nil {
					return jerr
				}
			}
			return nil
		}
		lastErr = err
		if attempt >= MaxAttempts || !shouldRetry(status, netErr) {
			return err
		}
		wait := retryDelay(retryAfter, attempt)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
		_ = lastErr
	}
}

func (d *HTTPDaily) roundTrip(ctx context.Context, method, path string, raw []byte) (status, retryAfter int, respBody []byte, netErr error, err error) {
	var rdr io.Reader
	if raw != nil {
		rdr = bytes.NewReader(raw)
	}
	req, rerr := http.NewRequestWithContext(ctx, method, d.base+path, rdr)
	if rerr != nil {
		return 0, 0, nil, rerr, rerr
	}
	req.Header.Set("Authorization", "Bearer "+d.key)
	req.Header.Set("Content-Type", "application/json")
	resp, rerr := d.http.Do(req)
	if rerr != nil {
		return 0, 0, nil, rerr, rerr
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.StatusCode, 0, data, nil, nil
	}
	ra := 0
	if v := resp.Header.Get("Retry-After"); v != "" {
		if n, cerr := strconv.Atoi(strings.TrimSpace(v)); cerr == nil && n > 0 {
			ra = n
		}
	}
	return resp.StatusCode, ra, nil, nil, &StatusError{Status: resp.StatusCode, RetryAfter: ra, Body: string(data)}
}

// shouldRetry retries only what a second attempt can plausibly fix: 429 +
// 5xx, and fast-failing network errors. Timeouts (already burned 10s) and
// deterministic 4xx are surfaced immediately.
func shouldRetry(status int, netErr error) bool {
	if netErr != nil {
		if isTimeout(netErr) {
			return false
		}
		return true
	}
	return status == http.StatusTooManyRequests || status >= 500
}

func isTimeout(err error) bool {
	var nerr net.Error
	if ok := errors.As(err, &nerr); ok && nerr.Timeout() {
		return true
	}
	// net/http wraps timeouts in *url.Error with Timeout() true — covered
	// above; match the message as a backstop for custom transports.
	return strings.Contains(strings.ToLower(err.Error()), "timeout")
}

func retryDelay(retryAfter, attempt int) time.Duration {
	if retryAfter > 0 {
		return time.Duration(retryAfter) * time.Second
	}
	backoff := RetryBase * time.Duration(1<<(attempt-1))
	return backoff + time.Duration(rand.Intn(int(RetryBase)))
}
