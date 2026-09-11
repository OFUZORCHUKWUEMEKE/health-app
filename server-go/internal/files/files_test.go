package files

import (
	"context"
	"mime/multipart"
	"net/textproto"
	"strings"
	"testing"
)

func TestNewValidation(t *testing.T) {
	if _, ok := New(Config{CloudName: "c", APIKey: "k", APISecret: "s"}).(*Cloudinary); !ok {
		t.Error("fully configured: want *Cloudinary")
	}
	// Any missing credential disables the provider (controlled 503).
	for _, cfg := range []Config{
		{},
		{CloudName: "c", APIKey: "k"},
		{CloudName: "c", APISecret: "s"},
		{APIKey: "k", APISecret: "s"},
		{CloudName: "  ", APIKey: "k", APISecret: "s"},
	} {
		if _, ok := New(cfg).(Disabled); !ok {
			t.Errorf("partial config %+v: want Disabled", cfg)
		}
	}
}

func TestValidateNamesMissingKeys(t *testing.T) {
	missing := Config{CloudName: "c"}.Validate()
	if len(missing) != 2 {
		t.Errorf("missing=%v, want 2 entries", missing)
	}
	if len(Config{CloudName: "c", APIKey: "k", APISecret: "s"}.Validate()) != 0 {
		t.Error("full config should validate clean")
	}
}

func TestDisabledIsControlled503(t *testing.T) {
	var p Provider = Disabled{}
	if _, err := p.UploadProfileImage(context.Background(), []byte("x"), "image/png", "patients", "u"); !IsNotConfigured(err) {
		t.Errorf("profile: got %v", err)
	}
	if _, err := p.UploadInvestigationImage(context.Background(), []byte("x"), "image/png", "p", "l"); !IsNotConfigured(err) {
		t.Errorf("investigation: got %v", err)
	}
	if err := error(nil); IsNotConfigured(err) {
		t.Error("nil must not report as not-configured")
	}
}

func TestSignParamsDeterministic(t *testing.T) {
	a := signParams(map[string]string{"b": "2", "a": "1", "file": "x", "signature": "y"}, "s")
	b := signParams(map[string]string{"a": "1", "b": "2"}, "s")
	if a != b {
		t.Error("signature must ignore file/signature keys and sort the rest")
	}
	if signParams(map[string]string{"a": "1"}, "s1") == signParams(map[string]string{"a": "1"}, "s2") {
		t.Error("signature must cover the secret")
	}
}

func TestPickFileOrderAndCaps(t *testing.T) {
	form := &multipart.Form{File: map[string][]*multipart.FileHeader{}}
	put := func(key, content string, size int64) {
		form.File[key] = []*multipart.FileHeader{{
			Filename: key + ".png",
			Size:     size,
			Header:   textproto.MIMEHeader{"Content-Type": {"image/png"}},
		}}
		_ = content
	}
	// file wins over image and profile_picture.
	put("profile_picture", "c", 3)
	put("image", "b", 2)
	put("file", "a", 1)
	// PickFile opens the header; without a body it skips entries, so this
	// only asserts the oversize gate here (open-based reads are covered by
	// handler tests with real multipart bodies).
	big := &multipart.Form{File: map[string][]*multipart.FileHeader{
		"file": {{Filename: "big.png", Size: 9 << 20, Header: textproto.MIMEHeader{}}},
	}}
	if got := PickFile(big, 5<<20); got == nil || !got.Oversize {
		t.Error("oversize file must be flagged, not read")
	}
	if got := PickFile(nil, 5<<20); got != nil {
		t.Error("nil form must yield no file")
	}
	if got := PickFile(form, 5<<20); got != nil && got.Oversize {
		t.Error("small files must not flag oversize")
	}
}

func TestFakeRoundTrip(t *testing.T) {
	f := &Fake{}
	u, err := f.UploadProfileImage(context.Background(), []byte("pic"), "image/jpeg", "doctors", "d1")
	if err != nil || !strings.HasPrefix(u, "https://fake.cloudinary/doctors/d1") {
		t.Errorf("profile fake: %q %v", u, err)
	}
	u, err = f.UploadInvestigationImage(context.Background(), []byte("scan"), "image/png", "p1", "l1")
	if err != nil || !strings.Contains(u, "/inv/l1/") {
		t.Errorf("investigation fake: %q %v", u, err)
	}
	if len(f.Calls) != 2 || f.Calls[0].Kind != "profile" || f.Calls[1].Kind != "investigation" {
		t.Errorf("calls not recorded: %+v", f.Calls)
	}
	f.Err = ErrNotConfigured
	if _, err := f.UploadProfileImage(context.Background(), []byte("x"), "image/png", "patients", "u"); !IsNotConfigured(err) {
		t.Errorf("injected error must surface: %v", err)
	}
}
