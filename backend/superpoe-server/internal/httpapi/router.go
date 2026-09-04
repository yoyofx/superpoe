package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/auth"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/mailer"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/security"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/store"
)

type RouterConfig struct {
	AllowedOrigin   string
	AuthRateLimit   int
	AuthRateWindow  time.Duration
	AuthRateMaxKeys int
}

type API struct {
	service *auth.Service
}

type contextSession struct {
	Session store.Session
	User    store.User
}

type registerRequest struct {
	Username    string `json:"username" binding:"required"`
	Password    string `json:"password" binding:"required"`
	Email       string `json:"email" binding:"required"`
	DisplayName string `json:"display_name"`
	DeviceID    string `json:"device_id"`
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	DeviceID string `json:"device_id"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required"`
}

type verifyEmailRequest struct {
	Token string `json:"token" binding:"required"`
}

type resendVerificationRequest struct {
	Email string `json:"email" binding:"required"`
}

type resetRequest struct {
	Email string `json:"email" binding:"required"`
}

type resetConfirmRequest struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	Token       string `json:"token"`
	NewPassword string `json:"new_password" binding:"required"`
}

func NewRouter(service *auth.Service, config RouterConfig) *gin.Engine {
	api := &API{service: service}
	router := gin.New()
	router.Use(gin.Recovery(), requestID(), securityHeaders(), bodyLimit(1<<20), cors(config.AllowedOrigin))
	router.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	router.GET("/verify-email", verifyEmailPage)
	router.GET("/reset-password", resetPasswordPage)

	authRoutes := router.Group("/api/auth")
	authRoutes.Use(newRateLimiter(config.AuthRateLimit, config.AuthRateWindow, config.AuthRateMaxKeys).middleware())
	authRoutes.POST("/register", api.register)
	authRoutes.POST("/password/login", api.login)
	authRoutes.POST("/password/reset/request", api.requestPasswordReset)
	authRoutes.POST("/password/reset/confirm", api.confirmPasswordReset)
	authRoutes.POST("/email/verify", api.verifyEmail)
	authRoutes.POST("/email/verification/resend", api.resendEmailVerification)
	authRoutes.POST("/session/refresh", api.refresh)
	authRoutes.GET("/me", api.requireAuth(), api.me)
	authRoutes.POST("/password/change", api.requireAuth(), api.changePassword)
	authRoutes.POST("/logout", api.requireAuth(), api.logout)
	authRoutes.POST("/logout-all", api.requireAuth(), api.logoutAll)
	return router
}

func (a *API) register(c *gin.Context) {
	var input registerRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, auth.ErrInvalidInput)
		return
	}
	result, err := a.service.Register(c.Request.Context(), auth.RegisterInput{Username: input.Username, Password: input.Password, Email: input.Email, DisplayName: input.DisplayName, DeviceID: input.DeviceID}, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (a *API) login(c *gin.Context) {
	var input loginRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, auth.ErrInvalidCredentials)
		return
	}
	result, err := a.service.Login(c.Request.Context(), auth.LoginInput{Username: input.Username, Password: input.Password, DeviceID: input.DeviceID}, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (a *API) refresh(c *gin.Context) {
	var input refreshRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, store.ErrSessionRev)
		return
	}
	result, err := a.service.Refresh(c.Request.Context(), input.RefreshToken, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": result})
}

func (a *API) me(c *gin.Context) {
	session, user, ok := getSession(c)
	if !ok {
		return
	}
	result, err := a.service.CurrentUserResult(c.Request.Context(), user)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": result, "session_id": session.ID})
}

func (a *API) changePassword(c *gin.Context) {
	session, user, ok := getSession(c)
	if !ok {
		return
	}
	var input changePasswordRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, auth.ErrInvalidInput)
		return
	}
	if err := a.service.ChangePassword(c.Request.Context(), user.ID, session.ID, input.CurrentPassword, input.NewPassword, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *API) logout(c *gin.Context) {
	session, _, ok := getSession(c)
	if !ok {
		return
	}
	if err := a.service.Logout(c.Request.Context(), session.ID); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *API) logoutAll(c *gin.Context) {
	_, user, ok := getSession(c)
	if !ok {
		return
	}
	if err := a.service.LogoutAll(c.Request.Context(), user.ID); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *API) verifyEmail(c *gin.Context) {
	var input verifyEmailRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, store.ErrTokenUsed)
		return
	}
	if err := a.service.VerifyEmail(c.Request.Context(), input.Token); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *API) resendEmailVerification(c *gin.Context) {
	var input resendVerificationRequest
	if err := c.ShouldBindJSON(&input); err == nil {
		// The service intentionally returns no account-existence signal. Do not
		// turn a delivery failure into an enumeration oracle either.
		_ = a.service.ResendEmailVerification(c.Request.Context(), input.Email, c.ClientIP(), c.GetHeader("User-Agent"))
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true, "message": "If the account needs verification, a new email will be sent."})
}

func (a *API) requestPasswordReset(c *gin.Context) {
	var input resetRequest
	requestID := c.Writer.Header().Get("X-Request-ID")
	log.Printf("password reset request received request_id=%s", requestID)
	if err := c.ShouldBindJSON(&input); err == nil {
		// The service deliberately hides whether the address exists and whether
		// delivery succeeded. This endpoint always returns the same response.
		if err := a.service.RequestPasswordReset(c.Request.Context(), input.Email, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
			log.Printf("password reset request failed request_id=%s: %v", requestID, err)
		} else {
			log.Printf("password reset request completed request_id=%s", requestID)
		}
	} else {
		log.Printf("password reset request skipped request_id=%s stage=bind: %v", requestID, err)
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true, "message": "If the account can be recovered, a reset email will be sent."})
}

func (a *API) confirmPasswordReset(c *gin.Context) {
	var input resetConfirmRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		writeError(c, store.ErrTokenUsed)
		return
	}
	if strings.TrimSpace(input.Email) != "" || strings.TrimSpace(input.Code) != "" {
		if err := a.service.ConfirmPasswordResetCode(c.Request.Context(), input.Email, strings.TrimSpace(input.Code), input.NewPassword, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
			writeError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	if strings.TrimSpace(input.Token) == "" {
		writeError(c, store.ErrTokenUsed)
		return
	}
	if err := a.service.ConfirmPasswordReset(c.Request.Context(), input.Token, input.NewPassword, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *API) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeError(c, store.ErrSessionRev)
			c.Abort()
			return
		}
		session, user, err := a.service.Authenticate(c.Request.Context(), strings.TrimSpace(parts[1]))
		if err != nil {
			writeError(c, err)
			c.Abort()
			return
		}
		c.Set("auth.session", contextSession{Session: session, User: user})
		c.Next()
	}
}

func getSession(c *gin.Context) (store.Session, store.User, bool) {
	value, exists := c.Get("auth.session")
	if !exists {
		writeError(c, store.ErrSessionRev)
		return store.Session{}, store.User{}, false
	}
	contextValue, ok := value.(contextSession)
	if !ok {
		writeError(c, store.ErrSessionRev)
		return store.Session{}, store.User{}, false
	}
	return contextValue.Session, contextValue.User, true
}

func writeError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	code := "internal_error"
	message := "The server could not complete the request."
	switch {
	case errors.Is(err, auth.ErrInvalidInput):
		status, code, message = http.StatusBadRequest, "invalid_input", "The submitted data is invalid."
	case errors.Is(err, auth.ErrInvalidCredentials):
		status, code, message = http.StatusUnauthorized, "invalid_credentials", "Username or password is incorrect."
	case errors.Is(err, auth.ErrRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "Too many attempts. Try again later."
	case errors.Is(err, auth.ErrInvalidState):
		status, code, message = http.StatusForbidden, "account_unavailable", "This account is not available."
	case errors.Is(err, store.ErrSessionRev):
		status, code, message = http.StatusUnauthorized, "session_invalid", "The session is invalid or expired."
	case errors.Is(err, store.ErrTokenUsed):
		status, code, message = http.StatusBadRequest, "token_invalid", "The verification code or link is invalid or expired."
	case errors.Is(err, mailer.ErrNotConfigured):
		status, code, message = http.StatusServiceUnavailable, "email_unavailable", "Email delivery is temporarily unavailable."
	}
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if !validRequestID(requestID) {
			requestID = ""
		}
		if requestID == "" {
			generated, err := security.NewID()
			if err == nil {
				requestID = generated
			} else {
				// crypto/rand failure is exceptional; retain a unique diagnostic
				// value so the request still has a useful correlation identifier.
				requestID = strconv.FormatInt(time.Now().UnixNano(), 10)
			}
		}
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func validRequestID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if char < 0x21 || char > 0x7e {
			return false
		}
	}
	return true
}

type rateLimitBucket struct {
	started time.Time
	count   int
}

type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	maxKeys int
	buckets map[string]rateLimitBucket
}

func newRateLimiter(limit int, window time.Duration, maxKeys int) *rateLimiter {
	if limit < 1 {
		limit = 60
	}
	if window <= 0 {
		window = time.Minute
	}
	if maxKeys < 1 {
		maxKeys = 10000
	}
	return &rateLimiter{limit: limit, window: window, maxKeys: maxKeys, buckets: make(map[string]rateLimitBucket)}
}

func (r *rateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for existingKey, bucket := range r.buckets {
		if now.Sub(bucket.started) >= r.window {
			delete(r.buckets, existingKey)
		}
	}
	bucket, exists := r.buckets[key]
	if !exists {
		if len(r.buckets) >= r.maxKeys {
			// The map is bounded even when an attacker rotates source IPs. Drop
			// the oldest bucket; this is preferable to unbounded memory growth.
			oldestKey := ""
			var oldest time.Time
			for candidate, candidateBucket := range r.buckets {
				if oldestKey == "" || candidateBucket.started.Before(oldest) {
					oldestKey, oldest = candidate, candidateBucket.started
				}
			}
			if oldestKey != "" {
				delete(r.buckets, oldestKey)
			}
		}
		bucket = rateLimitBucket{started: now}
	}
	if bucket.count >= r.limit {
		r.buckets[key] = bucket
		remaining := r.window - now.Sub(bucket.started)
		if remaining < time.Second {
			remaining = time.Second
		}
		return false, remaining
	}
	bucket.count++
	r.buckets[key] = bucket
	return true, 0
}

func (r *rateLimiter) middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		allowed, retryAfter := r.allow(c.ClientIP(), time.Now().UTC())
		if !allowed {
			c.Header("Retry-After", strconv.Itoa(maxInt(1, int(retryAfter/time.Second))))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": gin.H{"code": "rate_limited", "message": "Too many attempts. Try again later."}})
			return
		}
		c.Next()
	}
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func bodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}

func cors(allowedOrigin string) gin.HandlerFunc {
	allowedOrigins := make(map[string]struct{})
	for _, candidate := range strings.Split(allowedOrigin, ",") {
		candidate = strings.TrimRight(strings.TrimSpace(candidate), "/")
		if candidate != "" {
			allowedOrigins[candidate] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		origin := strings.TrimRight(strings.TrimSpace(c.GetHeader("Origin")), "/")
		_, allowed := allowedOrigins[origin]
		if origin != "" && allowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if c.Request.Method == http.MethodOptions {
			if origin == "" || !allowed {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
