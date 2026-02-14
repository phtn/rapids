/**
 * Extract credential token from Authorization header.
 * Supports "Bearer <token>" and "ApiKey <token>".
 */
export function extractAuthToken(req: Request): string | null {
  const auth = req.headers.get('Authorization')
  if (!auth) return null

  const match = auth.match(/^(?:Bearer|ApiKey)\s+(.+)$/i)
  const token = match?.[1]?.trim()

  return token ? token : null
}

/**
 * Constant-time string comparison to reduce timing side channels.
 */
export function secureCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const length = Math.max(aBytes.length, bBytes.length)

  let mismatch = aBytes.length === bBytes.length ? 0 : 1

  for (let i = 0; i < length; i++) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }

  return mismatch === 0
}
