import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Data, Effect } from 'effect'
import {
  ADMIN_PROJECT_ID,
  ADMIN_PROJECT_NAME,
  ADMIN_TENANT_ID,
  ADMIN_TENANT_NAME,
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_NAME,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
} from '../constants/platform.ts'

// -----------------------------------------------------------------------------
// Typed DB errors (Effect style)
// -----------------------------------------------------------------------------

export class DatabaseInitError extends Data.TaggedError('DatabaseInitError')<{
  readonly message: string
}> {}

export type DbError = DatabaseInitError

/** Human-readable message for a DbError (e.g. for logging or CLI). */
export function dbErrorMessage(error: DbError): string {
  switch (error._tag) {
    case 'DatabaseInitError':
      return error.message
  }
}

// -----------------------------------------------------------------------------
// Internal: sync init logic (may throw)
// -----------------------------------------------------------------------------

function initializeDatabaseSync(dbPath: string): Database {
  if (dbPath !== ':memory:' && !dbPath.startsWith('file:')) {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)

  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA synchronous = NORMAL')
  db.run('PRAGMA busy_timeout = 5000')

  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      auth_result TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tenant_quota_policies (
      tenant_id TEXT PRIMARY KEY,
      requests_per_minute INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tenant_rate_limit_records (
      tenant_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (tenant_id, window_start),
      FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
      project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
      prefix TEXT NOT NULL,
      suffix TEXT NOT NULL,
      name TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      last_used_at INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}',
      scopes TEXT NOT NULL DEFAULT '[]',
      rate_limit INTEGER
    )
  `)

  const apiKeyColumns = new Set(
    db
      .query<{ name: string }, []>('PRAGMA table_info(api_keys)')
      .all()
      .map((row) => row.name),
  )

  if (!apiKeyColumns.has('tenant_id')) {
    db.run(
      `ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}'`,
    )
  }
  if (!apiKeyColumns.has('project_id')) {
    db.run(
      `ALTER TABLE api_keys ADD COLUMN project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`,
    )
  }

  db.run('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix)')
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active)',
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)',
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id)',
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id)',
  )

  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limit_records (
      key_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (key_id, window_start),
      FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS apps (
      app_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at)')

  db.run(`
    CREATE TABLE IF NOT EXISTS shared_secrets (
      private_key TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_shared_secrets_created_at ON shared_secrets(created_at)',
  )

  const now = Date.now()
  db.run(
    'INSERT OR IGNORE INTO tenants (tenant_id, name, created_at) VALUES (?, ?, ?)',
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME, now],
  )
  db.run(
    'INSERT OR IGNORE INTO tenants (tenant_id, name, created_at) VALUES (?, ?, ?)',
    [ADMIN_TENANT_ID, ADMIN_TENANT_NAME, now],
  )
  db.run(
    'INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)',
    [DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID, DEFAULT_PROJECT_NAME, now],
  )
  db.run(
    'INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)',
    [ADMIN_PROJECT_ID, ADMIN_TENANT_ID, ADMIN_PROJECT_NAME, now],
  )
  db.run(
    'INSERT OR IGNORE INTO tenant_quota_policies (tenant_id, requests_per_minute, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [DEFAULT_TENANT_ID, null, now, now],
  )
  db.run(
    'INSERT OR IGNORE INTO tenant_quota_policies (tenant_id, requests_per_minute, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [ADMIN_TENANT_ID, null, now, now],
  )

  return db
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Open the database and run migrations.
 * Uses process.env.DB_PATH or 'rapids.db'. Run at startup and provide the
 * result via setDatabase() before any getDatabase() call.
 */
export function openDatabase(
  dbPath: string = process.env.DB_PATH ?? 'rapids.db',
): Effect.Effect<Database, DatabaseInitError> {
  return Effect.try({
    try: () => initializeDatabaseSync(dbPath),
    catch: (e) =>
      new DatabaseInitError({
        message: e instanceof Error ? e.message : String(e),
      }),
  })
}

/** Store the database instance after openDatabase() succeeds. */
export function setDatabase(db: Database): void {
  dbInstance = db
}

let dbInstance: Database | null = null

/**
 * Return the current database instance. Must be called only after
 * openDatabase() has been run and setDatabase() called with the result.
 */
export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error(
      'Database not initialized. Run openDatabase() and setDatabase() at startup.',
    )
  }
  return dbInstance
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
