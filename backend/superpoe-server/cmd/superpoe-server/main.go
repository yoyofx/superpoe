package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/auth"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/config"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/httpapi"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/mailer"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/security"
	"github.com/yoyofx/superpoe/backend/superpoe-server/internal/store"
	"github.com/yoyofx/superpoe/backend/superpoe-server/migrations"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := sql.Open("mysql", mysqlDSN(cfg.MySQLDSN))
	if err != nil {
		return fmt.Errorf("open mysql: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)
	pingContext, cancelPing := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelPing()
	if err := db.PingContext(pingContext); err != nil {
		return fmt.Errorf("ping mysql: %w", err)
	}
	if len(args) > 0 && args[0] == "migrate" {
		migrationContext, cancelMigration := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancelMigration()
		if err := store.RunMigrations(migrationContext, db, migrations.FS); err != nil {
			return err
		}
		return nil
	}
	if len(args) > 0 && args[0] != "serve" {
		return fmt.Errorf("unknown command %q; use serve or migrate", args[0])
	}
	box, err := security.NewSecretBox(cfg.DataEncryptionKey)
	if err != nil {
		return err
	}
	delivery := mailer.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	service := auth.NewService(store.NewMySQL(db), delivery, box, auth.Config{
		AccessTTL:            cfg.AccessTTL,
		RefreshTTL:           cfg.RefreshTTL,
		PasswordResetTTL:     cfg.PasswordResetTTL,
		EmailVerificationTTL: cfg.EmailVerificationTTL,
		PublicBaseURL:        cfg.PublicBaseURL,
		PasswordHashLimit:    cfg.PasswordHashConcurrency,
	})
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := httpapi.NewRouter(service, httpapi.RouterConfig{AllowedOrigin: cfg.AllowedOrigin, AuthRateLimit: cfg.AuthRateLimit, AuthRateWindow: cfg.AuthRateWindow, AuthRateMaxKeys: cfg.AuthRateMaxKeys})
	server := &http.Server{Addr: cfg.HTTPAddr, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if serveErr := server.ListenAndServe(); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			fmt.Fprintln(os.Stderr, serveErr)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	return server.Shutdown(shutdownContext)
}

func mysqlDSN(value string) string {
	separator := "?"
	if strings.Contains(value, "?") {
		separator = "&"
	}
	return value + separator + "parseTime=true&multiStatements=true&charset=utf8mb4&collation=utf8mb4_0900_ai_ci&loc=UTC"
}
