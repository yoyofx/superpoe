# superpoe-server

`superpoe-server` is the Go/Gin authentication service for SuperPoE accounts.
It is separate from the Electron calculation process and from the PoE trade
site session (`POESESSID`). The first release implements username/password
registration and login, six-digit email-code password reset, session refresh,
logout, and password change. WeChat and QQ provider adapters are planned but
are not enabled by this binary yet.

## Requirements

- Go 1.23 or newer
- MySQL 8.0+
- An HTTPS reverse proxy in production (the service listens on `127.0.0.1`)

Copy `.env.example` to a secret environment file and set the MySQL DSN and a
32-byte `SUPERPOE_DATA_ENCRYPTION_KEY`. Never commit that file or SMTP/database
credentials. `SUPERPOE_ALLOWED_ORIGIN` accepts a comma-separated allowlist.
Desktop builds use `app://localhost` and the Vite development renderer uses
`http://127.0.0.1:3000`; include both when testing the Electron client.

For a local or single-server MySQL deployment, copy the database template and
start the MySQL 8.4 container from this directory:

```bash
cp .env.mysql.example .env.mysql
# Set MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD to different random values.
docker compose up -d
docker compose ps
```

The compose file binds MySQL to `127.0.0.1:3306` and persists data in the
`superpoe_mysql_data` volume. The real `.env.mysql` is intentionally ignored
by Git. Do not run `docker compose down -v` unless you intend to delete the
database volume.

## Run

The exact commands for the deployed Ubuntu host (including the current
`0.0.0.0:80` setup, environment loading under `sudo`, background startup,
stop, logs, and health checks) are documented in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

```powershell
$go = 'C:\Program Files\Go\bin\go.exe'
& $go mod download
& $go run .\cmd\superpoe-server migrate
& $go run .\cmd\superpoe-server serve
```

The default health endpoint is `GET http://127.0.0.1:8787/api/health`.
Migrations are embedded in the binary and use a MySQL advisory lock, so a
deployment does not require manually maintained SQL scripts. The included
systemd unit runs `migrate` as `ExecStartPre` before every service start; the
version lock makes already applied migrations a no-op.

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/password/login`
- `POST /api/auth/email/verify` (legacy optional)
- `POST /api/auth/email/verification/resend` (legacy optional)
- `POST /api/auth/password/reset/request`
- `POST /api/auth/password/reset/confirm`
- `POST /api/auth/session/refresh`
- `GET /api/auth/me` (Bearer access token)
- `POST /api/auth/password/change` (Bearer access token)
- `POST /api/auth/logout` (Bearer access token)
- `POST /api/auth/logout-all` (Bearer access token)

Access and refresh tokens are opaque values; only SHA-256 token hashes are
stored. Refresh tokens rotate and replaying a consumed token revokes its
session. Passwords use Argon2id. Password reset requests generate a random
six-digit code whose hash is stored for a short time. The code is single-use,
older codes are invalidated when a new one is requested, and five failed
guesses exhaust it. Requests always return the same response so they cannot
be used to enumerate accounts. The Electron client asks for the code and new
password in-app; it does not depend on an email deep link.
Registration does not require an email verification step. The legacy email
verification endpoints remain available for existing clients and stored data,
but they are not required for login or password recovery.

## Deployment files

- `deploy/systemd/superpoe-server.service` runs the binary as a dedicated user.
- `deploy/nginx/superpoe-server.conf` is a location snippet to include in the
  existing HTTPS server block.

The service intentionally has no public listener and no access to the
Electron/local PoB data directory.
