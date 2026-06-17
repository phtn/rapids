import { Data, Effect } from 'effect'

const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 3000

// -----------------------------------------------------------------------------
// Typed config errors (Effect style: errors as data, not thrown)
// -----------------------------------------------------------------------------

export class MissingApiKey extends Data.TaggedError('MissingApiKey')<
  Record<string, never>
> {}

export class InvalidPort extends Data.TaggedError('InvalidPort')<{
  readonly value: string
  readonly message: string
}> {}

export type ConfigError = MissingApiKey | InvalidPort

// -----------------------------------------------------------------------------
// Parsers (pure logic; failures become Effect failures)
// -----------------------------------------------------------------------------

function parsePort(
  value: string | undefined,
): Effect.Effect<number, InvalidPort> {
  if (!value) return Effect.succeed(DEFAULT_PORT)
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return Effect.fail(
      new InvalidPort({
        value,
        message: `Invalid PORT value "${value}". Expected an integer 1-65535.`,
      }),
    )
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (parsed < 1 || parsed > 65535) {
    return Effect.fail(
      new InvalidPort({
        value,
        message: `Invalid PORT value "${value}". Expected 1-65535.`,
      }),
    )
  }
  return Effect.succeed(parsed)
}

function parseOrigins(value: string | undefined): string[] | '*' {
  if (!value || value.trim() === '*') return '*'
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins.length > 0 ? origins : '*'
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface AppConfig {
  host: string
  port: number
  adminApiKey: string
  corsOrigins: string[] | '*'
  dbPath: string
}

/**
 * Load app config from environment.
 * Returns an Effect that may fail with ConfigError (MissingApiKey | InvalidPort).
 * Run with Effect.runSync(loadConfig(env)) or Effect.runPromise(loadConfig(env)).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<AppConfig, ConfigError> {
  return Effect.gen(function* () {
    const adminApiKey = env.API_KEY?.trim()
    if (!adminApiKey) {
      return yield* Effect.fail(new MissingApiKey({}))
    }

    const host = env.HOST?.trim() || DEFAULT_HOST
    const port = yield* parsePort(env.PORT)
    const corsOrigins = parseOrigins(env.CORS_ORIGINS)
    const dbPath = env.DB_PATH?.trim() || 'rapids.db'

    return {
      host,
      port,
      adminApiKey,
      corsOrigins,
      dbPath,
    }
  })
}

/**
 * Get a human-readable message for a ConfigError (e.g. for logging or CLI).
 */
export function configErrorMessage(error: ConfigError): string {
  switch (error._tag) {
    case 'MissingApiKey':
      return 'Missing API_KEY. Set API_KEY in environment before starting the server.'
    case 'InvalidPort':
      return error.message
  }
}
