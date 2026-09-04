package mailer

import (
	"context"
	"errors"
	"fmt"
	"net/smtp"
)

var ErrNotConfigured = errors.New("email delivery is not configured")

type Mailer interface {
	SendText(ctx context.Context, to, subject, body string) error
}

type SMTPMailer struct {
	host     string
	port     int
	username string
	password string
	from     string
}

func NewSMTP(host string, port int, username, password, from string) Mailer {
	if host == "" || from == "" {
		return unavailableMailer{}
	}
	return SMTPMailer{host: host, port: port, username: username, password: password, from: from}
}

func (m SMTPMailer) SendText(ctx context.Context, to, subject, body string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if to == "" || subject == "" || body == "" {
		return fmt.Errorf("email message is incomplete")
	}
	address := fmt.Sprintf("%s:%d", m.host, m.port)
	var auth smtp.Auth
	if m.username != "" {
		auth = smtp.PlainAuth("", m.username, m.password, m.host)
	}
	message := []byte("From: " + m.from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	return smtp.SendMail(address, auth, m.from, []string{to}, message)
}

type unavailableMailer struct{}

func (unavailableMailer) SendText(context.Context, string, string, string) error {
	return ErrNotConfigured
}
