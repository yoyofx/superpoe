CREATE TABLE IF NOT EXISTS auth_session_refresh_tokens (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash BINARY(32) NOT NULL,
    issued_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY auth_refresh_token_hash_uq (token_hash),
    KEY auth_refresh_token_session_idx (session_id),
    KEY auth_refresh_token_expiry_idx (expires_at),
    CONSTRAINT auth_refresh_token_session_fk FOREIGN KEY (session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO auth_session_refresh_tokens
    (id, session_id, token_hash, issued_at, expires_at, created_at)
SELECT UUID(), s.id, s.refresh_token_hash, s.created_at, s.refresh_expires_at, s.created_at
FROM auth_sessions s
LEFT JOIN auth_session_refresh_tokens h ON h.token_hash = s.refresh_token_hash
WHERE h.id IS NULL;
