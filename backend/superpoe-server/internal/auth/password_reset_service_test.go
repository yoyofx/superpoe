package auth

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/mailer"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/security"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/store"
)

type passwordResetStoreMock struct {
	store.Store
	contact      store.RecoveryContact
	createErr    error
	createdUser  string
	createdHash  []byte
	createdUntil time.Time
}

func (m *passwordResetStoreMock) GetRecoveryByHash(context.Context, []byte) (store.RecoveryContact, error) {
	return m.contact, nil
}

func (m *passwordResetStoreMock) CreatePasswordResetToken(_ context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	if m.createErr != nil {
		return m.createErr
	}
	m.createdUser = userID
	m.createdHash = append([]byte(nil), tokenHash...)
	m.createdUntil = expiresAt
	return nil
}

func (m *passwordResetStoreMock) RecordAudit(context.Context, string, string, string, string, string, time.Time) error {
	return nil
}

type passwordResetMailerMock struct {
	to      string
	subject string
	body    string
	err     error
}

func (m *passwordResetMailerMock) SendText(_ context.Context, to, subject, body string) error {
	m.to, m.subject, m.body = to, subject, body
	return m.err
}

func newPasswordResetServiceForTest(t *testing.T, st store.Store, delivery mailer.Mailer) *Service {
	t.Helper()
	box, err := security.NewSecretBox([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatalf("NewSecretBox() error = %v", err)
	}
	return NewService(st, delivery, box, Config{PasswordResetTTL: 20 * time.Minute, PasswordHashLimit: 1})
}

func TestRequestPasswordResetCreatesTokenAndSendsCode(t *testing.T) {
	box, err := security.NewSecretBox([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatalf("NewSecretBox() error = %v", err)
	}
	encrypted, err := box.Encrypt("reset@example.com")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	st := &passwordResetStoreMock{contact: store.RecoveryContact{User: store.User{ID: "user-1", Status: "active"}, Encrypted: encrypted}}
	delivery := &passwordResetMailerMock{}
	service := newPasswordResetServiceForTest(t, st, delivery)

	started := time.Now().UTC()
	if err := service.RequestPasswordReset(context.Background(), "RESET@example.com", "127.0.0.1", "test"); err != nil {
		t.Fatalf("RequestPasswordReset() error = %v", err)
	}
	if st.createdUser != "user-1" || len(st.createdHash) != 32 {
		t.Fatalf("token was not stored correctly: user=%q hash=%d", st.createdUser, len(st.createdHash))
	}
	if !st.createdUntil.After(started) {
		t.Fatalf("token expiry = %v, want future time", st.createdUntil)
	}
	if delivery.to != "reset@example.com" || delivery.subject != "重置你的 SuperPoE 密码" {
		t.Fatalf("mail = to:%q subject:%q", delivery.to, delivery.subject)
	}
	code := regexp.MustCompile(`\b[0-9]{6}\b`).FindString(delivery.body)
	if code == "" {
		t.Fatalf("reset email body has no six-digit code: %q", delivery.body)
	}
	if want := security.HashToken(code); string(want) != string(st.createdHash) {
		t.Fatalf("stored token hash does not match emailed code")
	}
}

func TestRequestPasswordResetReturnsTokenStoreErrorBeforeSending(t *testing.T) {
	storeErr := errors.New("password reset table unavailable")
	st := &passwordResetStoreMock{createErr: storeErr}
	delivery := &passwordResetMailerMock{}
	service := newPasswordResetServiceForTest(t, st, delivery)

	err := service.RequestPasswordReset(context.Background(), "reset@example.com", "127.0.0.1", "test")
	if !errors.Is(err, storeErr) {
		t.Fatalf("RequestPasswordReset() error = %v, want %v", err, storeErr)
	}
	if delivery.to != "" || delivery.subject != "" || strings.TrimSpace(delivery.body) != "" {
		t.Fatalf("mailer was called after token storage failed: %+v", delivery)
	}
}
