import { ADMIN_PROJECT_ID, ADMIN_TENANT_ID } from '../constants/platform.ts'
import { ApiKeyService } from '../services/api-key.service.ts'
import type { RequestContext } from '../types/index.ts'
import { extractAuthToken, secureCompare } from './auth.ts'

function json(data: Record<string, unknown>, status = 400): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authError(message: string, status = 401): Response {
  return json({ error: message }, status)
}

function validationErrorToResponse(reason?: string): Response {
  const messages: Record<string, string> = {
    not_found: 'Invalid API key',
    expired: 'API key has expired',
    revoked: 'API key has been revoked',
    rate_limited: 'Rate limit exceeded',
  }
  const status = reason === 'rate_limited' ? 429 : 401
  return authError(messages[reason ?? 'not_found'] ?? 'Unauthorized', status)
}

export interface ResolvedRequestContext {
  context: RequestContext
  authResult: 'admin' | 'api_key'
}

export function createAdminContext(): ResolvedRequestContext {
  return {
    authResult: 'admin',
    context: {
      actorType: 'admin',
      actorId: 'admin',
      tenantId: ADMIN_TENANT_ID,
      projectId: ADMIN_PROJECT_ID,
      scopes: ['*'],
    },
  }
}

export async function resolveRequestContext(
  req: Request,
  adminApiKey: string,
  options: { updateLastUsed?: boolean } = {},
): Promise<ResolvedRequestContext | Response> {
  const { updateLastUsed = false } = options
  const token = extractAuthToken(req)

  if (!token) {
    return authError('Missing API key in Authorization header')
  }

  if (secureCompare(token, adminApiKey)) {
    return createAdminContext()
  }

  const validation = await ApiKeyService.validate(token, {
    updateLastUsed,
  })

  if (!validation.valid || !validation.key) {
    return validationErrorToResponse(validation.reason)
  }

  const key = validation.key
  return {
    authResult: 'api_key',
    context: {
      actorType: 'api_key',
      actorId: key.id,
      tenantId: key.tenantId,
      projectId: key.projectId,
      scopes: key.scopes,
      keyId: key.id,
      keyName: key.name,
    },
  }
}
