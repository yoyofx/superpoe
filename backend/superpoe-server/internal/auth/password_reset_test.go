package auth

import "testing"

func TestNewPasswordResetCodeIsSixDigits(t *testing.T) {
	for i := 0; i < 256; i++ {
		code, err := newPasswordResetCode()
		if err != nil {
			t.Fatalf("newPasswordResetCode() error = %v", err)
		}
		if !validPasswordResetCode(code) {
			t.Fatalf("generated password reset code %q is not six digits", code)
		}
	}
}

func TestValidPasswordResetCode(t *testing.T) {
	for _, value := range []string{"000000", "123456", "999999"} {
		if !validPasswordResetCode(value) {
			t.Errorf("validPasswordResetCode(%q) = false", value)
		}
	}
	for _, value := range []string{"", "12345", "1234567", "１２３４５６", "12a456", "123-56"} {
		if validPasswordResetCode(value) {
			t.Errorf("validPasswordResetCode(%q) = true", value)
		}
	}
}
