package mail

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

func TestSubjectsUseProductName(t *testing.T) {
	c := NewCopy()
	subj, _ := c.RegistrationOTP()
	if !strings.Contains(subj, "MediApp") {
		t.Errorf("registration subject = %q, want MediApp", subj)
	}
	subj, _ = c.ForgotOTP()
	if !strings.Contains(subj, "MediApp") {
		t.Errorf("forgot subject = %q", subj)
	}
	subj, _ = c.Welcome("patient")
	if !strings.Contains(subj, "MediApp") {
		t.Errorf("welcome subject = %q", subj)
	}
}

func TestLayoutCarriesBody(t *testing.T) {
	c := NewCopy()
	html := c.Layout("Verify your email", "<p>body</p>")
	for _, want := range []string{"MediApp", "<p>body</p>"} {
		if !strings.Contains(html, want) {
			t.Errorf("layout missing %q", want)
		}
	}
}

func TestFakeSenderRecords(t *testing.T) {
	f := &FakeSender{}
	ctx := context.Background()
	if err := f.Send(ctx, "a@example.com", "Hi", "<p>x</p>"); err != nil {
		t.Fatalf("Send: %v", err)
	}
	msgs := f.Messages()
	if len(msgs) != 1 || msgs[0].To != "a@example.com" || msgs[0].Subject != "Hi" {
		t.Errorf("messages = %+v", msgs)
	}
}

// stubSMTP speaks just enough SMTP (no TLS, no auth) to verify delivery.
func stubSMTP(t *testing.T, received *string) (addr string, stop func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
		write := func(s string) {
			rw.WriteString(s + "\r\n")
			rw.Flush()
		}
		write("220 stub ready")
		var data strings.Builder
		inData := false
		for {
			line, err := rw.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			switch {
			case inData && line == ".":
				*received = data.String()
				write("250 ok")
				inData = false
			case inData:
				data.WriteString(line + "\n")
			case strings.HasPrefix(line, "EHLO") || strings.HasPrefix(line, "HELO"):
				write("250-stub\r\n250 HELP")
			case strings.HasPrefix(line, "MAIL") || strings.HasPrefix(line, "RCPT"):
				write("250 ok")
			case strings.HasPrefix(line, "DATA"):
				write("354 end with .")
				inData = true
			case strings.HasPrefix(line, "QUIT"):
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()
	return ln.Addr().String(), func() { ln.Close() }
}

func TestSMTPSendsThroughStubServer(t *testing.T) {
	var received string
	addr, stop := stubSMTP(t, &received)
	defer stop()
	host, port, _ := net.SplitHostPort(addr)
	sender := New(Config{Host: host, Port: port, From: "test@example.org"}).(*SMTP)
	// Localhost dials can transiently time out when the full suite saturates
	// small machines with bcrypt work; retry a few times before failing.
	var err error
	for i := 0; i < 6; i++ {
		err = sender.Send(context.Background(), "to@example.com", "Hello", "<p>hi</p>")
		if err == nil || !strings.Contains(err.Error(), "i/o timeout") {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	for _, want := range []string{"To: to@example.com", "Subject: Hello", "<p>hi</p>"} {
		if !strings.Contains(received, want) {
			t.Errorf("delivered message missing %q:\n%s", want, received)
		}
	}
}

func TestNewSelectsProvider(t *testing.T) {
	if _, ok := New(Config{}).(LogSender); !ok {
		t.Error("empty host should select LogSender")
	}
	if _, ok := New(Config{Host: "smtp.example.org"}).(*SMTP); !ok {
		t.Error("host should select SMTP")
	}
}
