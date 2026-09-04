package security

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func NewOpaqueToken() (string, []byte, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), HashTokenBytes(bytes), nil
}

func HashToken(value string) []byte {
	return HashTokenBytes([]byte(value))
}

func HashTokenBytes(value []byte) []byte {
	hash := sha256.Sum256(value)
	result := make([]byte, len(hash))
	copy(result, hash[:])
	return result
}

func HashTokenHex(value string) string {
	return hex.EncodeToString(HashToken(value))
}
