import { ApiKeyService } from '../services/api-key.service.ts';
import type { ApiKeyConfig, ApiKeyListOptions } from '../types/index.ts';

/**
 * JSON response helper
 */
function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Error response helper
 */
function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * Parse JSON body safely
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Extract API key from Authorization header
 */
function extractApiKey(req: Request): string | null {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  
  // Support "Bearer <key>" and "ApiKey <key>" formats
  const match = auth.match(/^(?:Bearer|ApiKey)\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * Middleware to validate API key for protected routes
 */
async function requireAuth(req: Request): Promise<Response | null> {
  const key = extractApiKey(req);
  if (!key) {
    return error('Missing API key in Authorization header', 401);
  }
  
  const result = await ApiKeyService.validate(key);
  if (!result.valid) {
    const messages: Record<string, string> = {
      not_found: 'Invalid API key',
      expired: 'API key has expired',
      revoked: 'API key has been revoked',
      rate_limited: 'Rate limit exceeded',
    };
    const status = result.reason === 'rate_limited' ? 429 : 401;
    return error(messages[result.reason ?? 'not_found'] ?? 'Unauthorized', status);
  }
  
  return null; // Auth passed
}

/**
 * Route handlers for the API
 */
export const routes = {
  /**
   * Health check endpoint
   */
  'GET /health': () => {
    return json({ status: 'ok', timestamp: new Date().toISOString() });
  },

  /**
   * Create a new API key
   * Returns just the key string for easy copy/paste
   */
  'POST /v1/keys': async (req: Request) => {
    const body = await parseBody<ApiKeyConfig>(req);
    
    try {
      const result = await ApiKeyService.create(body ?? {});
      
      // Simple response - just the key users need
      return json({
        key: result.key,
        id: result.record.id,
        expiresAt: result.record.expiresAt?.toISOString() ?? null,
      }, 201);
    } catch (err) {
      console.error('Error creating API key:', err);
      return error('Failed to create API key', 500);
    }
  },

  /**
   * Validate an API key
   */
  'POST /v1/keys/validate': async (req: Request) => {
    const body = await parseBody<{ key: string }>(req);
    
    if (!body?.key) {
      return error('Missing "key" in request body');
    }
    
    const result = await ApiKeyService.validate(body.key, { updateLastUsed: false });
    
    return json({
      valid: result.valid,
      reason: result.reason ?? null,
      key: result.key ? {
        id: result.key.id,
        prefix: result.key.prefix,
        suffix: result.key.suffix,
        name: result.key.name,
        scopes: result.key.scopes,
        expiresAt: result.key.expiresAt?.toISOString() ?? null,
        isActive: result.key.isActive,
      } : null,
    });
  },

  /**
   * List all API keys
   */
  'GET /v1/keys': (req: Request) => {
    const url = new URL(req.url);
    
    const options: ApiKeyListOptions = {
      isActive: url.searchParams.has('active')
        ? url.searchParams.get('active') === 'true'
        : undefined,
      prefix: url.searchParams.get('prefix') ?? undefined,
      includeExpired: url.searchParams.get('includeExpired') === 'true',
      offset: parseInt(url.searchParams.get('offset') ?? '0', 10),
      limit: Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100),
    };
    
    const keys = ApiKeyService.list(options);
    
    return json({
      keys: keys.map(k => ({
        id: k.id,
        prefix: k.prefix,
        suffix: k.suffix,
        name: k.name,
        isActive: k.isActive,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
      count: keys.length,
    });
  },

  /**
   * Get API key by ID
   */
  'GET /v1/keys/:id': (_req: Request, params: Record<string, string>) => {
    const key = ApiKeyService.getById(params.id ?? '');
    
    if (!key) {
      return error('API key not found', 404);
    }
    
    return json({
      id: key.id,
      prefix: key.prefix,
      suffix: key.suffix,
      name: key.name,
      isActive: key.isActive,
      scopes: key.scopes,
      metadata: key.metadata,
      rateLimit: key.rateLimit,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt?.toISOString() ?? null,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    });
  },

  /**
   * Update API key
   */
  'PATCH /v1/keys/:id': async (req: Request, params: Record<string, string>) => {
    const keyId = params.id ?? '';
    const key = ApiKeyService.getById(keyId);
    if (!key) {
      return error('API key not found', 404);
    }
    
    const body = await parseBody<{
      name?: string;
      scopes?: string[];
      metadata?: Record<string, unknown>;
    }>(req);
    
    if (!body) {
      return error('Invalid request body');
    }
    
    let updated = false;
    
    if (body.name !== undefined) {
      updated = ApiKeyService.rename(keyId, body.name) || updated;
    }
    
    if (body.scopes !== undefined) {
      updated = ApiKeyService.updateScopes(keyId, body.scopes) || updated;
    }
    
    if (body.metadata !== undefined) {
      updated = ApiKeyService.updateMetadata(keyId, body.metadata) || updated;
    }
    
    if (!updated) {
      return error('No fields to update');
    }
    
    const updatedKey = ApiKeyService.getById(keyId);
    return json({
      message: 'API key updated',
      key: updatedKey ? {
        id: updatedKey.id,
        name: updatedKey.name,
        scopes: updatedKey.scopes,
        metadata: updatedKey.metadata,
      } : null,
    });
  },

  /**
   * Revoke API key
   */
  'POST /v1/keys/:id/revoke': (_req: Request, params: Record<string, string>) => {
    const success = ApiKeyService.revoke(params.id ?? '');
    
    if (!success) {
      return error('API key not found', 404);
    }
    
    return json({ message: 'API key revoked successfully' });
  },

  /**
   * Delete API key
   */
  'DELETE /v1/keys/:id': (_req: Request, params: Record<string, string>) => {
    const success = ApiKeyService.delete(params.id ?? '');
    
    if (!success) {
      return error('API key not found', 404);
    }
    
    return json({ message: 'API key deleted successfully' });
  },

  /**
   * Get API key statistics
   */
  'GET /v1/keys/stats': () => {
    const stats = ApiKeyService.getStats();
    return json(stats);
  },

  /**
   * Protected endpoint example - requires valid API key
   */
  'GET /v1/protected': async (req: Request) => {
    const authError = await requireAuth(req);
    if (authError) return authError;
    
    return json({
      message: 'You have access to this protected resource!',
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Rues endpoint - create with app_id and public_key
   */
  'POST /v1/rues': async (req: Request) => {
    const body = await parseBody<{ app_id: string; public_key: string }>(req);
    
    if (!body?.app_id) {
      return error('Missing "app_id" in request body');
    }
    
    if (!body?.public_key) {
      return error('Missing "public_key" in request body');
    }
    
    const { createRues } = await import('../services/rues.service.ts');
    const result = createRues(body.app_id, body.public_key);
    
    return json(result, 201);
  },

  /**
   * Get rues by app_id
   */
  'GET /v1/rues/:app_id': async (_req: Request, params: Record<string, string>) => {
    const { getRues } = await import('../services/rues.service.ts');
    const result = getRues(params.app_id ?? '');
    
    if (!result) {
      return error('Rues not found', 404);
    }
    
    return json(result);
  },

  /**
   * Delete rues by app_id
   */
  'DELETE /v1/rues/:app_id': async (_req: Request, params: Record<string, string>) => {
    const { deleteRues } = await import('../services/rues.service.ts');
    const success = deleteRues(params.app_id ?? '');
    
    if (!success) {
      return error('Rues not found', 404);
    }
    
    return json({ message: 'Rues deleted successfully' });
  },

  /**
   * Create shared secret with private_key and public_key
   */
  'POST /v1/shared-secret': async (req: Request) => {
    const body = await parseBody<{ private_key: string; public_key: string }>(req);
    
    if (!body?.private_key) {
      return error('Missing "private_key" in request body');
    }
    
    if (!body?.public_key) {
      return error('Missing "public_key" in request body');
    }
    
    const { createSharedSecret } = await import('../services/shared-secret.service.ts');
    const result = createSharedSecret(body.private_key, body.public_key);
    
    return json(result, 201);
  },

  /**
   * Get shared secret by private_key
   */
  'GET /v1/shared-secret/:private_key': async (_req: Request, params: Record<string, string>) => {
    const { getSharedSecret } = await import('../services/shared-secret.service.ts');
    const result = getSharedSecret(params.private_key ?? '');
    
    if (!result) {
      return error('Shared secret not found', 404);
    }
    
    return json(result);
  },

  /**
   * Delete shared secret by private_key
   */
  'DELETE /v1/shared-secret/:private_key': async (_req: Request, params: Record<string, string>) => {
    const { deleteSharedSecret } = await import('../services/shared-secret.service.ts');
    const success = deleteSharedSecret(params.private_key ?? '');
    
    if (!success) {
      return error('Shared secret not found', 404);
    }
    
    return json({ message: 'Shared secret deleted successfully' });
  },
};

export type Routes = typeof routes;
