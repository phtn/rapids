/**
 * Configuration options for generating API keys
 */
export interface ApiKeyConfig {
  /** Prefix for the key (e.g., 'sk_', 'pk_', 'A55_') */
  prefix?: string
  /** Length of the random portion (default: 32) */
  length?: number
  /** Character set to use for generation */
  charset?: ApiKeyCharset
  /** Expiration time in seconds from creation (null = never expires) */
  expiresIn?: number | null
  /** Custom metadata to attach to the key */
  metadata?: Record<string, unknown>
  /** Scopes/permissions for this key */
  scopes?: string[]
  /** Human-readable name for the key */
  name?: string
  /** Rate limit per minute (null = unlimited) */
  rateLimit?: number | null
  /** Owning tenant for the key */
  tenantId?: string
  /** Owning project for the key */
  projectId?: string
}

/**
 * Character sets available for key generation
 */
export type ApiKeyCharset =
  | 'alphanumeric' // a-z, A-Z, 0-9
  | 'alphanumeric_lower' // a-z, 0-9
  | 'alphanumeric_upper' // A-Z, 0-9
  | 'hex' // 0-9, a-f
  | 'base64url' // a-z, A-Z, 0-9, -, _

/**
 * Stored API key record
 */
export interface ApiKey {
  id: string
  /** The hashed version of the key (never store raw) */
  keyHash: string
  /** Owning tenant */
  tenantId: string
  /** Owning project */
  projectId: string
  /** The key prefix for identification */
  prefix: string
  /** Last 4 characters for display */
  suffix: string
  /** Human-readable name */
  name: string | null
  /** Creation timestamp */
  createdAt: Date
  /** Expiration timestamp */
  expiresAt: Date | null
  /** Last used timestamp */
  lastUsedAt: Date | null
  /** Whether the key is active */
  isActive: boolean
  /** Attached metadata */
  metadata: Record<string, unknown>
  /** Permissions/scopes */
  scopes: string[]
  /** Rate limit per minute */
  rateLimit: number | null
}

/**
 * Response when creating a new API key
 * The raw key is only returned once during creation
 */
export interface ApiKeyCreateResult {
  /** The full API key (only shown once) */
  key: string
  /** The stored key record (without the raw key) */
  record: ApiKey
}

/**
 * Result of validating an API key
 */
export interface ApiKeyValidationResult {
  valid: boolean
  reason?: 'not_found' | 'expired' | 'revoked' | 'rate_limited'
  key?: ApiKey
}

/**
 * Query options for listing API keys
 */
export interface ApiKeyListOptions {
  /** Filter by active status */
  isActive?: boolean
  /** Filter by prefix */
  prefix?: string
  /** Include expired keys */
  includeExpired?: boolean
  /** Pagination offset */
  offset?: number
  /** Pagination limit */
  limit?: number
}

/**
 * Database row representation
 */
export interface ApiKeyRow {
  id: string
  key_hash: string
  tenant_id: string
  project_id: string
  prefix: string
  suffix: string
  name: string | null
  created_at: number
  expires_at: number | null
  last_used_at: number | null
  is_active: number
  metadata: string
  scopes: string
  rate_limit: number | null
}

/**
 * Tenant record.
 */
export interface Tenant {
  tenant_id: string
  name: string
  created_at: string
}

/**
 * Tenant quota policy.
 */
export interface TenantQuotaPolicy {
  tenant_id: string
  requests_per_minute: number | null
  created_at: string
  updated_at: string
}

/**
 * Project record.
 */
export interface Project {
  project_id: string
  tenant_id: string
  name: string
  created_at: string
}

/**
 * Audit event record.
 */
export interface AuditEvent {
  id: string
  request_id: string
  occurred_at: string
  actor_type: 'admin' | 'api_key'
  actor_id: string
  tenant_id: string
  project_id: string
  method: string
  path: string
  status: number
  auth_result: string
}

/**
 * Usage event record.
 */
export interface UsageEvent {
  id: string
  request_id: string
  occurred_at: string
  actor_type: 'admin' | 'api_key'
  actor_id: string
  tenant_id: string
  project_id: string
  method: string
  path: string
  status: number
}

/**
 * Usage summary for billing.
 */
export interface UsageSummary {
  tenant_id: string
  project_id: string | null
  requests: number
  last_request_at: string | null
}

/**
 * Resolved request context.
 */
export interface RequestContext {
  actorType: 'admin' | 'api_key'
  actorId: string
  tenantId: string
  projectId: string
  scopes: string[]
  keyId?: string
  keyName?: string | null
}
