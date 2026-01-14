import { closeDatabase } from './src/db/index.ts'
import { routes } from './src/server/routes.ts'

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10)
const API_KEY = process.env.API_KEY

/**
 * Extract API key from Authorization header
 */
function extractApiKey(req: Request): string | null {
  const auth = req.headers.get('Authorization')
  if (!auth) return null

  // Support "Bearer <key>" and "ApiKey <key>" formats
  const match = auth.match(/^(?:Bearer|ApiKey)\s+(.+)$/i)
  return match?.[1] ?? null
}

/**
 * Middleware to validate API key from .env
 * Always requires API key to be set in environment
 */
function validateApiKey(req: Request): Response | null {
  // API_KEY must be set in environment
  if (!API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'API key authentication is required but API_KEY is not configured',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const key = extractApiKey(req)
  if (!key) {
    return new Response(
      JSON.stringify({ error: 'Missing API key in Authorization header' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  if (key !== API_KEY) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return null // Auth passed
}

/**
 * Route handler type that accepts request and params
 */
type RouteHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>

/**
 * Simple router that matches routes defined in routes.ts
 */
function matchRoute(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  // First check for exact matches
  const exactKey = `${method} ${pathname}` as keyof typeof routes
  if (routes[exactKey]) {
    return { handler: routes[exactKey] as RouteHandler, params: {} }
  }

  // Check for parameterized routes
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = key.split(' ')
    if (routeMethod !== method) continue

    // Convert route pattern to regex
    const paramNames: string[] = []
    const pattern = routePath?.replace(/:(\w+)/g, (_, name: string) => {
      paramNames.push(name)
      return '([^/]+)'
    })

    const regex = new RegExp(`^${pattern}$`)
    const match = pathname.match(regex)

    if (match) {
      const params: Record<string, string> = {}
      paramNames.forEach((name, i) => {
        const value = match[i + 1]
        if (value) {
          params[name] = value
        }
      })
      return { handler: handler as RouteHandler, params }
    }
  }

  return null
}

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url)
    const method = req.method
    const pathname = url.pathname

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Skip API key validation for health check endpoint
    const isHealthCheck = method === 'GET' && pathname === '/health'

    // Validate API key for all routes except health check
    if (!isHealthCheck) {
      const authError = validateApiKey(req)
      if (authError) {
        // Add CORS headers to error response
        const errorHeaders = new Headers(authError.headers)
        for (const [key, value] of Object.entries(corsHeaders)) {
          errorHeaders.set(key, value)
        }
        return new Response(authError.body, {
          status: authError.status,
          headers: errorHeaders,
        })
      }
    }

    // Find matching route
    const match = matchRoute(method, pathname)

    if (!match) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    try {
      const response = await match.handler(req, match.params)

      // Add CORS headers to response
      const newHeaders = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value)
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      })
    } catch (err) {
      console.error('Request error:', err)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
  },
})

console.clear()
console.log(`Rapids API Key Service :${server.port}`)

// if (process.env.NODE_ENV === 'development') {
//   console.log(`
// Rapids API Key Service running at http://localhost:${server.port}

// Available endpoints:
//   GET  /health              - Health check
//   POST /v1/keys             - Create a new API key
//   POST /v1/keys/validate    - Validate an API key
//   GET  /v1/keys             - List all API keys
//   GET  /v1/keys/stats       - Get API key statistics
//   GET  /v1/keys/:id         - Get API key by ID
//   PATCH /v1/keys/:id        - Update API key
//   POST /v1/keys/:id/revoke  - Revoke an API key
//   DELETE /v1/keys/:id       - Delete an API key
//   GET  /v1/protected        - Protected endpoint (requires API key)
//   POST /v1/apps             - Create app
//   GET  /v1/apps             - List all apps
//   GET  /v1/apps/:app_id     - Get app by app_id
//   PATCH /v1/apps/:app_id    - Update app
//   DELETE /v1/apps/:app_id   - Delete app
//   POST /v1/shared-secret    - Create shared secret (private_key, public_key)
//   GET  /v1/shared-secret/:private_key  - Get by private_key
//   DELETE /v1/shared-secret/:private_key - Delete by private_key
//   POST /v1/rues             - Create rues (app_id, public_key)
//   POST /v1/rues/:rue_id     - Get rue by rue_id
//   PATCH /v1/rues/:rue_id    - Update rue
//   DELETE /v1/rues/:rue_id   - Delete rue
// `)
// }

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  closeDatabase()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  closeDatabase()
  process.exit(0)
})
