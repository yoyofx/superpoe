package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

var (
	ErrNotFound   = errors.New("record not found")
	ErrConflict   = errors.New("record already exists")
	ErrInvalid    = errors.New("invalid record")
	ErrTokenUsed  = errors.New("token is invalid or already used")
	ErrSessionRev = errors.New("session is revoked or expired")
)

type User struct {
	ID            string
	Username      string
	DisplayName   string
	Status        string
	EmailVerified bool
}

type PasswordCredential struct {
	UserID         string
	PasswordHash   string
	FailedAttempts uint32
	LockedUntil    *time.Time
}

type Session struct {
	ID               string
	UserID           string
	AccessTokenHash  []byte
	RefreshTokenHash []byte
	DeviceID         string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	RevokedAt        *time.Time
}

type RecoveryContact struct {
	User       User
	Encrypted  []byte
	VerifiedAt *time.Time
}

type Store interface {
	InsertUser(ctx context.Context, user User, passwordHash string, emailEncrypted, emailHash []byte) error
	GetUserByUsername(ctx context.Context, username string) (User, error)
	GetUserByID(ctx context.Context, userID string) (User, error)
	GetPasswordCredential(ctx context.Context, userID string) (PasswordCredential, error)
	UpdatePassword(ctx context.Context, userID, passwordHash string) error
	RecordPasswordFailure(ctx context.Context, userID string, failedAttempts uint32, lockedUntil *time.Time) error
	ResetPasswordFailures(ctx context.Context, userID string) error
	GetRecoveryByUserID(ctx context.Context, userID string) (RecoveryContact, error)
	GetRecoveryByHash(ctx context.Context, valueHash []byte) (RecoveryContact, error)
	GetVerifiedRecoveryByHash(ctx context.Context, valueHash []byte) (RecoveryContact, error)
	CreateEmailVerificationToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	ConsumeEmailVerificationToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error)
	CreatePasswordResetToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	ConsumePasswordResetToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error)
	CompletePasswordReset(ctx context.Context, tokenHash []byte, passwordHash string, now time.Time) (string, error)
	CompletePasswordResetCode(ctx context.Context, userID string, codeHash []byte, passwordHash string, now time.Time, maxAttempts uint32) (string, error)
	CreateSession(ctx context.Context, session Session) error
	GetSessionByAccessHash(ctx context.Context, tokenHash []byte, now time.Time) (Session, User, error)
	GetSessionByRefreshHash(ctx context.Context, tokenHash []byte, now time.Time) (Session, User, error)
	RotateSession(ctx context.Context, sessionID string, oldRefreshHash, accessHash, refreshHash []byte, accessExpiresAt, refreshExpiresAt, now time.Time) error
	RevokeSessionForRefreshReplay(ctx context.Context, tokenHash []byte, now time.Time) error
	RevokeSession(ctx context.Context, sessionID string, now time.Time) error
	RevokeAllSessions(ctx context.Context, userID string, now time.Time) error
	RevokeOtherSessions(ctx context.Context, userID, keepSessionID string, now time.Time) error
	RecordAudit(ctx context.Context, userID, eventType, provider string, ip, userAgent string, now time.Time) error
}

type MySQLStore struct {
	db *sql.DB
}

func NewMySQL(db *sql.DB) *MySQLStore {
	return &MySQLStore{db: db}
}

func (s *MySQLStore) InsertUser(ctx context.Context, user User, passwordHash string, emailEncrypted, emailHash []byte) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin user insert: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO users (id, username_normalized, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`, user.ID, user.Username, user.DisplayName, now, now); err != nil {
		return mapDBError(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO password_credentials (user_id, password_hash, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, user.ID, passwordHash, now, now, now); err != nil {
		return mapDBError(err)
	}
	if len(emailEncrypted) > 0 && len(emailHash) > 0 {
		contactID, err := newID()
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_recovery_contacts (id, user_id, type, value_encrypted, value_hash, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, ?, ?)`, contactID, user.ID, emailEncrypted, emailHash, now, now); err != nil {
			return mapDBError(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit user insert: %w", err)
	}
	return nil
}

func (s *MySQLStore) GetUserByUsername(ctx context.Context, username string) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.username_normalized, u.display_name, u.status, EXISTS(SELECT 1 FROM user_recovery_contacts c WHERE c.user_id = u.id AND c.type = 'email' AND c.verified_at IS NOT NULL) FROM users u WHERE u.username_normalized = ? LIMIT 1`, username).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Status, &user.EmailVerified)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by username: %w", err)
	}
	return user, nil
}

func (s *MySQLStore) GetUserByID(ctx context.Context, userID string) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.username_normalized, u.display_name, u.status, EXISTS(SELECT 1 FROM user_recovery_contacts c WHERE c.user_id = u.id AND c.type = 'email' AND c.verified_at IS NOT NULL) FROM users u WHERE u.id = ? LIMIT 1`, userID).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Status, &user.EmailVerified)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

func (s *MySQLStore) GetPasswordCredential(ctx context.Context, userID string) (PasswordCredential, error) {
	var credential PasswordCredential
	var locked sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT user_id, password_hash, failed_attempts, locked_until FROM password_credentials WHERE user_id = ? LIMIT 1`, userID).Scan(&credential.UserID, &credential.PasswordHash, &credential.FailedAttempts, &locked)
	if errors.Is(err, sql.ErrNoRows) {
		return PasswordCredential{}, ErrNotFound
	}
	if err != nil {
		return PasswordCredential{}, fmt.Errorf("get password credential: %w", err)
	}
	if locked.Valid {
		credential.LockedUntil = &locked.Time
	}
	return credential, nil
}

func (s *MySQLStore) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE password_credentials SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6), failed_attempts = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(6) WHERE user_id = ?`, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *MySQLStore) RecordPasswordFailure(ctx context.Context, userID string, failedAttempts uint32, lockedUntil *time.Time) error {
	var value any
	if lockedUntil != nil {
		value = *lockedUntil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE password_credentials SET failed_attempts = ?, locked_until = ?, updated_at = UTC_TIMESTAMP(6) WHERE user_id = ?`, failedAttempts, value, userID)
	if err != nil {
		return fmt.Errorf("record password failure: %w", err)
	}
	return nil
}

func (s *MySQLStore) ResetPasswordFailures(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE password_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(6) WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("reset password failures: %w", err)
	}
	return nil
}

func (s *MySQLStore) GetRecoveryByUserID(ctx context.Context, userID string) (RecoveryContact, error) {
	var contact RecoveryContact
	var verified sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.username_normalized, u.display_name, u.status, c.value_encrypted, c.verified_at FROM user_recovery_contacts c JOIN users u ON u.id = c.user_id WHERE c.user_id = ? AND c.type = 'email' AND u.status = 'active' ORDER BY c.created_at DESC LIMIT 1`, userID).Scan(&contact.User.ID, &contact.User.Username, &contact.User.DisplayName, &contact.User.Status, &contact.Encrypted, &verified)
	if errors.Is(err, sql.ErrNoRows) {
		return RecoveryContact{}, ErrNotFound
	}
	if err != nil {
		return RecoveryContact{}, fmt.Errorf("get recovery contact by user: %w", err)
	}
	if verified.Valid {
		contact.VerifiedAt = &verified.Time
		contact.User.EmailVerified = true
	}
	return contact, nil
}

func (s *MySQLStore) GetVerifiedRecoveryByHash(ctx context.Context, valueHash []byte) (RecoveryContact, error) {
	contact, err := s.GetRecoveryByHash(ctx, valueHash)
	if err != nil {
		return RecoveryContact{}, err
	}
	if contact.VerifiedAt == nil {
		return RecoveryContact{}, ErrNotFound
	}
	return contact, nil
}

func (s *MySQLStore) GetRecoveryByHash(ctx context.Context, valueHash []byte) (RecoveryContact, error) {
	var contact RecoveryContact
	var verified sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.username_normalized, u.display_name, u.status, c.value_encrypted, c.verified_at FROM user_recovery_contacts c JOIN users u ON u.id = c.user_id WHERE c.type = 'email' AND c.value_hash = ? AND u.status = 'active' LIMIT 1`, valueHash).Scan(&contact.User.ID, &contact.User.Username, &contact.User.DisplayName, &contact.User.Status, &contact.Encrypted, &verified)
	if errors.Is(err, sql.ErrNoRows) {
		return RecoveryContact{}, ErrNotFound
	}
	if err != nil {
		return RecoveryContact{}, fmt.Errorf("get recovery contact: %w", err)
	}
	if verified.Valid {
		contact.VerifiedAt = &verified.Time
		contact.User.EmailVerified = true
	}
	return contact, nil
}

func (s *MySQLStore) CreateEmailVerificationToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	id, err := newID()
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))`, id, userID, tokenHash, expiresAt)
	if err != nil {
		return fmt.Errorf("create email verification token: %w", err)
	}
	return nil
}

func (s *MySQLStore) ConsumeEmailVerificationToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin email verification: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var userID string
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM email_verification_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? FOR UPDATE`, tokenHash, now).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrTokenUsed
	}
	if err != nil {
		return "", fmt.Errorf("read email verification token: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE email_verification_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL`, now, tokenHash); err != nil {
		return "", fmt.Errorf("consume email verification token: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE user_recovery_contacts SET verified_at = COALESCE(verified_at, ?), updated_at = ? WHERE user_id = ? AND type = 'email'`, now, now, userID); err != nil {
		return "", fmt.Errorf("verify recovery contact: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit email verification: %w", err)
	}
	return userID, nil
}

func (s *MySQLStore) CreatePasswordResetToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin password reset token: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE password_reset_tokens SET consumed_at = COALESCE(consumed_at, ?) WHERE user_id = ? AND consumed_at IS NULL`, now, userID); err != nil {
		return fmt.Errorf("invalidate previous password reset tokens: %w", err)
	}
	id, err := newID()
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`, id, userID, tokenHash, expiresAt, now); err != nil {
		return fmt.Errorf("create password reset token: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit password reset token: %w", err)
	}
	return nil
}

func (s *MySQLStore) ConsumePasswordResetToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var userID string
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? FOR UPDATE`, tokenHash, now).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrTokenUsed
	}
	if err != nil {
		return "", fmt.Errorf("read password reset token: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE password_reset_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL`, now, tokenHash); err != nil {
		return "", fmt.Errorf("consume password reset token: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset: %w", err)
	}
	return userID, nil
}

// CompletePasswordReset consumes a valid reset token and applies the new
// password atomically. A reset must not leave a consumed token with the old
// password, or a new password with sessions that were issued under the old
// credential.
func (s *MySQLStore) CompletePasswordReset(ctx context.Context, tokenHash []byte, passwordHash string, now time.Time) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var userID string
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? FOR UPDATE`, tokenHash, now).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrTokenUsed
	}
	if err != nil {
		return "", fmt.Errorf("read password reset token: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE password_reset_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL`, now, tokenHash); err != nil {
		return "", fmt.Errorf("consume password reset token: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE password_credentials SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`, passwordHash, now, now, userID)
	if err != nil {
		return "", fmt.Errorf("update password after reset: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return "", ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now, now, userID); err != nil {
		return "", fmt.Errorf("revoke sessions after reset: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset completion: %w", err)
	}
	return userID, nil
}

// CompletePasswordResetCode validates the newest reset code while counting
// failed guesses in the same transaction as password replacement. A code is
// consumed exactly once, and a caller cannot keep guessing after the limit.
func (s *MySQLStore) CompletePasswordResetCode(ctx context.Context, userID string, codeHash []byte, passwordHash string, now time.Time, maxAttempts uint32) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset code completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var id string
	var storedHash []byte
	var attempts uint32
	err = tx.QueryRowContext(ctx, `SELECT id, token_hash, attempt_count FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, userID, now).Scan(&id, &storedHash, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrTokenUsed
	}
	if err != nil {
		return "", fmt.Errorf("read password reset code: %w", err)
	}
	if attempts >= maxAttempts || subtle.ConstantTimeCompare(storedHash, codeHash) != 1 {
		if attempts < maxAttempts {
			if _, err := tx.ExecContext(ctx, `UPDATE password_reset_tokens SET attempt_count = attempt_count + 1 WHERE id = ?`, id); err != nil {
				return "", fmt.Errorf("record password reset code attempt: %w", err)
			}
			if err := tx.Commit(); err != nil {
				return "", fmt.Errorf("commit password reset code attempt: %w", err)
			}
		}
		return "", ErrTokenUsed
	}
	if _, err := tx.ExecContext(ctx, `UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`, now, id); err != nil {
		return "", fmt.Errorf("consume password reset code: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE password_credentials SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`, passwordHash, now, now, userID)
	if err != nil {
		return "", fmt.Errorf("update password after reset code: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return "", ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now, now, userID); err != nil {
		return "", fmt.Errorf("revoke sessions after reset code: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset code completion: %w", err)
	}
	return userID, nil
}

func (s *MySQLStore) CreateSession(ctx context.Context, session Session) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin session creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO auth_sessions (id, user_id, access_token_hash, refresh_token_hash, device_id, access_expires_at, refresh_expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, session.ID, session.UserID, session.AccessTokenHash, session.RefreshTokenHash, nullString(session.DeviceID), session.AccessExpiresAt, session.RefreshExpiresAt, now, now); err != nil {
		return mapDBError(err)
	}
	refreshID, err := newID()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO auth_session_refresh_tokens (id, session_id, token_hash, issued_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`, refreshID, session.ID, session.RefreshTokenHash, now, session.RefreshExpiresAt, now); err != nil {
		return mapDBError(err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit session creation: %w", err)
	}
	return nil
}

func (s *MySQLStore) GetSessionByAccessHash(ctx context.Context, tokenHash []byte, now time.Time) (Session, User, error) {
	return s.getSession(ctx, `access_token_hash = ? AND access_expires_at > ?`, tokenHash, now)
}

func (s *MySQLStore) GetSessionByRefreshHash(ctx context.Context, tokenHash []byte, now time.Time) (Session, User, error) {
	return s.getSession(ctx, `refresh_token_hash = ? AND refresh_expires_at > ?`, tokenHash, now)
}

func (s *MySQLStore) getSession(ctx context.Context, predicate string, tokenHash []byte, now time.Time) (Session, User, error) {
	var session Session
	var user User
	var device sql.NullString
	var revoked sql.NullTime
	var accessHash, refreshHash []byte
	query := `SELECT s.id, s.user_id, s.access_token_hash, s.refresh_token_hash, s.device_id, s.access_expires_at, s.refresh_expires_at, s.revoked_at, u.id, u.username_normalized, u.display_name, u.status, EXISTS(SELECT 1 FROM user_recovery_contacts c WHERE c.user_id = u.id AND c.type = 'email' AND c.verified_at IS NOT NULL) FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.` + predicate + ` AND s.revoked_at IS NULL AND u.status = 'active' LIMIT 1`
	err := s.db.QueryRowContext(ctx, query, tokenHash, now).Scan(&session.ID, &session.UserID, &accessHash, &refreshHash, &device, &session.AccessExpiresAt, &session.RefreshExpiresAt, &revoked, &user.ID, &user.Username, &user.DisplayName, &user.Status, &user.EmailVerified)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, User{}, ErrSessionRev
	}
	if err != nil {
		return Session{}, User{}, fmt.Errorf("get session: %w", err)
	}
	session.AccessTokenHash = append([]byte(nil), accessHash...)
	session.RefreshTokenHash = append([]byte(nil), refreshHash...)
	session.DeviceID = device.String
	if revoked.Valid {
		session.RevokedAt = &revoked.Time
	}
	return session, user, nil
}

func (s *MySQLStore) RotateSession(ctx context.Context, sessionID string, oldRefreshHash, accessHash, refreshHash []byte, accessExpiresAt, refreshExpiresAt, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin session rotation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var activeID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM auth_sessions WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ? FOR UPDATE`, sessionID, oldRefreshHash, now).Scan(&activeID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSessionRev
	}
	if err != nil {
		return fmt.Errorf("read session for rotation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_sessions SET access_token_hash = ?, refresh_token_hash = ?, access_expires_at = ?, refresh_expires_at = ?, last_used_at = ? WHERE id = ?`, accessHash, refreshHash, accessExpiresAt, refreshExpiresAt, now, sessionID); err != nil {
		return fmt.Errorf("rotate session: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_session_refresh_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL`, now, oldRefreshHash); err != nil {
		return fmt.Errorf("consume refresh token: %w", err)
	}
	refreshID, err := newID()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO auth_session_refresh_tokens (id, session_id, token_hash, issued_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`, refreshID, sessionID, refreshHash, now, refreshExpiresAt, now); err != nil {
		return mapDBError(err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit session rotation: %w", err)
	}
	return nil
}

func (s *MySQLStore) RevokeSessionForRefreshReplay(ctx context.Context, tokenHash []byte, now time.Time) error {
	var sessionID string
	var consumed sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT session_id, consumed_at FROM auth_session_refresh_tokens WHERE token_hash = ? LIMIT 1`, tokenHash).Scan(&sessionID, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find refresh token history: %w", err)
	}
	if !consumed.Valid {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE id = ? AND revoked_at IS NULL`, now, now, sessionID); err != nil {
		return fmt.Errorf("revoke replayed session: %w", err)
	}
	return nil
}

func (s *MySQLStore) RevokeSession(ctx context.Context, sessionID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE id = ?`, now, now, sessionID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

func (s *MySQLStore) RevokeAllSessions(ctx context.Context, userID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now, now, userID)
	if err != nil {
		return fmt.Errorf("revoke all sessions: %w", err)
	}
	return nil
}

func (s *MySQLStore) RevokeOtherSessions(ctx context.Context, userID, keepSessionID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`, now, now, userID, keepSessionID)
	if err != nil {
		return fmt.Errorf("revoke other sessions: %w", err)
	}
	return nil
}

func (s *MySQLStore) RecordAudit(ctx context.Context, userID, eventType, provider string, ip, userAgent string, now time.Time) error {
	var userValue any
	if userID != "" {
		userValue = userID
	}
	var providerValue any
	if provider != "" {
		providerValue = provider
	}
	var ipHash, userAgentHash []byte
	if ip != "" {
		ipHash = hashAuditValue(ip)
	}
	if userAgent != "" {
		userAgentHash = hashAuditValue(userAgent)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO auth_audit_events (user_id, event_type, provider, ip_hash, user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`, userValue, eventType, providerValue, ipHash, userAgentHash, now)
	if err != nil {
		return fmt.Errorf("record audit event: %w", err)
	}
	return nil
}

func mapDBError(err error) error {
	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return ErrConflict
	}
	return err
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func hashAuditValue(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func newID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
