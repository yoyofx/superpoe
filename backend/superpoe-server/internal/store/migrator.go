package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type MigrationFS interface {
	ReadDir(name string) ([]fs.DirEntry, error)
	ReadFile(name string) ([]byte, error)
}

type migration struct {
	version int64
	name    string
	path    string
}

func RunMigrations(ctx context.Context, db *sql.DB, migrationFS embed.FS) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, applied_at DATETIME(6) NOT NULL) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	var acquired int
	if err := db.QueryRowContext(ctx, `SELECT GET_LOCK('superpoe-server:migrations', 30)`).Scan(&acquired); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	if acquired != 1 {
		return fmt.Errorf("migration lock was not acquired")
	}
	defer func() {
		_, _ = db.ExecContext(context.Background(), `SELECT RELEASE_LOCK('superpoe-server:migrations')`)
	}()

	entries, err := migrationFS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("read migration directory: %w", err)
	}
	migrations := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		parts := strings.SplitN(entry.Name(), "_", 2)
		if len(parts) != 2 {
			continue
		}
		version, parseErr := strconv.ParseInt(parts[0], 10, 64)
		if parseErr != nil || version <= 0 {
			continue
		}
		migrations = append(migrations, migration{version: version, name: entry.Name(), path: filepath.ToSlash(entry.Name())})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	for i := 1; i < len(migrations); i++ {
		if migrations[i-1].version == migrations[i].version {
			return fmt.Errorf("duplicate migration version %d", migrations[i].version)
		}
	}
	for _, migration := range migrations {
		var exists int
		err := db.QueryRowContext(ctx, `SELECT 1 FROM schema_migrations WHERE version = ? LIMIT 1`, migration.version).Scan(&exists)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("check migration %d: %w", migration.version, err)
		}
		sqlBytes, err := migrationFS.ReadFile(migration.path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", migration.name, err)
		}
		if strings.TrimSpace(string(sqlBytes)) == "" {
			return fmt.Errorf("migration %s is empty", migration.name)
		}
		if _, err := db.ExecContext(ctx, string(sqlBytes)); err != nil {
			return fmt.Errorf("apply migration %s: %w", migration.name, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, migration.version, migration.name, time.Now().UTC()); err != nil {
			return fmt.Errorf("record migration %s: %w", migration.name, err)
		}
	}
	return nil
}
