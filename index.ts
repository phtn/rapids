import { Cause, Effect, Option } from 'effect'
import {
  type ConfigError,
  configErrorMessage,
  loadConfig,
} from './src/config/env.ts'
import {
  type DbError,
  closeDatabase,
  dbErrorMessage,
  openDatabase,
  setDatabase,
} from './src/db/index.ts'
import { extractAuthToken, secureCompare } from './src/server/auth.ts'
import {
  type ResolvedRequestContext,
  createAdminContext,
  resolveRequestContext,
} from './src/server/request-context.ts'
import { routes } from './src/server/routes.ts'
import { AuditService } from './src/services/audit.service.ts'
import { ControlPlaneService } from './src/services/control-plane.service.ts'

type RouteHandler = (
  req: Request,
  params: Record<string, string>,
  context?: ResolvedRequestContext,
) => Response | Promise<Response>

interface CompiledRoute {
  method: string
  regex: RegExp
  paramNames: string[]
  handler: RouteHandler
}

interface MatchResult {
  handler: RouteHandler
  params: Record<string, string>
}

const configExit = Effect.runSyncExit(loadConfig())
if (configExit._tag === 'Failure') {
  const message = Option.match(Cause.failureOption(configExit.cause), {
    onNone: () => 'Configuration failed.',
    onSome: (err: ConfigError) => configErrorMessage(err),
  })
  console.error('Configuration error:', message)
  process.exit(1)
}
const config = configExit.value

const dbExit = Effect.runSyncExit(openDatabase(config.dbPath))
if (dbExit._tag === 'Failure') {
  const message = Option.match(Cause.failureOption(dbExit.cause), {
    onNone: () => 'Database failed to open.',
    onSome: (err: DbError) => dbErrorMessage(err),
  })
  console.error('Database error:', message)
  process.exit(1)
}
setDatabase(dbExit.value)

const EXACT_ROUTES = new Map<string, RouteHandler>()
const PARAMETERIZED_ROUTES: CompiledRoute[] = []

function escapeRegexSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePath(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        const name = segment.slice(1)
        if (!name) {
          throw new Error(`Invalid route parameter in path: "${path}"`)
        }
        paramNames.push(name)
        return '([^/]+)'
      }

      return escapeRegexSegment(segment)
    })
    .join('/')

  return { regex: new RegExp(`^${pattern}$`), paramNames }
}

for (const [key, handler] of Object.entries(routes)) {
  const [method, path] = key.split(' ')
  if (!method || !path) {
    throw new Error(`Invalid route definition "${key}"`)
  }

  const routeHandler = handler as RouteHandler
  if (!path.includes(':')) {
    EXACT_ROUTES.set(`${method} ${path}`, routeHandler)
    continue
  }

  const { regex, paramNames } = compilePath(path)
  PARAMETERIZED_ROUTES.push({
    method,
    regex,
    paramNames,
    handler: routeHandler,
  })
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function healthResponse(): Response {
  return json({ status: 'ok', timestamp: new Date().toISOString() })
}

function readinessResponse(): Response {
  if (shuttingDown) {
    return json({ status: 'draining' }, 503)
  }

  return json({ status: 'ready' })
}

function validateAdminApiKey(req: Request): Response | null {
  const token = extractAuthToken(req)
  if (!token) {
    return json({ error: 'Missing API key in Authorization header' }, 401)
  }

  if (!secureCompare(token, config.adminApiKey)) {
    return json({ error: 'Invalid API key' }, 401)
  }

  return null
}

const PUBLIC_CONTEXT_ROUTES = new Set(['GET /v1/context', 'GET /v1/protected'])

function matchRoute(method: string, pathname: string): MatchResult | null {
  const exact = EXACT_ROUTES.get(`${method} ${pathname}`)
  if (exact) {
    return { handler: exact, params: {} }
  }

  for (const route of PARAMETERIZED_ROUTES) {
    if (route.method !== method) continue

    const match = pathname.match(route.regex)
    if (!match) continue

    const params: Record<string, string> = {}
    route.paramNames.forEach((name, index) => {
      const value = match[index + 1]
      if (!value) return

      try {
        params[name] = decodeURIComponent(value)
      } catch {
        params[name] = value
      }
    })

    return { handler: route.handler, params }
  }

  return null
}

function getCorsOrigin(req: Request): string | null {
  const requestOrigin = req.headers.get('Origin')
  if (config.corsOrigins === '*') {
    return '*'
  }

  if (!requestOrigin) {
    return null
  }

  return config.corsOrigins.includes(requestOrigin) ? requestOrigin : null
}

function withResponseHeaders(
  response: Response,
  req: Request,
  requestId: string,
): Response {
  const headers = new Headers(response.headers)
  const corsOrigin = getCorsOrigin(req)
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin)
    headers.set('Vary', 'Origin')
  }
  headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  )
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Request-Id', requestId)

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function logRequest(
  requestId: string,
  method: string,
  path: string,
  status: number,
  startTime: number,
): void {
  const durationMs = (performance.now() - startTime).toFixed(1)
  console.info(`[${requestId}] ${method} ${path} ${status} ${durationMs}ms`)
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    const requestId = crypto.randomUUID()
    const startTime = performance.now()
    const url = new URL(req.url)
    const method = req.method
    const pathname = url.pathname
    const routeKey = `${method} ${pathname}`
    let requestContext: ResolvedRequestContext | null = null
    let authResult: 'admin' | 'api_key' | null = null

    if (method === 'OPTIONS') {
      const response = withResponseHeaders(
        new Response(null, { status: 204 }),
        req,
        requestId,
      )
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    }

    const isHealthCheck = method === 'GET' && pathname === '/health'
    if (isHealthCheck) {
      const response = withResponseHeaders(healthResponse(), req, requestId)
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    }

    const isReadinessCheck = method === 'GET' && pathname === '/ready'
    if (isReadinessCheck) {
      const response = withResponseHeaders(readinessResponse(), req, requestId)
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    }

    if (PUBLIC_CONTEXT_ROUTES.has(routeKey)) {
      const resolved = await resolveRequestContext(req, config.adminApiKey, {
        updateLastUsed: pathname === '/v1/protected',
      })

      if (resolved instanceof Response) {
        const response = withResponseHeaders(resolved, req, requestId)
        logRequest(requestId, method, pathname, response.status, startTime)
        return response
      }

      requestContext = resolved
      authResult = resolved.authResult
    } else if (!isHealthCheck) {
      const authError = validateAdminApiKey(req)
      if (authError) {
        const response = withResponseHeaders(authError, req, requestId)
        logRequest(requestId, method, pathname, response.status, startTime)
        return response
      }

      requestContext = createAdminContext()
      authResult = 'admin'
    }

    if (requestContext?.authResult === 'api_key') {
      const quota = ControlPlaneService.consumeTenantQuota(
        requestContext.context.tenantId,
      )
      if (!quota.allowed) {
        const resolvedAuthResult: 'admin' | 'api_key' = authResult ?? 'api_key'
        const response = withResponseHeaders(
          json(
            {
              error: 'Tenant rate limit exceeded',
              tenantId: requestContext.context.tenantId,
              limitPerMinute: quota.limit,
            },
            429,
          ),
          req,
          requestId,
        )
        try {
          AuditService.record({
            requestId,
            actorType: requestContext.context.actorType,
            actorId: requestContext.context.actorId,
            tenantId: requestContext.context.tenantId,
            projectId: requestContext.context.projectId,
            method,
            path: pathname,
            status: response.status,
            authResult: resolvedAuthResult,
          })
        } catch (err) {
          console.warn(`[${requestId}] Audit logging failed`, err)
        }
        logRequest(requestId, method, pathname, response.status, startTime)
        return response
      }
    }

    const match = matchRoute(method, pathname)
    if (!match) {
      const response = withResponseHeaders(
        json({ error: 'Not found' }, 404),
        req,
        requestId,
      )
      if (requestContext && authResult) {
        try {
          AuditService.record({
            requestId,
            actorType: requestContext.context.actorType,
            actorId: requestContext.context.actorId,
            tenantId: requestContext.context.tenantId,
            projectId: requestContext.context.projectId,
            method,
            path: pathname,
            status: response.status,
            authResult,
          })
        } catch (err) {
          console.warn(`[${requestId}] Audit logging failed`, err)
        }
      }
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    }

    try {
      const routeResponse = await match.handler(
        req,
        match.params,
        requestContext ?? undefined,
      )
      const response = withResponseHeaders(routeResponse, req, requestId)
      if (requestContext && authResult) {
        try {
          AuditService.record({
            requestId,
            actorType: requestContext.context.actorType,
            actorId: requestContext.context.actorId,
            tenantId: requestContext.context.tenantId,
            projectId: requestContext.context.projectId,
            method,
            path: pathname,
            status: response.status,
            authResult,
          })
        } catch (err) {
          console.warn(`[${requestId}] Audit logging failed`, err)
        }
      }
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    } catch (err) {
      console.error(`[${requestId}] Request error`, err)
      const response = withResponseHeaders(
        json({ error: 'Internal server error' }, 500),
        req,
        requestId,
      )
      logRequest(requestId, method, pathname, response.status, startTime)
      return response
    }
  },
})

let shuttingDown = false

console.log(
  `Rapids API Key Service listening on ${config.host}:${server.port} (db: ${config.dbPath})`,
)

function shutdown(signal: string, exitCode = 0): void {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`\nReceived ${signal}. Shutting down...`)
  server.stop(true)
  closeDatabase()
  process.exit(exitCode)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err)
  shutdown('unhandledRejection', 1)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  shutdown('uncaughtException', 1)
})
