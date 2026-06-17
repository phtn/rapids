import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID } from '../constants/platform.ts'
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

export class ApiKeyConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiKeyConfigValidationError'
  }
}

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

const MIN_KEY_LENGTH = 8
const MAX_KEY_LENGTH = 512

/**
 * Default configuration for API key generation
 */
const DEFAULT_CONFIG: Required<Omit<ApiKeyConfig, 'name'>> & {
  name: string | null
} = {
  prefix: 'A55',
  length: 32,
  charset: 'base64url',
  expiresIn: null,
  metadata: {},
  scopes: [],
  name: null,
  rateLimit: null,
  tenantId: DEFAULT_TENANT_ID,
  projectId: DEFAULT_PROJECT_ID,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScopes(scopes: string[]): string[] {
  return Array.from(
    new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  )
}

function normalizeName(name: string | null): string | null {
  return name?.trim() || null
}

function normalizeConfig(
  config: ApiKeyConfig,
): Required<Omit<ApiKeyConfig, 'name'>> & { name: string | null } {
  const merged = { ...DEFAULT_CONFIG, ...config }

  if (!Number.isInteger(merged.length)) {
    throw new ApiKeyConfigValidationError('"length" must be an integer')
  }
  if (merged.length < MIN_KEY_LENGTH || merged.length > MAX_KEY_LENGTH) {
    throw new ApiKeyConfigValidationError(
      `"length" must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH}`,
    )
  }
  if (!merged.prefix.trim()) {
    throw new ApiKeyConfigValidationError('"prefix" must not be empty')
  }
  if (!CHARSETS[merged.charset]) {
    throw new ApiKeyConfigValidationError('Invalid "charset" value')
  }
  if (merged.expiresIn !== null && !Number.isInteger(merged.expiresIn)) {
    throw new ApiKeyConfigValidationError(
      '"expiresIn" must be an integer (seconds) or null',
    )
  }
  if (!isRecord(merged.metadata)) {
    throw new ApiKeyConfigValidationError('"metadata" must be a JSON object')
  }
  if (
    !Array.isArray(merged.scopes) ||
    merged.scopes.some((scope) => typeof scope !== 'string')
  ) {
    throw new ApiKeyConfigValidationError(
      '"scopes" must be an array of strings',
    )
  }
  if (
    merged.rateLimit !== null &&
    (!Number.isInteger(merged.rateLimit) || merged.rateLimit <= 0)
  ) {
    throw new ApiKeyConfigValidationError(
      '"rateLimit" must be a positive integer or null',
    )
  }
  if (merged.tenantId !== null && typeof merged.tenantId !== 'string') {
    throw new ApiKeyConfigValidationError('"tenantId" must be a string')
  }
  if (merged.projectId !== null && typeof merged.projectId !== 'string') {
    throw new ApiKeyConfigValidationError('"projectId" must be a string')
  }
  if (merged.name !== null && typeof merged.name !== 'string') {
    throw new ApiKeyConfigValidationError('"name" must be a string')
  }

  return {
    ...merged,
    prefix: merged.prefix.trim(),
    name: normalizeName(merged.name),
    tenantId:
      typeof merged.tenantId === 'string' && merged.tenantId.trim()
        ? merged.tenantId.trim()
        : DEFAULT_TENANT_ID,
    projectId:
      typeof merged.projectId === 'string' && merged.projectId.trim()
        ? merged.projectId.trim()
        : DEFAULT_PROJECT_ID,
    metadata: { ...merged.metadata },
    scopes: normalizeScopes(merged.scopes),
  }
}

function recordExists(
  table: 'tenants' | 'projects',
  column: string,
  id: string,
): boolean {
  const db = getDatabase()
  const row = db
    .prepare<{ count: number }, [string]>(
      `SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`,
    )
    .get(id)

  return (row?.count ?? 0) > 0
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : []
  } catch {
    return []
  }
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
    tenantId: row.tenant_id,
    projectId: row.project_id,
    prefix: row.prefix,
    suffix: row.suffix,
    name: row.name,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    isActive: row.is_active === 1,
    metadata: parseJsonObject(row.metadata),
    scopes: parseStringArray(row.scopes),
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

    const mergedConfig = normalizeConfig(config)
    const charset = CHARSETS[mergedConfig.charset]

    if (!recordExists('tenants', 'tenant_id', mergedConfig.tenantId)) {
      throw new ApiKeyConfigValidationError('Unknown "tenantId"')
    }
    if (!recordExists('projects', 'project_id', mergedConfig.projectId)) {
      throw new ApiKeyConfigValidationError('Unknown "projectId"')
    }

    // Generate the raw key
    const randomPart = generateRandomString(mergedConfig.length, charset)
    const rawKey = `${mergedConfig.prefix}${randomPart}`

    // Hash the key for storage
    const keyHash = await hashKey(rawKey)

    // Calculate expiration
    const now = Date.now()
    const expiresAt =
      mergedConfig.expiresIn === null
        ? null
        : now + mergedConfig.expiresIn * 1000

    // Create the record
    const id = generateId()
    const suffix = rawKey.slice(-4)

    const stmt = db.prepare(`
      INSERT INTO api_keys (
        id, key_hash, tenant_id, project_id, prefix, suffix, name, created_at, expires_at,
        is_active, metadata, scopes, rate_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `)

    stmt.run(
      id,
      keyHash,
      mergedConfig.tenantId,
      mergedConfig.projectId,
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
      tenantId: mergedConfig.tenantId,
      projectId: mergedConfig.projectId,
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
    const { isActive, prefix, includeExpired = false } = options
    const offset =
      options.offset !== undefined && options.offset > 0 ? options.offset : 0
    const limit =
      options.limit !== undefined
        ? Math.min(Math.max(options.limit, 1), 100)
        : 50

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
    if (!isRecord(metadata)) {
      throw new ApiKeyConfigValidationError('"metadata" must be a JSON object')
    }

    const normalizedMetadata = { ...metadata }

    const stmt = db.prepare('UPDATE api_keys SET metadata = ? WHERE id = ?')
    const result = stmt.run(JSON.stringify(normalizedMetadata), keyId)

    return result.changes > 0
  },

  /**
   * Update API key scopes
   */
  updateScopes(keyId: string, scopes: string[]): boolean {
    const db = getDatabase()
    if (
      !Array.isArray(scopes) ||
      scopes.some((scope) => typeof scope !== 'string')
    ) {
      throw new ApiKeyConfigValidationError(
        '"scopes" must be an array of strings',
      )
    }

    const normalizedScopes = normalizeScopes(scopes)

    const stmt = db.prepare('UPDATE api_keys SET scopes = ? WHERE id = ?')
    const result = stmt.run(JSON.stringify(normalizedScopes), keyId)

    return result.changes > 0
  },

  /**
   * Rename an API key
   */
  rename(keyId: string, name: string): boolean {
    const db = getDatabase()
    if (typeof name !== 'string') {
      throw new ApiKeyConfigValidationError('"name" must be a string')
    }

    const normalizedName = normalizeName(name)

    const stmt = db.prepare('UPDATE api_keys SET name = ? WHERE id = ?')
    const result = stmt.run(normalizedName, keyId)

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
