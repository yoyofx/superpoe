package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHealthHasRandomRequestID(t *testing.T) {
	router := NewRouter(nil, RouterConfig{AllowedOrigin: "https://app.example"})
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d", response.Code)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("health response has no request ID")
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("security headers were not applied")
	}
}

func TestAccountPagesAreAvailable(t *testing.T) {
	router := NewRouter(nil, RouterConfig{})
	for _, path := range []string{"/verify-email?token=test", "/reset-password?token=test"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d", path, response.Code)
		}
		if got := response.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
			t.Fatalf("%s content type = %q", path, got)
		}
		if response.Body.Len() == 0 {
			t.Fatalf("%s returned an empty page", path)
		}
	}
}

func TestRequestIDRejectsControlCharacters(t *testing.T) {
	router := NewRouter(nil, RouterConfig{AllowedOrigin: "https://app.example"})
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("X-Request-ID", "bad\tvalue")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Header().Get("X-Request-ID") == "bad\tvalue" {
		t.Fatal("request ID with control characters was accepted")
	}
}

func TestRateLimiterBoundsWindow(t *testing.T) {
	limiter := newRateLimiter(2, time.Minute, 2)
	now := time.Unix(100, 0)
	if allowed, _ := limiter.allow("client", now); !allowed {
		t.Fatal("first request was limited")
	}
	if allowed, _ := limiter.allow("client", now); !allowed {
		t.Fatal("second request was limited")
	}
	if allowed, retry := limiter.allow("client", now); allowed || retry <= 0 {
		t.Fatal("third request was not limited with a retry duration")
	}
	if allowed, _ := limiter.allow("client", now.Add(time.Minute)); !allowed {
		t.Fatal("request after the window was limited")
	}
}

func TestCORSPreflightAllowlist(t *testing.T) {
	router := NewRouter(nil, RouterConfig{AllowedOrigin: "https://app.example"})
	request := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	request.Header.Set("Origin", "https://app.example")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
		t.Fatalf("allowed preflight = status:%d origin:%q", response.Code, response.Header().Get("Access-Control-Allow-Origin"))
	}

	request = httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	request.Header.Set("Origin", "https://evil.example")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("disallowed preflight status = %d", response.Code)
	}
}

func TestCORSPreflightSupportsMultipleOrigins(t *testing.T) {
	router := NewRouter(nil, RouterConfig{AllowedOrigin: "app://localhost,http://127.0.0.1:3000"})
	for _, origin := range []string{"app://localhost", "http://127.0.0.1:3000"} {
		request := httptest.NewRequest(http.MethodOptions, "/api/auth/me", nil)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != origin {
			t.Fatalf("allowed origin %q = status:%d origin:%q", origin, response.Code, response.Header().Get("Access-Control-Allow-Origin"))
		}
	}
}
