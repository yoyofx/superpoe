package auth

import "testing"

func TestNormalizeUsername(t *testing.T) {
	got, err := NormalizeUsername("  Player_01 ")
	if err != nil || got != "player_01" {
		t.Fatalf("NormalizeUsername() = %q, %v", got, err)
	}
	for _, value := range []string{"ab", "player name", "玩家账号", "player@example.com"} {
		if _, err := NormalizeUsername(value); err == nil {
			t.Errorf("NormalizeUsername(%q) unexpectedly succeeded", value)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	got, err := NormalizeEmail(" User@Example.COM ")
	if err != nil || got != "user@example.com" {
		t.Fatalf("NormalizeEmail() = %q, %v", got, err)
	}
	for _, value := range []string{"not-an-email", "user@example.com\r\nBcc: attacker@example.com", "<user@example.com>"} {
		if _, err := NormalizeEmail(value); err == nil {
			t.Errorf("NormalizeEmail(%q) unexpectedly succeeded", value)
		}
	}
}
