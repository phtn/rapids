import { Database } from 'bun:sqlite'

/**
 * Initialize the SQLite database with the API keys schema
 */
export function initializeDatabase(): Database {
  const dbPath = process.env.DB_PATH ?? 'rapids.db'
  const db = new Database(dbPath)

  // Enable WAL mode for better concurrent access
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA synchronous = NORMAL')
  db.run('PRAGMA busy_timeout = 5000')

  // Create the api_keys table
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
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

  // Create indices for common queries
  db.run('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix)')
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active)',
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)',
  )

  // Create rate limiting table
  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limit_records (
      key_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (key_id, window_start),
      FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    )
  `)

  // Create applications table
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

  // Create shared secrets table
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

  return db
}

// Singleton database instance
let dbInstance: Database | null = null

export function getDatabase(): Database {
  if (!dbInstance) {
    dbInstance = initializeDatabase()
  }
  return dbInstance
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
