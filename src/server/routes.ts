import {
  ApiKeyConfigValidationError,
  ApiKeyService,
} from '../services/api-key.service.ts'
import { AuditService } from '../services/audit.service.ts'
import { ControlPlaneService } from '../services/control-plane.service.ts'
import type { ApiKeyConfig, ApiKeyListOptions } from '../types/index.ts'
import { extractAuthToken } from './auth.ts'
import type { ResolvedRequestContext } from './request-context.ts'
import { resolveRequestContext } from './request-context.ts'

/**
 * JSON response helper
 */
function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Error response helper
 */
function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

/**
 * Parse JSON body safely
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text()
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * Parse non-negative integer query params with bounds checking.
 */
function parseNonNegativeInt(
  value: string | null,
  key: string,
  defaultsTo: number,
  max?: number,
): number {
  if (value === null) return defaultsTo

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid "${key}" query parameter. Expected a non-negative integer.`,
    )
  }

  const parsed = Number.parseInt(trimmed, 10)

  if (max !== undefined) {
    return Math.min(parsed, max)
  }

  return parsed
}

function parseBoolean(value: string | null, key: string): boolean | undefined {
  if (value === null) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(
    `Invalid "${key}" query parameter. Expected "true" or "false".`,
  )
}

/**
 * Middleware to validate API key for protected routes
 */
async function requireAuth(req: Request): Promise<Response | null> {
  const key = extractAuthToken(req)
  if (!key) {
    return error('Missing API key in Authorization header', 401)
  }

  const result = await ApiKeyService.validate(key)
  if (!result.valid) {
    const messages: Record<string, string> = {
      not_found: 'Invalid API key',
      expired: 'API key has expired',
      revoked: 'API key has been revoked',
      rate_limited: 'Rate limit exceeded',
    }
    const status = result.reason === 'rate_limited' ? 429 : 401
    return error(
      messages[result.reason ?? 'not_found'] ?? 'Unauthorized',
      status,
    )
  }

  return null // Auth passed
}

/**
 * Route handlers for the API
 */
export const routes = {
  /**
   * Health check endpoint
   */
  'GET /health': () => {
    return json({ status: 'ok', timestamp: new Date().toISOString() })
  },

  /**
   * Create a new API key
   * Returns just the key string for easy copy/paste
   */
  'POST /v1/keys': async (req: Request) => {
    const body = await parseBody<ApiKeyConfig>(req)

    try {
      const result = await ApiKeyService.create(body ?? {})

      // Simple response - just the key users need
      return json(
        {
          key: result.key,
          id: result.record.id,
          tenantId: result.record.tenantId,
          projectId: result.record.projectId,
          expiresAt: result.record.expiresAt?.toISOString() ?? null,
        },
        201,
      )
    } catch (err) {
      if (err instanceof ApiKeyConfigValidationError) {
        return error(err.message, 400)
      }
      console.error('Error creating API key:', err)
      return error('Failed to create API key', 500)
    }
  },

  /**
   * Validate an API key
   */
  'POST /v1/keys/validate': async (req: Request) => {
    const body = await parseBody<{ key: string }>(req)

    if (!body?.key) {
      return error('Missing "key" in request body')
    }

    const result = await ApiKeyService.validate(body.key, {
      updateLastUsed: false,
    })

    return json({
      valid: result.valid,
      reason: result.reason ?? null,
      key: result.key
        ? {
            id: result.key.id,
            prefix: result.key.prefix,
            suffix: result.key.suffix,
            name: result.key.name,
            tenantId: result.key.tenantId,
            projectId: result.key.projectId,
            scopes: result.key.scopes,
            expiresAt: result.key.expiresAt?.toISOString() ?? null,
            isActive: result.key.isActive,
          }
        : null,
    })
  },

  /**
   * List all API keys
   */
  'GET /v1/keys': (req: Request) => {
    const url = new URL(req.url)

    let options: ApiKeyListOptions
    try {
      options = {
        isActive: parseBoolean(url.searchParams.get('active'), 'active'),
        prefix: url.searchParams.get('prefix') ?? undefined,
        includeExpired:
          parseBoolean(
            url.searchParams.get('includeExpired'),
            'includeExpired',
          ) ?? false,
        offset: parseNonNegativeInt(
          url.searchParams.get('offset'),
          'offset',
          0,
        ),
        limit: parseNonNegativeInt(
          url.searchParams.get('limit'),
          'limit',
          50,
          100,
        ),
      }
    } catch (err) {
      return error(
        err instanceof Error ? err.message : 'Invalid query parameters',
        400,
      )
    }

    const keys = ApiKeyService.list(options)

    return json({
      keys: keys.map((k) => ({
        id: k.id,
        prefix: k.prefix,
        suffix: k.suffix,
        name: k.name,
        tenantId: k.tenantId,
        projectId: k.projectId,
        isActive: k.isActive,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
      count: keys.length,
    })
  },

  /**
   * Get API key by ID
   */
  'GET /v1/keys/:id': (_req: Request, params: Record<string, string>) => {
    const key = ApiKeyService.getById(params.id ?? '')

    if (!key) {
      return error('API key not found', 404)
    }

    return json({
      id: key.id,
      prefix: key.prefix,
      suffix: key.suffix,
      name: key.name,
      tenantId: key.tenantId,
      projectId: key.projectId,
      isActive: key.isActive,
      scopes: key.scopes,
      metadata: key.metadata,
      rateLimit: key.rateLimit,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt?.toISOString() ?? null,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    })
  },

  /**
   * Update API key
   */
  'PATCH /v1/keys/:id': async (
    req: Request,
    params: Record<string, string>,
  ) => {
    const keyId = params.id ?? ''
    const key = ApiKeyService.getById(keyId)
    if (!key) {
      return error('API key not found', 404)
    }

    const body = await parseBody<{
      name?: string
      scopes?: string[]
      metadata?: Record<string, unknown>
    }>(req)

    if (!body) {
      return error('Invalid request body')
    }

    if (body.name !== undefined && typeof body.name !== 'string') {
      return error('"name" must be a string')
    }
    if (
      body.scopes !== undefined &&
      (!Array.isArray(body.scopes) ||
        body.scopes.some((scope) => typeof scope !== 'string'))
    ) {
      return error('"scopes" must be an array of strings')
    }
    if (
      body.metadata !== undefined &&
      (typeof body.metadata !== 'object' ||
        body.metadata === null ||
        Array.isArray(body.metadata))
    ) {
      return error('"metadata" must be an object')
    }

    let updated = false

    if (body.name !== undefined) {
      updated = ApiKeyService.rename(keyId, body.name) || updated
    }

    if (body.scopes !== undefined) {
      updated = ApiKeyService.updateScopes(keyId, body.scopes) || updated
    }

    if (body.metadata !== undefined) {
      updated = ApiKeyService.updateMetadata(keyId, body.metadata) || updated
    }

    if (!updated) {
      return error('No fields to update')
    }

    const updatedKey = ApiKeyService.getById(keyId)
    return json({
      message: 'API key updated',
      key: updatedKey
        ? {
            id: updatedKey.id,
            name: updatedKey.name,
            tenantId: updatedKey.tenantId,
            projectId: updatedKey.projectId,
            scopes: updatedKey.scopes,
            metadata: updatedKey.metadata,
          }
        : null,
    })
  },

  /**
   * Revoke API key
   */
  'POST /v1/keys/:id/revoke': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const success = ApiKeyService.revoke(params.id ?? '')

    if (!success) {
      return error('API key not found', 404)
    }

    return json({ message: 'API key revoked successfully' })
  },

  /**
   * Delete API key
   */
  'DELETE /v1/keys/:id': (_req: Request, params: Record<string, string>) => {
    const success = ApiKeyService.delete(params.id ?? '')

    if (!success) {
      return error('API key not found', 404)
    }

    return json({ message: 'API key deleted successfully' })
  },

  /**
   * Get API key statistics
   */
  'GET /v1/keys/stats': () => {
    const stats = ApiKeyService.getStats()
    return json(stats)
  },

  /**
   * Protected endpoint example - requires valid API key
   */
  'GET /v1/protected': async (req: Request) => {
    const authError = await requireAuth(req)
    if (authError) return authError

    return json({
      message: 'You have access to this protected resource!',
      timestamp: new Date().toISOString(),
    })
  },

  /**
   * Resolve the current request context.
   * Accepts either the admin API key or a project API key.
   */
  'GET /v1/context': async (
    req: Request,
    _params: Record<string, string>,
    context?: ResolvedRequestContext,
  ) => {
    const resolved =
      context ??
      (await resolveRequestContext(req, process.env.API_KEY ?? '', {
        updateLastUsed: false,
      }))

    if (resolved instanceof Response) {
      return resolved
    }

    const { context: requestContext, authResult } = resolved
    return json({
      authResult,
      actorType: requestContext.actorType,
      actorId: requestContext.actorId,
      tenantId: requestContext.tenantId,
      projectId: requestContext.projectId,
      scopes: requestContext.scopes,
      key:
        requestContext.actorType === 'api_key'
          ? {
              id: requestContext.keyId,
              name: requestContext.keyName,
            }
          : null,
      timestamp: new Date().toISOString(),
    })
  },

  /**
   * Create a new app
   */
  'POST /v1/apps': async (req: Request) => {
    const body = await parseBody<{
      app_id?: string
      name: string
      public_key: string
      private_key: string
    }>(req)

    if (!body?.name) {
      return error('Missing "name" in request body')
    }
    if (!body?.public_key) {
      return error('Missing "public_key" in request body')
    }
    if (!body?.private_key) {
      return error('Missing "private_key" in request body')
    }

    const { createApp } = await import('../services/apps.service.ts')
    const result = createApp(body)

    return json(result, 201)
  },

  /**
   * List all apps
   */
  'GET /v1/apps': async () => {
    const { listApps } = await import('../services/apps.service.ts')
    const apps = listApps()
    return json({ apps, count: apps.length })
  },

  /**
   * Get app by app_id
   */
  'GET /v1/apps/:app_id': async (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const { getApp } = await import('../services/apps.service.ts')
    const result = getApp(params.app_id ?? '')

    if (!result) {
      return error('App not found', 404)
    }

    return json(result)
  },

  /**
   * Update app by app_id
   */
  'PATCH /v1/apps/:app_id': async (
    req: Request,
    params: Record<string, string>,
  ) => {
    const body = await parseBody<{
      name?: string
      public_key?: string
      private_key?: string
    }>(req)

    const { updateApp } = await import('../services/apps.service.ts')
    const result = updateApp(params.app_id ?? '', body ?? {})

    if (!result) {
      return error('App not found', 404)
    }

    return json(result)
  },

  /**
   * Delete app by app_id
   */
  'DELETE /v1/apps/:app_id': async (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const { deleteApp } = await import('../services/apps.service.ts')
    const success = deleteApp(params.app_id ?? '')

    if (!success) {
      return error('App not found', 404)
    }

    return json({ message: 'App deleted successfully' })
  },

  /**
   * Create shared secret with private_key and public_key
   */
  'POST /v1/shared-secret': async (req: Request) => {
    const body = await parseBody<{ private_key: string; public_key: string }>(
      req,
    )

    if (!body?.private_key) {
      return error('Missing "private_key" in request body')
    }

    if (!body?.public_key) {
      return error('Missing "public_key" in request body')
    }

    const { createSharedSecret } = await import(
      '../services/shared-secret.service.ts'
    )
    const result = createSharedSecret(body.private_key, body.public_key)

    return json(result, 201)
  },

  /**
   * Get shared secret by private_key
   */
  'GET /v1/shared-secret/:private_key': async (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const { getSharedSecret } = await import(
      '../services/shared-secret.service.ts'
    )
    const result = getSharedSecret(params.private_key ?? '')

    if (!result) {
      return error('Shared secret not found', 404)
    }

    return json(result)
  },

  /**
   * Delete shared secret by private_key
   */
  'DELETE /v1/shared-secret/:private_key': async (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const { deleteSharedSecret } = await import(
      '../services/shared-secret.service.ts'
    )
    const success = deleteSharedSecret(params.private_key ?? '')

    if (!success) {
      return error('Shared secret not found', 404)
    }

    return json({ message: 'Shared secret deleted successfully' })
  },

  /**
   * List tenants.
   */
  'GET /v1/tenants': () => {
    const tenants = ControlPlaneService.listTenants()
    return json({ tenants, count: tenants.length })
  },

  /**
   * Create a tenant.
   */
  'POST /v1/tenants': async (req: Request) => {
    const body = await parseBody<{ tenant_id?: string; name?: string }>(req)

    if (!body?.name) {
      return error('Missing "name" in request body')
    }

    const tenant = ControlPlaneService.createTenant({
      tenant_id: body.tenant_id,
      name: body.name,
    })

    return json(tenant, 201)
  },

  /**
   * Get tenant by tenant_id.
   */
  'GET /v1/tenants/:tenant_id': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const tenant = ControlPlaneService.getTenant(params.tenant_id ?? '')

    if (!tenant) {
      return error('Tenant not found', 404)
    }

    return json(tenant)
  },

  /**
   * Update tenant by tenant_id.
   */
  'PATCH /v1/tenants/:tenant_id': async (
    req: Request,
    params: Record<string, string>,
  ) => {
    const body = await parseBody<{ name?: string }>(req)
    const tenant = ControlPlaneService.updateTenant({
      tenant_id: params.tenant_id ?? '',
      name: body?.name,
    })

    if (!tenant) {
      return error('Tenant not found', 404)
    }

    return json(tenant)
  },

  /**
   * Delete tenant by tenant_id.
   */
  'DELETE /v1/tenants/:tenant_id': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const success = ControlPlaneService.deleteTenant(params.tenant_id ?? '')

    if (!success) {
      return error('Tenant not found', 404)
    }

    return json({ message: 'Tenant deleted successfully' })
  },

  /**
   * Get tenant quota policy.
   */
  'GET /v1/tenants/:tenant_id/quota': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const policy = ControlPlaneService.getTenantQuotaPolicy(
      params.tenant_id ?? '',
    )

    if (!policy) {
      return error('Tenant quota policy not found', 404)
    }

    return json(policy)
  },

  /**
   * Set tenant quota policy.
   */
  'PUT /v1/tenants/:tenant_id/quota': async (
    req: Request,
    params: Record<string, string>,
  ) => {
    const body = await parseBody<{ requests_per_minute?: number | null }>(req)
    if (
      body?.requests_per_minute !== null &&
      body?.requests_per_minute !== undefined &&
      (!Number.isInteger(body.requests_per_minute) ||
        body.requests_per_minute <= 0)
    ) {
      return error('"requests_per_minute" must be a positive integer or null')
    }

    const policy = ControlPlaneService.upsertTenantQuotaPolicy({
      tenant_id: params.tenant_id ?? '',
      requests_per_minute: body?.requests_per_minute ?? null,
    })

    if (!policy) {
      return error('Tenant not found', 404)
    }

    return json(policy)
  },

  /**
   * List projects.
   */
  'GET /v1/projects': (req: Request) => {
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id') ?? undefined
    const projects = ControlPlaneService.listProjects({ tenantId })
    return json({ projects, count: projects.length })
  },

  /**
   * Create a project.
   */
  'POST /v1/projects': async (req: Request) => {
    const body = await parseBody<{
      project_id?: string
      tenant_id?: string
      name?: string
    }>(req)

    if (!body?.tenant_id) {
      return error('Missing "tenant_id" in request body')
    }
    if (!body?.name) {
      return error('Missing "name" in request body')
    }

    const project = ControlPlaneService.createProject({
      project_id: body.project_id,
      tenant_id: body.tenant_id,
      name: body.name,
    })

    if (!project) {
      return error('Tenant not found', 404)
    }

    return json(project, 201)
  },

  /**
   * Get project by project_id.
   */
  'GET /v1/projects/:project_id': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const project = ControlPlaneService.getProject(params.project_id ?? '')

    if (!project) {
      return error('Project not found', 404)
    }

    return json(project)
  },

  /**
   * Update project by project_id.
   */
  'PATCH /v1/projects/:project_id': async (
    req: Request,
    params: Record<string, string>,
  ) => {
    const body = await parseBody<{
      name?: string
      tenant_id?: string
    }>(req)

    const project = ControlPlaneService.updateProject({
      project_id: params.project_id ?? '',
      name: body?.name,
      tenant_id: body?.tenant_id,
    })

    if (!project) {
      return error('Project not found', 404)
    }

    return json(project)
  },

  /**
   * Delete project by project_id.
   */
  'DELETE /v1/projects/:project_id': (
    _req: Request,
    params: Record<string, string>,
  ) => {
    const success = ControlPlaneService.deleteProject(params.project_id ?? '')

    if (!success) {
      return error('Project not found', 404)
    }

    return json({ message: 'Project deleted successfully' })
  },

  /**
   * List audit events.
   */
  'GET /v1/audit-events': (req: Request) => {
    const url = new URL(req.url)
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 100)
      : 50
    const events = AuditService.list(safeLimit)
    return json({ events, count: events.length })
  },
}

export type Routes = typeof routes
