# Rapids - API Key Generation Service

A fast, customizable API key generation and management service built with Bun.

## Features

- **Customizable API Keys**: Configure prefix, length, character set, expiration, and more
- **Secure Storage**: Keys are hashed with SHA-256 before storage (never stored in plain text)
- **Rate Limiting**: Built-in per-minute rate limiting per key
- **Scopes & Metadata**: Attach permissions and custom metadata to keys
- **SQLite Backend**: Fast, zero-configuration database with WAL mode

## Quick Start

```bash
# Install dependencies
bun install

# Start development server (with hot reload)
bun run dev

# Or run in production mode
bun run start
```

The server runs at `http://localhost:3000` by default.

## API Endpoints

### Health Check

```bash
GET /health
```

### Create API Key

```bash
POST /v1/keys

# Request body (all fields optional)
{
  "prefix": "sk_live_",     # Key prefix (default: "rapids_")
  "length": 32,             # Random portion length (default: 32)
  "charset": "base64url",   # Character set (default: "base64url")
  "expiresIn": 3600,        # Seconds until expiration (null = never)
  "name": "Production Key", # Human-readable name
  "scopes": ["read", "write"], # Permissions
  "rateLimit": 100,         # Requests per minute (null = unlimited)
  "metadata": { ... }       # Custom data
}

# Response
{
  "key": "sk_live_abc123...",  # Full key (only shown once!)
  "id": "uuid",
  "prefix": "sk_live_",
  "name": "Production Key",
  "expiresAt": "2025-01-01T00:00:00.000Z",
  "scopes": ["read", "write"],
  "rateLimit": 100,
  "createdAt": "2025-12-31T00:00:00.000Z"
}
```

**Character Sets:**
- `alphanumeric` - a-z, A-Z, 0-9
- `alphanumeric_lower` - a-z, 0-9
- `alphanumeric_upper` - A-Z, 0-9
- `hex` - 0-9, a-f
- `base64url` - a-z, A-Z, 0-9, -, _ (default)

### Validate API Key

```bash
POST /v1/keys/validate

# Request body
{ "key": "sk_live_abc123..." }

# Response
{
  "valid": true,
  "reason": null,  # or: "not_found", "expired", "revoked", "rate_limited"
  "key": { ... }   # Key details (if found)
}
```

### List API Keys

```bash
GET /v1/keys
GET /v1/keys?active=true          # Filter by active status
GET /v1/keys?prefix=sk_live_      # Filter by prefix
GET /v1/keys?includeExpired=true  # Include expired keys
GET /v1/keys?limit=20&offset=0    # Pagination
```

### Get API Key by ID

```bash
GET /v1/keys/:id
```

### Update API Key

```bash
PATCH /v1/keys/:id

# Request body (all fields optional)
{
  "name": "New Name",
  "scopes": ["read", "write", "delete"],
  "metadata": { "tier": "premium" }
}
```

### Revoke API Key

```bash
POST /v1/keys/:id/revoke
```

### Delete API Key

```bash
DELETE /v1/keys/:id
```

### Get Statistics

```bash
GET /v1/keys/stats

# Response
{
  "total": 100,
  "active": 85,
  "expired": 10,
  "revoked": 5
}
```

### Protected Endpoint (Example)

```bash
GET /v1/protected
Authorization: Bearer sk_live_abc123...

# Response
{
  "message": "You have access to this protected resource!",
  "timestamp": "..."
}
```

## Authentication

Use the `Authorization` header with either format:
- `Bearer <api-key>`
- `ApiKey <api-key>`

## Configuration

Create a `.env` file (Bun loads it automatically):

```bash
# Copy the example
cp .env.example .env
```

Environment variables:
- `PORT` - Server port (default: 3000)
- `DB_PATH` - SQLite database path (default: rapids.db)

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Type check
bun run typecheck

# Lint
bun run lint

# Lint with auto-fix
bun run lint:fix
```

## Project Structure

```
rapids/
├── index.ts                      # Server entry point
├── src/
│   ├── db/
│   │   └── index.ts              # SQLite database setup
│   ├── server/
│   │   ├── index.ts              # Server exports
│   │   └── routes.ts             # API route handlers
│   ├── services/
│   │   ├── api-key.service.ts    # API key business logic
│   │   └── api-key.service.test.ts
│   └── types/
│       └── index.ts              # TypeScript types
├── biome.json                    # Linter config
├── tsconfig.json                 # TypeScript config
└── package.json
```

## License

MIT
