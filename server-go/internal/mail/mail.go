// Package mail is the transactional sender: provider interface, SMTP and
// fake/log providers, and copy rendering. Sending never
// fails a request: callers log and swallow errors so a mail outage cannot
// break signup (Milestone 7 rule, kept here).
package mail

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"strings"
	"sync"
	"time"
)

// Sender delivers one HTML email.
type Sender interface {
	Send(ctx context.Context, to, subject, htmlBody string) error
}

// Config for SMTP. Empty host selects the log sender (dev/test default).
// Port defaults to 2525 and Secure to false, mirroring the Nest mailer
// transport (Mailtrap-style development SMTP).
type Config struct {
	Host, Port, User, Password, From string
	Secure                           bool
}

// New picks SMTP when a host is configured, otherwise the log sender.
func New(cfg Config) Sender {
	if strings.TrimSpace(cfg.Host) == "" {
		return LogSender{}
	}
	if cfg.Port == "" {
		cfg.Port = "2525"
	}
	return &SMTP{cfg: cfg}
}

// LogSender prints instead of sending (dev default).
type LogSender struct{}

func (l LogSender) Send(_ context.Context, to, subject, _ string) error {
	log.Printf("mail to=%s subject=%q (log sender, not delivered)", to, subject)
	return nil
}

// Sent is one captured message.
type Sent struct {
	To, Subject, Body string
}

// FakeSender records messages for assertions. The M8 test provider —
// services under test take a Sender, so no test ever needs real SMTP.
type FakeSender struct {
	mu   sync.Mutex
	Sent []Sent
	Fail error // when non-nil, Send returns it (exercises error paths)
}

func (f *FakeSender) Send(_ context.Context, to, subject, body string) error {
	if f.Fail != nil {
		return f.Fail
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Sent = append(f.Sent, Sent{To: to, Subject: subject, Body: body})
	return nil
}

// Messages returns a copy of captured sends.
func (f *FakeSender) Messages() []Sent {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Sent(nil), f.Sent...)
}

// SMTP delivers with a dial timeout, optional STARTTLS, and auth only when
// credentials are configured (matches the Nest transport semantics).
type SMTP struct{ cfg Config }

func (s *SMTP) Send(ctx context.Context, to, subject, htmlBody string) error {
	addr := net.JoinHostPort(s.cfg.Host, s.cfg.Port)
	from := s.cfg.From
	if from == "" {
		from = "no-reply@" + s.cfg.Host
	}
	msg := "From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n\r\n" + htmlBody
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		return err
	}
	defer c.Close()
	if s.cfg.Secure {
		if err := c.StartTLS(&tls.Config{ServerName: s.cfg.Host}); err != nil {
			return err
		}
	} else if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: s.cfg.Host}); err != nil {
			return err
		}
	}
	if s.cfg.User != "" {
		if err := c.Auth(smtp.PlainAuth("", s.cfg.User, s.cfg.Password, s.cfg.Host)); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	defer w.Close()
	_, err = fmt.Fprint(w, msg)
	return err
}

// Copy renders subjects/bodies. Product names mirror mail.service.ts.
type Copy struct {
	Product      string
	WebsiteURL   string
	SupportEmail string
}

// NewCopy returns the default copy.
func NewCopy() Copy {
	return Copy{Product: "MediApp"}
}

// Layout wraps a body fragment in the document shell: product
// header, content, support/website footer. Every outbound email goes
// through here so copy can never drift per-template.
func (c Copy) Layout(title, inner string) string {
	footer := ""
	if c.SupportEmail != "" || c.WebsiteURL != "" {
		contact := c.SupportEmail
		if c.WebsiteURL != "" {
			if contact != "" {
				contact += " · "
			}
			contact += c.WebsiteURL
		}
		footer = "<hr><p style=\"color:#6b7280;font-size:12px;\">Need help? Contact " +
			contact + ".</p>"
	}
	return "<!DOCTYPE html><html><body style=\"font-family:sans-serif;max-width:600px;margin:0 auto;\">" +
		"<h2 style=\"color:#5B2D8E;\">" + c.Product + "</h2>" +
		"<h3>" + title + "</h3>" + inner + footer + "</body></html>"
}

func (c Copy) RegistrationOTP() (subject string, body func(otp string, minutes int) string) {
	return c.Product + " registration OTP",
		func(otp string, minutes int) string {
			return otpBody("Verify your email", "Your one-time password (OTP) is:", otp, minutes)
		}
}

func (c Copy) ForgotOTP() (subject string, body func(otp string, minutes int) string) {
	return "Your " + c.Product + " password reset OTP",
		func(otp string, minutes int) string {
			return otpBody("Password Reset OTP", "Use this one-time password (OTP) to continue resetting your password:", otp, minutes)
		}
}

func (c Copy) Welcome(role string) (subject string, body func(name string) string) {
	return "Welcome to " + c.Product + " (" + role + ")",
		func(name string) string {
			if name == "" {
				name = "there"
			}
			return "<h3>Welcome to " + c.Product + "</h3><p>Hi " + name + ",</p>" +
				"<p>Your " + role + " account is ready.</p><p>You can now log in and continue.</p>"
		}
}

func (c Copy) EmailConfirmation(url string) (subject, body string) {
	return "Please confirm your email address",
		"<h3>Email Confirmation</h3><p>Thank you for registering. Please confirm your email by clicking the link below:</p>" +
			"<p><a href=\"" + url + "\">Confirm Email</a></p><p>If you didn't request this, please ignore this email.</p>"
}

func (c Copy) PasswordChanged() (subject string, body func(name string) string) {
	return "Your password was changed",
		func(name string) string {
			if name == "" {
				name = "there"
			}
			return "<h3>Password Changed</h3><p>Hi " + name + ",</p>" +
				"<p>Your account password was changed successfully.</p>" +
				"<p>If this was not you, please reset your password immediately.</p>"
		}
}

func otpBody(title, lead, otp string, minutes int) string {
	return "<h3>" + title + "</h3><p>" + lead + "</p>" +
		"<h2 style=\"letter-spacing: 6px;\">" + otp + "</h2>" +
		"<p>This OTP expires in " + itoa(minutes) + " minutes.</p>" +
		"<p>If you didn't request this, please ignore this email.</p>"
}

func itoa(n int) string { return fmt.Sprintf("%d", n) }
