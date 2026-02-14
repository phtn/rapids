const DEFAULT_PORT = 3000

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid PORT value "${value}". Expected an integer 1-65535.`,
    )
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value "${value}". Expected 1-65535.`)
  }

  return parsed
}

function parseOrigins(value: string | undefined): string[] | '*' {
  if (!value || value.trim() === '*') return '*'

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return origins.length > 0 ? origins : '*'
}

export interface AppConfig {
  port: number
  adminApiKey: string
  corsOrigins: string[] | '*'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const adminApiKey = env.API_KEY?.trim()
  if (!adminApiKey) {
    throw new Error(
      'Missing API_KEY. Set API_KEY in environment before starting the server.',
    )
  }

  return {
    port: parsePort(env.PORT),
    adminApiKey,
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
  }
}
