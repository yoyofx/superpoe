package config

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr                string
	MySQLDSN                string
	PublicBaseURL           string
	AllowedOrigin           string
	DataEncryptionKey       []byte
	AccessTTL               time.Duration
	RefreshTTL              time.Duration
	PasswordResetTTL        time.Duration
	EmailVerificationTTL    time.Duration
	PasswordHashConcurrency int
	AuthRateLimit           int
	AuthRateWindow          time.Duration
	AuthRateMaxKeys         int
	SMTPHost                string
	SMTPPort                int
	SMTPUser                string
	SMTPPassword            string
	SMTPFrom                string
	SecureCookies           bool
}

func Load() (Config, error) {
	c := Config{
		HTTPAddr:                envOr("SUPERPOE_SERVER_ADDR", "127.0.0.1:8787"),
		MySQLDSN:                strings.TrimSpace(os.Getenv("SUPERPOE_MYSQL_DSN")),
		PublicBaseURL:           strings.TrimRight(envOr("SUPERPOE_PUBLIC_BASE_URL", "http://127.0.0.1:8787"), "/"),
		AllowedOrigin:           strings.TrimRight(envOr("SUPERPOE_ALLOWED_ORIGIN", "app://localhost,http://127.0.0.1:3000"), "/"),
		AccessTTL:               durationOr("SUPERPOE_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:              durationOr("SUPERPOE_REFRESH_TTL", 30*24*time.Hour),
		PasswordResetTTL:        durationOr("SUPERPOE_PASSWORD_RESET_TTL", 20*time.Minute),
		EmailVerificationTTL:    durationOr("SUPERPOE_EMAIL_VERIFICATION_TTL", 24*time.Hour),
		PasswordHashConcurrency: intOr("SUPERPOE_PASSWORD_HASH_CONCURRENCY", 2),
		AuthRateLimit:           intOr("SUPERPOE_AUTH_RATE_LIMIT", 60),
		AuthRateWindow:          durationOr("SUPERPOE_AUTH_RATE_WINDOW", time.Minute),
		AuthRateMaxKeys:         intOr("SUPERPOE_AUTH_RATE_MAX_KEYS", 10000),
		SMTPHost:                strings.TrimSpace(os.Getenv("SUPERPOE_SMTP_HOST")),
		SMTPPort:                intOr("SUPERPOE_SMTP_PORT", 587),
		SMTPUser:                os.Getenv("SUPERPOE_SMTP_USER"),
		SMTPPassword:            os.Getenv("SUPERPOE_SMTP_PASSWORD"),
		SMTPFrom:                strings.TrimSpace(os.Getenv("SUPERPOE_SMTP_FROM")),
		SecureCookies:           os.Getenv("SUPERPOE_SECURE_COOKIES") != "0",
	}
	key, err := parseKey(os.Getenv("SUPERPOE_DATA_ENCRYPTION_KEY"))
	if err != nil {
		return Config{}, fmt.Errorf("SUPERPOE_DATA_ENCRYPTION_KEY: %w", err)
	}
	c.DataEncryptionKey = key
	if c.MySQLDSN == "" {
		return Config{}, fmt.Errorf("SUPERPOE_MYSQL_DSN is required")
	}
	if c.PasswordHashConcurrency < 1 || c.PasswordHashConcurrency > 16 {
		return Config{}, fmt.Errorf("SUPERPOE_PASSWORD_HASH_CONCURRENCY must be between 1 and 16")
	}
	if c.AuthRateLimit < 1 || c.AuthRateLimit > 100000 {
		return Config{}, fmt.Errorf("SUPERPOE_AUTH_RATE_LIMIT must be between 1 and 100000")
	}
	if c.AuthRateMaxKeys < 100 || c.AuthRateMaxKeys > 1000000 {
		return Config{}, fmt.Errorf("SUPERPOE_AUTH_RATE_MAX_KEYS must be between 100 and 1000000")
	}
	if c.SMTPHost != "" && c.SMTPFrom == "" {
		return Config{}, fmt.Errorf("SUPERPOE_SMTP_FROM is required when SMTP is enabled")
	}
	return c, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationOr(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func intOr(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, fmt.Errorf("value is required")
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if decoded, err := hex.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	// A deterministic key is never accepted from a short secret. This helper
	// only supports explicit 32-byte key material in base64 or hex form.
	return nil, fmt.Errorf("must be 32 bytes encoded as base64 or hex")
}

// ConfigFingerprint is safe to include in diagnostics; it never exposes key material.
func ConfigFingerprint(c Config) string {
	hash := sha256.Sum256(append([]byte(c.HTTPAddr+"\x00"+c.PublicBaseURL), c.DataEncryptionKey...))
	return hex.EncodeToString(hash[:8])
}
