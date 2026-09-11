// Command load drives the M20 load suite against a running API: it seeds a
// doctor + one patient per VU, then hammers the frontend-used endpoints
// (login, refresh, availability, slots, booking, listings, history, meds,
// referrals, notifications) with configurable concurrency and asserts
// p95 + error thresholds.
//
//	# seed once, then run 10 VUs for 60s against local API:
//	go run ./load -base-url http://localhost:4000 \
//	  -database-url postgres://postgres@localhost:5433/telemex?sslmode=disable \
//	  -seed -vus 10 -duration 60s
//
// Prerequisites on the target server: default feature flags on, and (for
// seeding) direct database access. Load rows are namespaced with the
// -prefix so reruns never collide; -cleanup deletes them afterwards.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/wizzyszn/Telemex/internal/auth"
)

var (
	baseURL  = flag.String("base-url", "http://localhost:4000", "API base URL")
	dbURL    = flag.String("database-url", "", "Postgres URL (seeding only)")
	seed     = flag.Bool("seed", false, "create doctor + VU patients before loading")
	cleanup  = flag.Bool("cleanup", false, "delete seeded rows and exit")
	prefix   = flag.String("prefix", "load", "email namespace for seeded users")
	vus      = flag.Int("vus", 10, "concurrent virtual users")
	duration = flag.Duration("duration", 60*time.Second, "load duration")
	p95ms    = flag.Int("p95-ms", 1000, "fail when any endpoint p95 exceeds this (ms)")
	maxErrs  = flag.Int("max-errors", 0, "fail when total errors exceed this")
	client   = &http.Client{Timeout: 15 * time.Second}
)

type sample struct {
	endpoint string
	took     time.Duration
	err      bool
}

type collector struct {
	mu   sync.Mutex
	byEP map[string][]time.Duration
	errs map[string]int
}

func (c *collector) add(s sample) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if s.err {
		c.errs[s.endpoint]++
		return
	}
	c.byEP[s.endpoint] = append(c.byEP[s.endpoint], s.took)
}

func percentile(ds []time.Duration, p float64) time.Duration {
	if len(ds) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), ds...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	return cp[int(p*float64(len(cp)-1))]
}

func do(method, path, token string, body any) (map[string]any, int, error) {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, *baseURL+path, rdr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if jerr := json.Unmarshal(raw, &env); jerr != nil {
		return nil, resp.StatusCode, fmt.Errorf("non-envelope %d: %s", resp.StatusCode, truncate(raw))
	}
	if !env.Success {
		return nil, resp.StatusCode, fmt.Errorf("api error %d: %s", resp.StatusCode, truncate(raw))
	}
	var data map[string]any
	_ = json.Unmarshal(env.Data, &data)
	return data, resp.StatusCode, nil
}

func truncate(b []byte) string {
	if len(b) > 300 {
		return string(b[:300]) + "…"
	}
	return string(b)
}

func timed(c *collector, endpoint string, fn func() error) {
	start := time.Now()
	if err := fn(); err != nil {
		c.add(sample{endpoint: endpoint, err: true})
		return
	}
	c.add(sample{endpoint: endpoint, took: time.Since(start)})
}

func mustLogin(email, password, role string) (token, refresh, id string) {
	path := "/api/v1/auth/" + role + "s/login"
	data, _, err := do("POST", path, "", map[string]string{"email": email, "password": password})
	if err != nil {
		fatalf("login %s: %v", email, err)
	}
	userKey := map[string]string{"patient": "user", "doctor": "doctor"}[role]
	id, _ = data[userKey].(map[string]any)["_id"].(string)
	token, _ = data["token"].(string)
	// Login envelopes use refresh_token; accept either spelling.
	refresh, _ = data["refresh_token"].(string)
	if refresh == "" {
		refresh, _ = data["refreshToken"].(string)
	}
	if token == "" || id == "" {
		fatalf("login %s: missing token/id in %v", email, data)
	}
	return token, refresh, id
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "load: "+format+"\n", args...)
	os.Exit(1)
}

func dbConn(ctx context.Context) *pgx.Conn {
	conn, err := pgx.Connect(ctx, *dbURL)
	if err != nil {
		fatalf("db connect: %v", err)
	}
	return conn
}

func seedAll() {
	if *dbURL == "" {
		fatalf("-database-url is required with -seed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	conn := dbConn(ctx)
	defer conn.Close(ctx)

	docEmail := *prefix + "-doctor@example.com"
	hash, err := auth.HashPassword("LoadPass123!")
	if err != nil {
		fatalf("hash: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO doctors (doctor_no, first_name, last_name, email, password_hash, active)
		VALUES ('LOAD-DOC', 'Load', 'Doctor', $1, $2, true)
		ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
		docEmail, hash)
	if err != nil {
		fatalf("seed doctor: %v", err)
	}
	docTok, _, docID := mustLogin(docEmail, "LoadPass123!", "doctor")
	if _, _, err := do("POST", "/api/v1/booking/doctors/me/availability/test-24-7?timezone=UTC", docTok, nil); err != nil {
		fatalf("seed availability: %v", err)
	}
	// Wipe prior load bookings so slot sequences restart collision-free.
	like := *prefix + "-%@example.com"
	_, _ = conn.Exec(ctx, `DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE $1)
		OR doctor_id IN (SELECT id FROM doctors WHERE email LIKE $1)`, like)
	for i := 0; i < *vus; i++ {
		email := fmt.Sprintf("%s-patient-%d@example.com", *prefix, i)
		_, code, err := do("POST", "/api/v1/auth/patients/signup", "", map[string]string{
			"first_name": "Load", "last_name": fmt.Sprintf("Patient%d", i),
			"email": email, "password": "LoadPass123!",
		})
		if err != nil && code != 409 && code != 400 {
			fatalf("seed patient %d: %v", i, err)
		}
	}
	fmt.Printf("load: seeded doctor %s (+24/7 availability) and %d patients\n", docEmail, *vus)
	_ = docID
}

func cleanupAll() {
	if *dbURL == "" {
		fatalf("-database-url is required with -cleanup")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	conn := dbConn(ctx)
	defer conn.Close(ctx)
	like := *prefix + "-%@example.com"
	_, _ = conn.Exec(ctx, `DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE $1)
		OR doctor_id IN (SELECT id FROM doctors WHERE email LIKE $1)`, like)
	_, _ = conn.Exec(ctx, `DELETE FROM consultations WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE $1)
		OR doctor_id IN (SELECT id FROM doctors WHERE email LIKE $1)`, like)
	_, _ = conn.Exec(ctx, `DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM patients WHERE email LIKE $1)`, like)
	_, _ = conn.Exec(ctx, `DELETE FROM patients WHERE email LIKE $1`, like)
	_, _ = conn.Exec(ctx, `DELETE FROM doctors WHERE email LIKE $1`, like)
	fmt.Println("load: cleaned seeded rows")
}

var bookSeq int64
var bookErrLogged int64

func scenario(stop <-chan struct{}, c *collector, vu int, docID string) {
	email := fmt.Sprintf("%s-patient-%d@example.com", *prefix, vu)
	tok, refresh, _ := mustLogin(email, "LoadPass123!", "patient")
	tomorrow := time.Now().Add(24 * time.Hour).UTC().Format("2006-01-02")
	dayAfter := time.Now().Add(48 * time.Hour).UTC()
	iter := 0
	for {
		select {
		case <-stop:
			return
		default:
		}
		iter++
		// Booking slots come from a global counter so no two VUs (or
		// iterations) ever collide on the per-doctor double-book guard.
		// Reads probe the booking itself every iteration. Slots stay
		// inside 01:00–17:00 UTC (64/day) to avoid availability edges.
		n := atomic.AddInt64(&bookSeq, 1) - 1
		slot := dayAfter.Truncate(24 * time.Hour).
			Add(time.Duration(n/64)*24*time.Hour + time.Duration(4+n%64)*15*time.Minute)
		bookBody := map[string]any{
			"first_name": "Load", "last_name": fmt.Sprintf("Patient%d", vu),
			"present_complaint": "Load check", "doctor_id": docID,
			"scheduled_start_local": slot.Format("2006-01-02T15:04"),
			"timezone":              "UTC", "requested_duration_minutes": 15,
			"confirm_appointment": true,
		}
		availAt := slot.Format("2006-01-02T15:04")
		timed(c, "login", func() error {
			t, r, _ := mustLogin(email, "LoadPass123!", "patient")
			tok, refresh = t, r
			return nil
		})
		timed(c, "refresh", func() error {
			data, _, err := do("POST", "/api/v1/auth/refresh", "", map[string]string{"refreshToken": refresh, "role": "patient"})
			if err == nil {
				// Refresh answers camelCase (accessToken/refreshToken);
				// login answers snake_case. Accept both.
				if r, ok := data["refreshToken"].(string); ok && r != "" {
					refresh = r
				} else if r, ok := data["refresh_token"].(string); ok && r != "" {
					refresh = r
				}
			}
			return err
		})
		timed(c, "availability", func() error {
			_, _, err := do("GET", "/api/v1/booking/doctors/"+docID+"/check-availability?datetime_local="+
				availAt+"&timezone=UTC&duration=15", tok, nil)
			return err
		})
		timed(c, "slots", func() error {
			_, _, err := do("GET", "/api/v1/booking/doctors/"+docID+"/slots?date="+tomorrow, tok, nil)
			return err
		})
		timed(c, "book", func() error {
			_, _, err := do("POST", "/api/v1/booking/patients/appointments", tok, bookBody)
			if err != nil && atomic.AddInt64(&bookErrLogged, 1) == 1 {
				fmt.Fprintf(os.Stderr, "load: first book failure (slot %s): %v\n",
					bookBody["scheduled_start_local"], err)
			}
			return err
		})
		timed(c, "list-appointments", func() error {
			_, _, err := do("GET", "/api/v1/booking/patients/appointments", tok, nil)
			return err
		})
		timed(c, "consult-history", func() error {
			_, _, err := do("GET", "/api/v1/patients/consultations/all", tok, nil)
			return err
		})
		timed(c, "medications", func() error {
			_, _, err := do("GET", "/api/v1/patients/consultations/medications", tok, nil)
			return err
		})
		timed(c, "referrals", func() error {
			_, _, err := do("GET", "/api/v1/patients/consultations/referrals", tok, nil)
			return err
		})
		timed(c, "notifications", func() error {
			_, _, err := do("GET", "/api/v1/patients/me/notifications", tok, nil)
			return err
		})
	}
}

func main() {
	flag.Parse()
	if *cleanup {
		cleanupAll()
		return
	}
	if *seed {
		seedAll()
	}
	docEmail := *prefix + "-doctor@example.com"
	_, _, docID := mustLogin(docEmail, "LoadPass123!", "doctor")

	c := &collector{byEP: map[string][]time.Duration{}, errs: map[string]int{}}
	stop := make(chan struct{})
	var wg sync.WaitGroup
	var started int64
	for i := 0; i < *vus; i++ {
		wg.Add(1)
		go func(vu int) {
			defer wg.Done()
			atomic.AddInt64(&started, 1)
			scenario(stop, c, vu, docID)
		}(i)
	}
	time.Sleep(*duration)
	close(stop)
	wg.Wait()

	order := []string{"login", "refresh", "availability", "slots", "book",
		"list-appointments", "consult-history", "medications", "referrals", "notifications"}
	failed := false
	totalErrs := 0
	fmt.Printf("\n%-18s %8s %8s %8s %8s %8s\n", "endpoint", "n", "p50", "p95", "p99", "errors")
	for _, ep := range order {
		ds := c.byEP[ep]
		errs := c.errs[ep]
		totalErrs += errs
		p50, p95, p99 := percentile(ds, 0.5), percentile(ds, 0.95), percentile(ds, 0.99)
		fmt.Printf("%-18s %8d %8s %8s %8s %8d\n", ep, len(ds), p50.Round(time.Millisecond),
			p95.Round(time.Millisecond), p99.Round(time.Millisecond), errs)
		if p95 > time.Duration(*p95ms)*time.Millisecond {
			fmt.Printf("load: FAIL %s p95 %s exceeds %dms\n", ep, p95.Round(time.Millisecond), *p95ms)
			failed = true
		}
	}
	if totalErrs > *maxErrs {
		fmt.Printf("load: FAIL %d errors exceed max %d\n", totalErrs, *maxErrs)
		failed = true
	}
	if failed {
		os.Exit(1)
	}
	fmt.Println("load: PASS")
}
