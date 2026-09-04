package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const passwordResetCodeQuery = `SELECT id, token_hash, attempt_count FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE`

func TestCompletePasswordResetCodeCountsWrongAttemptsAndLocksOut(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	st := NewMySQL(db)
	now := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	storedHash := hashForTest("123456")
	wrongHash := hashForTest("000000")
	for attempts := uint32(0); attempts < 5; attempts++ {
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(passwordResetCodeQuery)).
			WithArgs("user-1", now).
			WillReturnRows(sqlmock.NewRows([]string{"id", "token_hash", "attempt_count"}).AddRow("reset-1", storedHash, attempts))
		mock.ExpectExec(regexp.QuoteMeta("UPDATE password_reset_tokens SET attempt_count = attempt_count + 1 WHERE id = ?")).
			WithArgs("reset-1").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()

		if _, err := st.CompletePasswordResetCode(context.Background(), "user-1", wrongHash, "password-hash", now, 5); !errors.Is(err, ErrTokenUsed) {
			t.Fatalf("wrong attempt %d error = %v, want ErrTokenUsed", attempts+1, err)
		}
	}

	// The sixth guess is rejected without another increment, so callers cannot
	// keep changing the attempt counter after the limit has been reached.
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(passwordResetCodeQuery)).
		WithArgs("user-1", now).
		WillReturnRows(sqlmock.NewRows([]string{"id", "token_hash", "attempt_count"}).AddRow("reset-1", storedHash, uint32(5)))
	mock.ExpectRollback()
	if _, err := st.CompletePasswordResetCode(context.Background(), "user-1", wrongHash, "password-hash", now, 5); !errors.Is(err, ErrTokenUsed) {
		t.Fatalf("attempt over limit error = %v, want ErrTokenUsed", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations were not met: %v", err)
	}
}

func TestCompletePasswordResetCodeConsumesOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	st := NewMySQL(db)
	now := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	codeHash := hashForTest("123456")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(passwordResetCodeQuery)).
		WithArgs("user-1", now).
		WillReturnRows(sqlmock.NewRows([]string{"id", "token_hash", "attempt_count"}).AddRow("reset-1", codeHash, uint32(0)))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")).
		WithArgs(now, "reset-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE password_credentials SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?")).
		WithArgs("password-hash", now, now, "user-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), last_used_at = ? WHERE user_id = ? AND revoked_at IS NULL")).
		WithArgs(now, now, "user-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if userID, err := st.CompletePasswordResetCode(context.Background(), "user-1", codeHash, "password-hash", now, 5); err != nil || userID != "user-1" {
		t.Fatalf("successful reset = user:%q error:%v", userID, err)
	}

	// The consumed code is no longer returned by the locked lookup.
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(passwordResetCodeQuery)).
		WithArgs("user-1", now).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	if _, err := st.CompletePasswordResetCode(context.Background(), "user-1", codeHash, "password-hash", now, 5); !errors.Is(err, ErrTokenUsed) {
		t.Fatalf("reused reset code error = %v, want ErrTokenUsed", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations were not met: %v", err)
	}
}

func hashForTest(value string) []byte {
	hash := sha256.Sum256([]byte(value))
	return hash[:]
}
