package security

import "testing"

func TestPasswordHasherRoundTrip(t *testing.T) {
	hasher := DefaultPasswordHasher()
	encoded, err := hasher.Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}
	ok, needsRehash, err := hasher.Verify(encoded, "correct horse battery staple")
	if err != nil || !ok || needsRehash {
		t.Fatalf("Verify() = ok:%v needsRehash:%v err:%v", ok, needsRehash, err)
	}
	ok, _, err = hasher.Verify(encoded, "wrong password value")
	if err != nil {
		t.Fatalf("Verify(wrong) error = %v", err)
	}
	if ok {
		t.Fatal("Verify(wrong) unexpectedly succeeded")
	}
}

func TestPasswordValidation(t *testing.T) {
	for _, password := range []string{"", "short", "12345678901"} {
		if err := ValidatePassword(password); err == nil {
			t.Errorf("ValidatePassword(%q) unexpectedly succeeded", password)
		}
	}
	if err := ValidatePassword("123456789012"); err != nil {
		t.Fatalf("ValidatePassword(valid) error = %v", err)
	}
	if err := ValidatePassword("valid-password\x00"); err == nil {
		t.Fatal("ValidatePassword(NUL) unexpectedly succeeded")
	}
}

func TestPasswordHasherRejectsMalformedPHC(t *testing.T) {
	if _, _, err := DefaultPasswordHasher().Verify("not-a-password-hash", "123456789012"); err == nil {
		t.Fatal("Verify(malformed) unexpectedly succeeded")
	}
}
