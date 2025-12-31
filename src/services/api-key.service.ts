import { getDatabase } from '../db/index.ts'
import type {
  ApiKey,
  ApiKeyCharset,
  ApiKeyConfig,
  ApiKeyCreateResult,
  ApiKeyListOptions,
  ApiKeyRow,
  ApiKeyValidationResult,
} from '../types/index.ts'

/**
 * Character sets for key generation
 */
const CHARSETS: Record<ApiKeyCharset, string> = {
  alphanumeric:
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  alphanumeric_lower: 'abcdefghijklmnopqrstuvwxyz0123456789',
  alphanumeric_upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  hex: '0123456789abcdef',
  base64url: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_',
}

/**
 * Default configuration for API key generation
 */
const DEFAULT_CONFIG: Required<Omit<ApiKeyConfig, 'name'>> & {
  name: string | null
} = {
  prefix: 'rapids_',
  length: 32,
  charset: 'base64url',
  expiresIn: null,
  metadata: {},
  scopes: [],
  name: null,
  rateLimit: null,
}

/**
 * Generate a random string using cryptographic randomness
 */
function generateRandomString(length: number, charset: string): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)

  let result = ''
  for (let i = 0; i < length; i++) {
    const value = array[i]
    if (value !== undefined) {
      result += charset[value % charset.length]
    }
  }
  return result
}

/**
 * Generate a UUID v4
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Hash an API key using SHA-256
 */
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert a database row to an ApiKey object
 */
function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    keyHash: row.key_hash,
    prefix: row.prefix,
    suffix: row.suffix,
    name: row.name,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    isActive: row.is_active === 1,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    scopes: JSON.parse(row.scopes) as string[],
    rateLimit: row.rate_limit,
  }
}

/**
 * API Key Service - handles all API key operations
 */
export const ApiKeyService = {
  /**
   * Create a new API key with the given configuration
   */
  async create(config: ApiKeyConfig = {}): Promise<ApiKeyCreateResult> {
    const db = getDatabase()

    const mergedConfig = { ...DEFAULT_CONFIG, ...config }
    const charset = CHARSETS[mergedConfig.charset]

    // Generate the raw key
    const randomPart = generateRandomString(mergedConfig.length, charset)
    const rawKey = `${mergedConfig.prefix}${randomPart}`

    // Hash the key for storage
    const keyHash = await hashKey(rawKey)

    // Calculate expiration
    const now = Date.now()
    const expiresAt = mergedConfig.expiresIn
      ? now + mergedConfig.expiresIn * 1000
      : null

    // Create the record
    const id = generateId()
    const suffix = rawKey.slice(-4)

    const stmt = db.prepare(`
      INSERT INTO api_keys (
        id, key_hash, prefix, suffix, name, created_at, expires_at,
        is_active, metadata, scopes, rate_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `)

    stmt.run(
      id,
      keyHash,
      mergedConfig.prefix,
      suffix,
      mergedConfig.name,
      now,
      expiresAt,
      JSON.stringify(mergedConfig.metadata),
      JSON.stringify(mergedConfig.scopes),
      mergedConfig.rateLimit,
    )

    const record: ApiKey = {
      id,
      keyHash,
      prefix: mergedConfig.prefix,
      suffix,
      name: mergedConfig.name,
      createdAt: new Date(now),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      lastUsedAt: null,
      isActive: true,
      metadata: mergedConfig.metadata,
      scopes: mergedConfig.scopes,
      rateLimit: mergedConfig.rateLimit,
    }

    return { key: rawKey, record }
  },

  /**
   * Validate an API key and optionally update last used time
   */
  async validate(
    key: string,
    options: { updateLastUsed?: boolean; checkRateLimit?: boolean } = {},
  ): Promise<ApiKeyValidationResult> {
    const { updateLastUsed = true, checkRateLimit = true } = options
    const db = getDatabase()

    const keyHash = await hashKey(key)

    const stmt = db.prepare<ApiKeyRow, [string]>(
      'SELECT * FROM api_keys WHERE key_hash = ?',
    )
    const row = stmt.get(keyHash)

    if (!row) {
      return { valid: false, reason: 'not_found' }
    }

    const apiKey = rowToApiKey(row)

    // Check if key is active
    if (!apiKey.isActive) {
      return { valid: false, reason: 'revoked', key: apiKey }
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false, reason: 'expired', key: apiKey }
    }

    // Check rate limit
    if (checkRateLimit && apiKey.rateLimit) {
      const isRateLimited = this.checkRateLimit(apiKey.id, apiKey.rateLimit)
      if (isRateLimited) {
        return { valid: false, reason: 'rate_limited', key: apiKey }
      }
    }

    // Update last used time
    if (updateLastUsed) {
      const updateStmt = db.prepare(
        'UPDATE api_keys SET last_used_at = ? WHERE id = ?',
      )
      updateStmt.run(Date.now(), apiKey.id)
      apiKey.lastUsedAt = new Date()
    }

    return { valid: true, key: apiKey }
  },

  /**
   * Check and update rate limit for a key
   * Returns true if rate limited, false if allowed
   */
  checkRateLimit(keyId: string, limit: number): boolean {
    const db = getDatabase()
    const now = Date.now()
    const windowStart = Math.floor(now / 60000) * 60000 // 1-minute window

    // Clean up old rate limit records
    db.run('DELETE FROM rate_limit_records WHERE window_start < ?', [
      windowStart - 60000,
    ])

    // Get current count
    const stmt = db.prepare<{ request_count: number }, [string, number]>(
      'SELECT request_count FROM rate_limit_records WHERE key_id = ? AND window_start = ?',
    )
    const row = stmt.get(keyId, windowStart)

    if (row && row.request_count >= limit) {
      return true // Rate limited
    }

    // Increment counter
    db.run(
      `
      INSERT INTO rate_limit_records (key_id, window_start, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT (key_id, window_start)
      DO UPDATE SET request_count = request_count + 1
    `,
      [keyId, windowStart],
    )

    return false
  },

  /**
   * Revoke (deactivate) an API key
   */
  revoke(keyId: string): boolean {
    const db = getDatabase()

    const stmt = db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?')
    const result = stmt.run(keyId)

    return result.changes > 0
  },

  /**
   * Delete an API key permanently
   */
  delete(keyId: string): boolean {
    const db = getDatabase()

    const stmt = db.prepare('DELETE FROM api_keys WHERE id = ?')
    const result = stmt.run(keyId)

    return result.changes > 0
  },

  /**
   * Get an API key by ID
   */
  getById(keyId: string): ApiKey | null {
    const db = getDatabase()

    const stmt = db.prepare<ApiKeyRow, [string]>(
      'SELECT * FROM api_keys WHERE id = ?',
    )
    const row = stmt.get(keyId)

    return row ? rowToApiKey(row) : null
  },

  /**
   * List API keys with optional filtering
   */
  list(options: ApiKeyListOptions = {}): ApiKey[] {
    const db = getDatabase()
    const {
      isActive,
      prefix,
      includeExpired = false,
      offset = 0,
      limit = 50,
    } = options

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (isActive !== undefined) {
      conditions.push('is_active = ?')
      params.push(isActive ? 1 : 0)
    }

    if (prefix) {
      conditions.push('prefix = ?')
      params.push(prefix)
    }

    if (!includeExpired) {
      conditions.push('(expires_at IS NULL OR expires_at > ?)')
      params.push(Date.now())
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit, offset)

    const stmt = db.prepare<ApiKeyRow, (string | number)[]>(`
      SELECT * FROM api_keys
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(...params)
    return rows.map(rowToApiKey)
  },

  /**
   * Update API key metadata
   */
  updateMetadata(keyId: string, metadata: Record<string, unknown>): boolean {
    const db = getDatabase()

    const stmt = db.prepare('UPDATE api_keys SET metadata = ? WHERE id = ?')
    const result = stmt.run(JSON.stringify(metadata), keyId)

    return result.changes > 0
  },

  /**
   * Update API key scopes
   */
  updateScopes(keyId: string, scopes: string[]): boolean {
    const db = getDatabase()

    const stmt = db.prepare('UPDATE api_keys SET scopes = ? WHERE id = ?')
    const result = stmt.run(JSON.stringify(scopes), keyId)

    return result.changes > 0
  },

  /**
   * Rename an API key
   */
  rename(keyId: string, name: string): boolean {
    const db = getDatabase()

    const stmt = db.prepare('UPDATE api_keys SET name = ? WHERE id = ?')
    const result = stmt.run(name, keyId)

    return result.changes > 0
  },

  /**
   * Get statistics about API keys
   */
  getStats(): {
    total: number
    active: number
    expired: number
    revoked: number
  } {
    const db = getDatabase()
    const now = Date.now()

    const total =
      db
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM api_keys')
        .get()?.count ?? 0

    const active =
      db
        .query<{ count: number }, [number]>(
          'SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)',
        )
        .get(now)?.count ?? 0

    const expired =
      db
        .query<{ count: number }, [number]>(
          'SELECT COUNT(*) as count FROM api_keys WHERE expires_at IS NOT NULL AND expires_at <= ?',
        )
        .get(now)?.count ?? 0

    const revoked =
      db
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM api_keys WHERE is_active = 0',
        )
        .get()?.count ?? 0

    return { total, active, expired, revoked }
  },
}
