# Production Hardening Change Log

This document summarizes all code and configuration changes made to move the service toward production readiness.

## Scope

- Improved security posture.
- Improved request validation and error handling.
- Improved runtime reliability and shutdown behavior.
- Improved observability.
- Improved database initialization consistency.
- Added CI and additional regression tests.

## File-by-file Changes

### `/Users/xpriori/Code/rapids/index.ts`

- Replaced ad-hoc env reads with validated config loading via `loadConfig`.
- Added route compilation at startup (exact and parameterized routes) to avoid per-request route regex construction.
- Added request-scoped UUID (`X-Request-Id`) propagation on all responses.
- Added structured request logging: request ID, method, path, status, and latency.
- Added security response headers:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
- Added CORS origin handling with support for allow-list or wildcard via config.
- Replaced plain string API key comparison with constant-time comparison helper.
- Standardized error handling for 404 and 500.
- Hardened graceful shutdown behavior:
  - `SIGINT` and `SIGTERM` shutdown path.
  - `unhandledRejection` and `uncaughtException` handling.
  - DB close and server stop on shutdown.

### `/Users/xpriori/Code/rapids/src/config/env.ts` (new)

- Added centralized environment parsing and validation.
- Added strict `PORT` validation (integer range `1-65535`).
- Added required `API_KEY` validation at startup.
- Added `CORS_ORIGINS` parser:
  - `*` wildcard support.
  - Comma-separated origin list support.

### `/Users/xpriori/Code/rapids/src/server/auth.ts` (new)

- Added `extractAuthToken(req)`:
  - Supports `Authorization: Bearer <token>`.
  - Supports `Authorization: ApiKey <token>`.
- Added `secureCompare(a, b)`:
  - Constant-time style byte comparison to reduce timing side-channel exposure.

### `/Users/xpriori/Code/rapids/src/server/routes.ts`

- Removed accidental secret leakage from API responses:
  - Removed `X-API-Key` response header that previously exposed `process.env.API_KEY`.
- Reused shared auth extraction helper from `auth.ts`.
- Added strict query validation for list endpoint:
  - `active` and `includeExpired` must be `true` or `false`.
  - `offset` and `limit` must be non-negative integers.
  - `limit` capped to `100`.
  - Invalid query parameters now return `400`.
- Added request body shape validation for key updates:
  - `name` must be string.
  - `scopes` must be array of strings.
  - `metadata` must be object.
- Mapped config validation failures from service layer to `400` on key creation.

### `/Users/xpriori/Code/rapids/src/services/api-key.service.ts`

- Added `ApiKeyConfigValidationError` for explicit config validation failures.
- Added strict config normalization and validation before key creation:
  - `length` must be integer and in range `8..512`.
  - `prefix` must be non-empty (after trim).
  - `charset` must be valid.
  - `expiresIn` must be integer or `null`.
  - `metadata` must be object.
  - `scopes` must be array of strings.
  - `rateLimit` must be positive integer or `null`.
  - `name` must be string if provided.
- Normalized values:
  - Trimmed `prefix` and `name`.
  - Deduplicated/trimmed scopes and removed empty scopes.
- Hardened row deserialization:
  - Safe JSON parsing for `metadata`.
  - Safe array parsing for `scopes`.
  - Fallbacks instead of throwing on malformed persisted JSON.
- Tightened list pagination behavior:
  - `offset` floor at `0`.
  - `limit` constrained to `1..100`.

### `/Users/xpriori/Code/rapids/src/db/index.ts`

- Added DB pragmas for safer production behavior:
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA busy_timeout = 5000`
- Moved all schema setup to centralized DB init:
  - `apps` table creation.
  - `shared_secrets` table creation.
  - Added created-at indexes for both.
- Changed DB path resolution to runtime (`process.env.DB_PATH`) inside initializer so tests can override env cleanly.

### `/Users/xpriori/Code/rapids/src/services/apps.service.ts`

- Removed per-call lazy table creation (`ensureTable`), relying on centralized DB initialization.
- Kept existing API behavior unchanged otherwise.

### `/Users/xpriori/Code/rapids/src/services/shared-secret.service.ts`

- Removed per-call lazy table creation (`ensureTable`), relying on centralized DB initialization.
- Kept existing API behavior unchanged otherwise.

### `/Users/xpriori/Code/rapids/src/services/api-key.service.test.ts`

- Updated charset tests to use non-empty prefixes to align with new prefix validation.
- Added negative tests validating invalid config rejection with `ApiKeyConfigValidationError`:
  - Empty prefix.
  - Too-small key length.
  - Non-positive rate limit.

### `/Users/xpriori/Code/rapids/src/server/auth.test.ts` (new)

- Added tests for token extraction formats.
- Added tests for secure compare equality/inequality and length mismatch.

### `/Users/xpriori/Code/rapids/src/server/routes.test.ts` (new)

- Added regression test ensuring health response does not leak `X-API-Key`.
- Added regression test ensuring invalid list query params return `400`.

### `/Users/xpriori/Code/rapids/.github/workflows/ci.yml` (new)

- Added GitHub Actions CI pipeline for:
  - `bun install --frozen-lockfile`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run test`
- Triggers on push (`main`, `master`) and pull requests.

### `/Users/xpriori/Code/rapids/.env.example`

- Added `API_KEY` placeholder (required at startup now).
- Added `CORS_ORIGINS` example.

### `/Users/xpriori/Code/rapids/README.md`

- Documented admin API key requirement for non-health routes.
- Documented `API_KEY` and `CORS_ORIGINS` environment variables.

## Behavior Changes to Note

- `API_KEY` is now required at startup. Service fails fast if missing.
- All non-health endpoints continue requiring admin auth, but now comparison is hardened.
- Invalid query parameters on `GET /v1/keys` now return `400` instead of being loosely parsed.
- Invalid key creation config now returns `400` with explicit validation messages.
- Response no longer leaks admin API key in headers.

## Usage

### 1) Configure environment

```bash
cp .env.example .env
```

Set at minimum:

```bash
PORT=3000
API_KEY=your-strong-admin-token
DB_PATH=rapids.db
CORS_ORIGINS=*
```

### 2) Start service

Development:

```bash
bun run dev
```

Production binary flow:

```bash
bun run build
bun run start
```

### 3) Call endpoints

Set shell variables:

```bash
export RAPIDS_URL="http://localhost:3000"
export RAPIDS_ADMIN_KEY="your-strong-admin-token"
```

Health check (no auth required):

```bash
curl -s "$RAPIDS_URL/health"
```

Create API key (admin auth required):

```bash
curl -s -X POST "$RAPIDS_URL/v1/keys" \
  -H "Authorization: Bearer $RAPIDS_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Production Key","prefix":"sk_live_","rateLimit":100}'
```

List keys (admin auth required):

```bash
curl -s "$RAPIDS_URL/v1/keys?active=true&limit=20&offset=0" \
  -H "Authorization: Bearer $RAPIDS_ADMIN_KEY"
```

Invalid query example (returns `400`):

```bash
curl -i "$RAPIDS_URL/v1/keys?limit=abc" \
  -H "Authorization: Bearer $RAPIDS_ADMIN_KEY"
```

Missing auth example (returns `401`):

```bash
curl -i "$RAPIDS_URL/v1/keys"
```

## Validation Performed

- `bun run typecheck` passed.
- `bun run lint` passed.
- `bun run test` passed.
- Test total after additions: `37` passing tests.

## Notes

- Local SQLite artifact files changed during execution:
  - `/Users/xpriori/Code/rapids/rapids.db`
  - `/Users/xpriori/Code/rapids/rapids.db-shm`
  - `/Users/xpriori/Code/rapids/rapids.db-wal`
- Those DB artifact modifications were not part of intentional source-code refactoring.
