ALTER TABLE password_reset_tokens
    ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER consumed_at;
