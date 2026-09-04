package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

type PasswordHasher struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

func DefaultPasswordHasher() PasswordHasher {
	return PasswordHasher{
		Memory:      64 * 1024,
		Iterations:  3,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	}
}

func (h PasswordHasher) Hash(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, h.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, h.Iterations, h.Memory, h.Parallelism, h.KeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		h.Memory, h.Iterations, h.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func (h PasswordHasher) Verify(encoded, password string) (ok bool, needsRehash bool, err error) {
	params, salt, expected, err := parsePHC(encoded)
	if err != nil {
		return false, false, err
	}
	if err := ValidatePassword(password); err != nil {
		return false, false, err
	}
	actual := argon2.IDKey([]byte(password), salt, params.iterations, params.memory, params.parallelism, uint32(len(expected)))
	ok = subtle.ConstantTimeCompare(actual, expected) == 1
	needsRehash = ok && (params.memory != h.Memory || params.iterations != h.Iterations || params.parallelism != h.Parallelism || uint32(len(expected)) != h.KeyLength)
	return ok, needsRehash, nil
}

func ValidatePassword(password string) error {
	if len(password) < 12 || len(password) > 128 {
		return fmt.Errorf("password must be between 12 and 128 bytes")
	}
	if strings.IndexByte(password, 0) >= 0 {
		return fmt.Errorf("password contains an invalid character")
	}
	return nil
}

type phcParams struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
}

func parsePHC(encoded string) (phcParams, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return phcParams{}, nil, nil, fmt.Errorf("unsupported password hash format")
	}
	values := map[string]uint64{}
	for _, item := range strings.Split(parts[3], ",") {
		pair := strings.SplitN(item, "=", 2)
		if len(pair) != 2 {
			return phcParams{}, nil, nil, fmt.Errorf("invalid password hash parameters")
		}
		value, err := strconv.ParseUint(pair[1], 10, 32)
		if err != nil || value == 0 {
			return phcParams{}, nil, nil, fmt.Errorf("invalid password hash parameter")
		}
		values[pair[0]] = value
	}
	if values["m"] < 16*1024 || values["m"] > 1024*1024 || values["t"] > 20 || values["p"] > 16 {
		return phcParams{}, nil, nil, fmt.Errorf("password hash parameters out of bounds")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return phcParams{}, nil, nil, fmt.Errorf("invalid password hash salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 || len(expected) > 64 {
		return phcParams{}, nil, nil, fmt.Errorf("invalid password hash key")
	}
	return phcParams{memory: uint32(values["m"]), iterations: uint32(values["t"]), parallelism: uint8(values["p"])}, salt, expected, nil
}
