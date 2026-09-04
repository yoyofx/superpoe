package security

import "testing"

func TestOpaqueTokensAreRandomAndHashed(t *testing.T) {
	first, firstHash, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() error = %v", err)
	}
	second, secondHash, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() second error = %v", err)
	}
	if first == second {
		t.Fatal("two opaque tokens are equal")
	}
	if len(firstHash) != 32 || len(secondHash) != 32 {
		t.Fatalf("token hash lengths = %d, %d", len(firstHash), len(secondHash))
	}
	if string(firstHash) == first || string(secondHash) == second {
		t.Fatal("token hash appears to contain the raw token")
	}
}
