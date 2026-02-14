import { getDatabase } from '../db/index.ts'

/**
 * Shared secret record type
 */
export interface SharedSecret {
  private_key: string
  public_key: string
  created_at: string
}

/**
 * Create a new shared secret entry
 */
export function createSharedSecret(
  privateKey: string,
  publicKey: string,
): SharedSecret {
  const db = getDatabase()
  const now = Date.now()

  const stmt = db.prepare(`
    INSERT INTO shared_secrets (private_key, public_key, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (private_key) DO UPDATE SET public_key = ?, created_at = ?
  `)

  stmt.run(privateKey, publicKey, now, publicKey, now)

  return {
    private_key: privateKey,
    public_key: publicKey,
    created_at: new Date(now).toISOString(),
  }
}

/**
 * Get shared secret by private_key
 */
export function getSharedSecret(privateKey: string): SharedSecret | null {
  const db = getDatabase()

  const stmt = db.prepare<
    { private_key: string; public_key: string; created_at: number },
    [string]
  >('SELECT * FROM shared_secrets WHERE private_key = ?')
  const row = stmt.get(privateKey)

  if (!row) return null

  return {
    private_key: row.private_key,
    public_key: row.public_key,
    created_at: new Date(row.created_at).toISOString(),
  }
}

/**
 * Delete shared secret by private_key
 */
export function deleteSharedSecret(privateKey: string): boolean {
  const db = getDatabase()

  const stmt = db.prepare('DELETE FROM shared_secrets WHERE private_key = ?')
  const result = stmt.run(privateKey)

  return result.changes > 0
}

/**
 * List all shared secrets
 */
export function listSharedSecrets(): SharedSecret[] {
  const db = getDatabase()

  const stmt = db.prepare<
    { private_key: string; public_key: string; created_at: number },
    []
  >('SELECT * FROM shared_secrets ORDER BY created_at DESC')
  const rows = stmt.all()

  return rows.map((row) => ({
    private_key: row.private_key,
    public_key: row.public_key,
    created_at: new Date(row.created_at).toISOString(),
  }))
}
