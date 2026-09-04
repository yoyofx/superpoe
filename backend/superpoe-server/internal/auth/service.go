package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/mail"
	"strings"
	"time"

	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/mailer"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/security"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/store"
)

var (
	ErrInvalidInput       = errors.New("invalid input")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailNotVerified   = errors.New("email is not verified")
	ErrRateLimited        = errors.New("too many attempts")
	ErrInvalidState       = errors.New("invalid account state")
)

const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

const passwordResetCodeMaxAttempts = 5

type Config struct {
	AccessTTL            time.Duration
	RefreshTTL           time.Duration
	PasswordResetTTL     time.Duration
	EmailVerificationTTL time.Duration
	PublicBaseURL        string
	PasswordHashLimit    int
}

type Service struct {
	store   store.Store
	mailer  mailer.Mailer
	box     *security.SecretBox
	hasher  security.PasswordHasher
	config  Config
	hashSem chan struct{}
}

type RegisterInput struct {
	Username    string
	Password    string
	Email       string
	DisplayName string
	DeviceID    string
}

type LoginInput struct {
	Username string
	Password string
	DeviceID string
}

type SessionTokens struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
	SessionID        string    `json:"session_id"`
}

type UserResult struct {
	ID                       string `json:"id"`
	Username                 string `json:"username"`
	DisplayName              string `json:"display_name"`
	Email                    string `json:"email,omitempty"`
	EmailVerified            bool   `json:"email_verified"`
	EmailVerificationPending bool   `json:"email_verification_pending"`
}

type LoginResult struct {
	User    UserResult    `json:"user"`
	Session SessionTokens `json:"session"`
}

func NewService(st store.Store, delivery mailer.Mailer, box *security.SecretBox, cfg Config) *Service {
	limit := cfg.PasswordHashLimit
	if limit < 1 {
		limit = 2
	}
	return &Service{store: st, mailer: delivery, box: box, hasher: security.DefaultPasswordHasher(), config: cfg, hashSem: make(chan struct{}, limit)}
}

func NormalizeUsername(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) < 3 || len(value) > 32 {
		return "", fmt.Errorf("username must be between 3 and 32 characters")
	}
	for _, char := range value {
		valid := char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-'
		if !valid {
			// The ASCII-only rule also rejects multi-byte Unicode characters.
			return "", fmt.Errorf("username contains an invalid character")
		}
	}
	return strings.ToLower(value), nil
}

func NormalizeEmail(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) < 3 || len(value) > 254 || strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("email is invalid")
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || !strings.Contains(parsed.Address, "@") {
		return "", fmt.Errorf("email is invalid")
	}
	return strings.ToLower(value), nil
}

func (s *Service) Register(ctx context.Context, input RegisterInput, requestIP, userAgent string) (LoginResult, error) {
	username, err := NormalizeUsername(input.Username)
	if err != nil {
		return LoginResult{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	email, err := NormalizeEmail(input.Email)
	if err != nil {
		return LoginResult{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	if err := security.ValidatePassword(input.Password); err != nil {
		return LoginResult{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = username
	}
	if len(displayName) > 64 || strings.ContainsAny(displayName, "\r\n") {
		return LoginResult{}, fmt.Errorf("%w: display name is invalid", ErrInvalidInput)
	}
	passwordHash, err := s.hashPassword(input.Password)
	if err != nil {
		return LoginResult{}, err
	}
	emailEncrypted, err := s.box.Encrypt(email)
	if err != nil {
		return LoginResult{}, fmt.Errorf("encrypt recovery email: %w", err)
	}
	id, err := security.NewID()
	if err != nil {
		return LoginResult{}, err
	}
	user := store.User{ID: id, Username: username, DisplayName: displayName, Status: "active"}
	emailHash := security.HashToken(email)
	if err := s.store.InsertUser(ctx, user, passwordHash, emailEncrypted, emailHash); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return LoginResult{}, fmt.Errorf("%w: username or email is unavailable", ErrInvalidInput)
		}
		return LoginResult{}, err
	}
	result, err := s.createLoginResult(ctx, user, input.DeviceID)
	if err != nil {
		return LoginResult{}, err
	}
	// Email verification is optional. Password recovery proves mailbox access
	// with the one-time code sent at reset time.
	result.User.EmailVerificationPending = false
	_ = s.store.RecordAudit(ctx, user.ID, "register", "password", requestIP, userAgent, time.Now().UTC())
	return result, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput, requestIP, userAgent string) (LoginResult, error) {
	username, err := NormalizeUsername(input.Username)
	if err != nil || security.ValidatePassword(input.Password) != nil {
		return LoginResult{}, ErrInvalidCredentials
	}
	user, userErr := s.store.GetUserByUsername(ctx, username)
	if userErr != nil && !errors.Is(userErr, store.ErrNotFound) {
		return LoginResult{}, userErr
	}
	userID := ""
	credential := store.PasswordCredential{PasswordHash: dummyPasswordHash}
	if userErr == nil {
		userID = user.ID
		if user.Status != "active" {
			return LoginResult{}, ErrInvalidState
		}
		credential, err = s.store.GetPasswordCredential(ctx, user.ID)
		if errors.Is(err, store.ErrNotFound) {
			// Keep the same work and public error as an unknown username if a
			// partially migrated account has no password row yet.
			credential = store.PasswordCredential{PasswordHash: dummyPasswordHash}
		} else if err != nil {
			return LoginResult{}, err
		}
	}
	if credential.LockedUntil != nil && credential.LockedUntil.After(time.Now().UTC()) {
		return LoginResult{}, ErrRateLimited
	}
	ok, needsRehash, verifyErr := s.verifyPassword(credential.PasswordHash, input.Password)
	if verifyErr != nil {
		return LoginResult{}, verifyErr
	}
	if !ok || userID == "" {
		if userID != "" {
			attempts := credential.FailedAttempts + 1
			var lockedUntil *time.Time
			if attempts >= 10 {
				locked := time.Now().UTC().Add(time.Hour)
				lockedUntil = &locked
			} else if attempts >= 5 {
				locked := time.Now().UTC().Add(15 * time.Minute)
				lockedUntil = &locked
			}
			_ = s.store.RecordPasswordFailure(ctx, userID, attempts, lockedUntil)
			_ = s.store.RecordAudit(ctx, userID, "login-failed", "password", requestIP, userAgent, time.Now().UTC())
		}
		return LoginResult{}, ErrInvalidCredentials
	}
	if needsRehash {
		if updated, hashErr := s.hashPassword(input.Password); hashErr == nil {
			_ = s.store.UpdatePassword(ctx, user.ID, updated)
		}
	}
	_ = s.store.ResetPasswordFailures(ctx, user.ID)
	result, err := s.createLoginResult(ctx, user, input.DeviceID)
	if err != nil {
		return LoginResult{}, err
	}
	_ = s.store.RecordAudit(ctx, user.ID, "login-success", "password", requestIP, userAgent, time.Now().UTC())
	return result, nil
}

func (s *Service) Authenticate(ctx context.Context, accessToken string) (store.Session, store.User, error) {
	if len(accessToken) < 32 || len(accessToken) > 128 {
		return store.Session{}, store.User{}, store.ErrSessionRev
	}
	return s.store.GetSessionByAccessHash(ctx, security.HashToken(accessToken), time.Now().UTC())
}

func (s *Service) Refresh(ctx context.Context, refreshToken, requestIP, userAgent string) (SessionTokens, error) {
	if len(refreshToken) < 32 || len(refreshToken) > 128 {
		return SessionTokens{}, store.ErrSessionRev
	}
	oldHash := security.HashToken(refreshToken)
	session, _, err := s.store.GetSessionByRefreshHash(ctx, oldHash, time.Now().UTC())
	if err != nil {
		return SessionTokens{}, err
	}
	access, accessHash, err := security.NewOpaqueToken()
	if err != nil {
		return SessionTokens{}, err
	}
	refresh, refreshHash, err := security.NewOpaqueToken()
	if err != nil {
		return SessionTokens{}, err
	}
	now := time.Now().UTC()
	accessExpiry := now.Add(s.config.AccessTTL)
	refreshExpiry := now.Add(s.config.RefreshTTL)
	if err := s.store.RotateSession(ctx, session.ID, oldHash, accessHash, refreshHash, accessExpiry, refreshExpiry, now); err != nil {
		if errors.Is(err, store.ErrSessionRev) {
			_ = s.store.RevokeSessionForRefreshReplay(ctx, oldHash, now)
		}
		return SessionTokens{}, err
	}
	return SessionTokens{AccessToken: access, RefreshToken: refresh, AccessExpiresAt: accessExpiry, RefreshExpiresAt: refreshExpiry, SessionID: session.ID}, nil
}

func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.store.RevokeSession(ctx, sessionID, time.Now().UTC())
}

func (s *Service) LogoutAll(ctx context.Context, userID string) error {
	return s.store.RevokeAllSessions(ctx, userID, time.Now().UTC())
}

func (s *Service) ChangePassword(ctx context.Context, userID, sessionID, currentPassword, newPassword, requestIP, userAgent string) error {
	if err := security.ValidatePassword(currentPassword); err != nil {
		return ErrInvalidCredentials
	}
	if err := security.ValidatePassword(newPassword); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	credential, err := s.store.GetPasswordCredential(ctx, userID)
	if err != nil {
		return err
	}
	ok, _, err := s.verifyPassword(credential.PasswordHash, currentPassword)
	if err != nil || !ok {
		return ErrInvalidCredentials
	}
	hash, err := s.hashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.store.UpdatePassword(ctx, userID, hash); err != nil {
		return err
	}
	if err := s.store.RevokeOtherSessions(ctx, userID, sessionID, time.Now().UTC()); err != nil {
		return err
	}
	_ = s.store.RecordAudit(ctx, userID, "password-changed", "password", requestIP, userAgent, time.Now().UTC())
	return nil
}

func (s *Service) RequestPasswordReset(ctx context.Context, email, requestIP, userAgent string) error {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		log.Printf("password reset skipped stage=normalize reason=invalid_email")
		return nil
	}
	contact, err := s.store.GetRecoveryByHash(ctx, security.HashToken(normalized))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Printf("password reset skipped stage=lookup reason=not_found")
		} else {
			log.Printf("password reset failed stage=lookup: %v", err)
		}
		return nil
	}
	log.Printf("password reset matched stage=lookup user_id=%s", contact.User.ID)
	code, err := newPasswordResetCode()
	if err != nil {
		log.Printf("password reset failed stage=code_generation: %v", err)
		return err
	}
	hash := security.HashToken(code)
	if err := s.store.CreatePasswordResetToken(ctx, contact.User.ID, hash, time.Now().UTC().Add(s.config.PasswordResetTTL)); err != nil {
		log.Printf("password reset failed stage=token_store user_id=%s: %v", contact.User.ID, err)
		return err
	}
	recoveryEmail, err := s.box.Decrypt(contact.Encrypted)
	if err != nil {
		log.Printf("password reset failed stage=email_decrypt user_id=%s: %v", contact.User.ID, err)
		return err
	}
	_ = s.store.RecordAudit(ctx, contact.User.ID, "password-reset-requested", "password", requestIP, userAgent, time.Now().UTC())
	if err := s.sendResetEmail(ctx, recoveryEmail, code); err != nil {
		log.Printf("password reset failed stage=email_send user_id=%s: %v", contact.User.ID, err)
		return err
	}
	log.Printf("password reset completed stage=email_send user_id=%s", contact.User.ID)
	return nil
}

// ResendEmailVerification deliberately has the same no-op result for an
// unknown, already verified, or valid address. The caller cannot use it to
// enumerate accounts, while a valid unverified address still receives a new
// one-time token.
func (s *Service) ResendEmailVerification(ctx context.Context, email, requestIP, userAgent string) error {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return nil
	}
	contact, err := s.store.GetRecoveryByHash(ctx, security.HashToken(normalized))
	if err != nil || contact.VerifiedAt != nil {
		return nil
	}
	token, hash, err := security.NewOpaqueToken()
	if err != nil {
		return err
	}
	if err := s.store.CreateEmailVerificationToken(ctx, contact.User.ID, hash, time.Now().UTC().Add(s.config.EmailVerificationTTL)); err != nil {
		return err
	}
	recoveryEmail, err := s.box.Decrypt(contact.Encrypted)
	if err != nil {
		return err
	}
	_ = s.store.RecordAudit(ctx, contact.User.ID, "email-verification-resent", "password", requestIP, userAgent, time.Now().UTC())
	return s.sendVerificationEmail(ctx, recoveryEmail, token)
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, token, newPassword, requestIP, userAgent string) error {
	if len(token) < 32 || len(token) > 128 {
		return store.ErrTokenUsed
	}
	if err := security.ValidatePassword(newPassword); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	hash, err := s.hashPassword(newPassword)
	if err != nil {
		return err
	}
	userID, err := s.store.CompletePasswordReset(ctx, security.HashToken(token), hash, time.Now().UTC())
	if err != nil {
		return err
	}
	_ = s.store.RecordAudit(ctx, userID, "password-reset-completed", "password", requestIP, userAgent, time.Now().UTC())
	return nil
}

func (s *Service) ConfirmPasswordResetCode(ctx context.Context, email, code, newPassword, requestIP, userAgent string) error {
	normalized, err := NormalizeEmail(email)
	if err != nil || !validPasswordResetCode(code) {
		return store.ErrTokenUsed
	}
	contact, err := s.store.GetRecoveryByHash(ctx, security.HashToken(normalized))
	if err != nil {
		return store.ErrTokenUsed
	}
	if err := security.ValidatePassword(newPassword); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	passwordHash, err := s.hashPassword(newPassword)
	if err != nil {
		return err
	}
	userID, err := s.store.CompletePasswordResetCode(ctx, contact.User.ID, security.HashToken(code), passwordHash, time.Now().UTC(), passwordResetCodeMaxAttempts)
	if err != nil {
		return err
	}
	_ = s.store.RecordAudit(ctx, userID, "password-reset-completed", "password", requestIP, userAgent, time.Now().UTC())
	return nil
}

func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	if len(token) < 32 || len(token) > 128 {
		return store.ErrTokenUsed
	}
	_, err := s.store.ConsumeEmailVerificationToken(ctx, security.HashToken(token), time.Now().UTC())
	return err
}

func (s *Service) createLoginResult(ctx context.Context, user store.User, deviceID string) (LoginResult, error) {
	access, accessHash, err := security.NewOpaqueToken()
	if err != nil {
		return LoginResult{}, err
	}
	refresh, refreshHash, err := security.NewOpaqueToken()
	if err != nil {
		return LoginResult{}, err
	}
	id, err := security.NewID()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC()
	accessExpiry := now.Add(s.config.AccessTTL)
	refreshExpiry := now.Add(s.config.RefreshTTL)
	userResult, err := s.CurrentUserResult(ctx, user)
	if err != nil {
		return LoginResult{}, err
	}
	if err := s.store.CreateSession(ctx, store.Session{ID: id, UserID: user.ID, AccessTokenHash: accessHash, RefreshTokenHash: refreshHash, DeviceID: deviceID, AccessExpiresAt: accessExpiry, RefreshExpiresAt: refreshExpiry}); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{User: userResult, Session: SessionTokens{AccessToken: access, RefreshToken: refresh, AccessExpiresAt: accessExpiry, RefreshExpiresAt: refreshExpiry, SessionID: id}}, nil
}

// CurrentUserResult exposes the authenticated user's profile. The recovery
// email is decrypted only for this response and is never stored in plaintext.
func (s *Service) CurrentUserResult(ctx context.Context, user store.User) (UserResult, error) {
	result := UserResult{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, EmailVerified: user.EmailVerified, EmailVerificationPending: false}
	contact, err := s.store.GetRecoveryByUserID(ctx, user.ID)
	if errors.Is(err, store.ErrNotFound) {
		return result, nil
	}
	if err != nil {
		return UserResult{}, err
	}
	email, err := s.box.Decrypt(contact.Encrypted)
	if err != nil {
		return UserResult{}, fmt.Errorf("decrypt recovery email: %w", err)
	}
	result.Email = email
	result.EmailVerified = contact.User.EmailVerified || result.EmailVerified
	return result, nil
}

func (s *Service) hashPassword(password string) (string, error) {
	s.hashSem <- struct{}{}
	defer func() { <-s.hashSem }()
	return s.hasher.Hash(password)
}

func (s *Service) verifyPassword(encoded, password string) (bool, bool, error) {
	s.hashSem <- struct{}{}
	defer func() { <-s.hashSem }()
	return s.hasher.Verify(encoded, password)
}

func (s *Service) sendVerificationEmail(ctx context.Context, email, token string) error {
	link := fmt.Sprintf("%s/verify-email?token=%s", s.config.PublicBaseURL, token)
	body := "请打开以下链接验证 SuperPoE 账号邮箱：\n\n" + link + "\n\n该链接将在 " + s.config.EmailVerificationTTL.String() + " 后失效。"
	return s.mailer.SendText(ctx, email, "验证你的 SuperPoE 邮箱", body)
}

func (s *Service) sendResetEmail(ctx context.Context, email, code string) error {
	body := "你的 SuperPoE 密码重置验证码是：\n\n" + code + "\n\n验证码只能使用一次，并将在 " + s.config.PasswordResetTTL.String() + " 后失效。请勿将验证码透露给他人。"
	return s.mailer.SendText(ctx, email, "重置你的 SuperPoE 密码", body)
}

func newPasswordResetCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("generate password reset code: %w", err)
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func allDigits(value string) bool {
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func validPasswordResetCode(value string) bool {
	return len(value) == 6 && allDigits(value)
}

// EmailHash is exposed for future account settings handlers without exposing
// the normalized address to logs or callers that only need a lookup key.
func EmailHash(email string) []byte {
	normalized, _ := NormalizeEmail(email)
	sum := sha256.Sum256([]byte(normalized))
	return sum[:]
}
