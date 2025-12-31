import { getDatabase } from '../db/index.ts'

/**
 * App record type
 */
export interface App {
  app_id: string
  name: string
  public_key: string
  private_key: string
  created_at: string
}

/**
 * Input for creating/updating an app
 */
export interface AppInput {
  app_id?: string
  name: string
  public_key: string
  private_key: string
}

/**
 * Initialize the apps table
 */
function ensureTable(): void {
  const db = getDatabase()
  db.run(`
    CREATE TABLE IF NOT EXISTS apps (
      app_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

/**
 * Create a new app
 */
export function createApp(input: AppInput): App {
  ensureTable()
  const db = getDatabase()
  const now = Date.now()
  const appId = input.app_id ?? crypto.randomUUID()

  const stmt = db.prepare(`
    INSERT INTO apps (app_id, name, public_key, private_key, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  stmt.run(appId, input.name, input.public_key, input.private_key, now)

  return {
    app_id: appId,
    name: input.name,
    public_key: input.public_key,
    private_key: input.private_key,
    created_at: new Date(now).toISOString(),
  }
}

/**
 * Get app by app_id
 */
export function getApp(appId: string): App | null {
  ensureTable()
  const db = getDatabase()

  const stmt = db.prepare<
    {
      app_id: string
      name: string
      public_key: string
      private_key: string
      created_at: number
    },
    [string]
  >('SELECT * FROM apps WHERE app_id = ?')
  const row = stmt.get(appId)

  if (!row) return null

  return {
    app_id: row.app_id,
    name: row.name,
    public_key: row.public_key,
    private_key: row.private_key,
    created_at: new Date(row.created_at).toISOString(),
  }
}

/**
 * Update an app
 */
export function updateApp(appId: string, input: Partial<AppInput>): App | null {
  ensureTable()
  const db = getDatabase()

  const existing = getApp(appId)
  if (!existing) return null

  const updates: string[] = []
  const values: string[] = []

  if (input.name !== undefined) {
    updates.push('name = ?')
    values.push(input.name)
  }
  if (input.public_key !== undefined) {
    updates.push('public_key = ?')
    values.push(input.public_key)
  }
  if (input.private_key !== undefined) {
    updates.push('private_key = ?')
    values.push(input.private_key)
  }

  if (updates.length === 0) return existing

  values.push(appId)
  const stmt = db.prepare(
    `UPDATE apps SET ${updates.join(', ')} WHERE app_id = ?`,
  )
  stmt.run(...values)

  return getApp(appId)
}

/**
 * Delete app by app_id
 */
export function deleteApp(appId: string): boolean {
  ensureTable()
  const db = getDatabase()

  const stmt = db.prepare('DELETE FROM apps WHERE app_id = ?')
  const result = stmt.run(appId)

  return result.changes > 0
}

/**
 * List all apps
 */
export function listApps(): App[] {
  ensureTable()
  const db = getDatabase()

  const stmt = db.prepare<
    {
      app_id: string
      name: string
      public_key: string
      private_key: string
      created_at: number
    },
    []
  >('SELECT * FROM apps ORDER BY created_at DESC')
  const rows = stmt.all()

  return rows.map((row) => ({
    app_id: row.app_id,
    name: row.name,
    public_key: row.public_key,
    private_key: row.private_key,
    created_at: new Date(row.created_at).toISOString(),
  }))
}
