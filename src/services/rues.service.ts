import { getDatabase } from '../db/index.ts';

/**
 * Rues record type
 */
export interface Rues {
  app_id: string;
  public_key: string;
  created_at: string;
}

/**
 * Initialize the rues table
 */
function ensureTable(): void {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS rues (
      app_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

/**
 * Create a new rues entry
 */
export function createRues(appId: string, publicKey: string): Rues {
  ensureTable();
  const db = getDatabase();
  const now = Date.now();
  
  const stmt = db.prepare(`
    INSERT INTO rues (app_id, public_key, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (app_id) DO UPDATE SET public_key = ?, created_at = ?
  `);
  
  stmt.run(appId, publicKey, now, publicKey, now);
  
  return {
    app_id: appId,
    public_key: publicKey,
    created_at: new Date(now).toISOString(),
  };
}

/**
 * Get rues by app_id
 */
export function getRues(appId: string): Rues | null {
  ensureTable();
  const db = getDatabase();
  
  const stmt = db.prepare<{ app_id: string; public_key: string; created_at: number }, [string]>(
    'SELECT * FROM rues WHERE app_id = ?'
  );
  const row = stmt.get(appId);
  
  if (!row) return null;
  
  return {
    app_id: row.app_id,
    public_key: row.public_key,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * Delete rues by app_id
 */
export function deleteRues(appId: string): boolean {
  ensureTable();
  const db = getDatabase();
  
  const stmt = db.prepare('DELETE FROM rues WHERE app_id = ?');
  const result = stmt.run(appId);
  
  return result.changes > 0;
}

/**
 * List all rues entries
 */
export function listRues(): Rues[] {
  ensureTable();
  const db = getDatabase();
  
  const stmt = db.prepare<{ app_id: string; public_key: string; created_at: number }, []>(
    'SELECT * FROM rues ORDER BY created_at DESC'
  );
  const rows = stmt.all();
  
  return rows.map(row => ({
    app_id: row.app_id,
    public_key: row.public_key,
    created_at: new Date(row.created_at).toISOString(),
  }));
}
