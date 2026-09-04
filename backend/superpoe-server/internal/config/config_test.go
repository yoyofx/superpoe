package config

import "testing"

func TestParseKeyAcceptsBase64AndHex(t *testing.T) {
	base64Key, err := parseKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
	if err != nil || len(base64Key) != 32 {
		t.Fatalf("parseKey(base64) = %d bytes, %v", len(base64Key), err)
	}
	hexKey, err := parseKey("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	if err != nil || len(hexKey) != 32 {
		t.Fatalf("parseKey(hex) = %d bytes, %v", len(hexKey), err)
	}
}

func TestParseKeyRejectsWrongLength(t *testing.T) {
	if _, err := parseKey("AQID"); err == nil {
		t.Fatal("parseKey(short) unexpectedly succeeded")
	}
}
