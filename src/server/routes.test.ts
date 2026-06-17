import { describe, expect, test } from 'bun:test'
import { routes } from './routes.ts'

describe('routes', () => {
  test('health response does not leak API key header', () => {
    const response = (routes['GET /health'] as () => Response)()
    expect(response.headers.get('X-API-Key')).toBeNull()
  })

  test('invalid list query params return 400', () => {
    const response = (routes['GET /v1/keys'] as (req: Request) => Response)(
      new Request('http://localhost/v1/keys?limit=abc'),
    )
    expect(response.status).toBe(400)
  })

  test('context route returns resolved request context payload', async () => {
    const response = await (
      routes['GET /v1/context'] as (
        req: Request,
        params: Record<string, string>,
        context?: {
          authResult: 'admin'
          context: {
            actorType: 'admin'
            actorId: string
            tenantId: string
            projectId: string
            scopes: string[]
          }
        },
      ) => Response | Promise<Response>
    )(
      new Request('http://localhost/v1/context'),
      {},
      {
        authResult: 'admin',
        context: {
          actorType: 'admin',
          actorId: 'admin',
          tenantId: 'platform',
          projectId: 'control_plane',
          scopes: ['*'],
        },
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      authResult: string
      tenantId: string
      projectId: string
      actorType: string
    }
    expect(body.authResult).toBe('admin')
    expect(body.actorType).toBe('admin')
    expect(body.tenantId).toBe('platform')
    expect(body.projectId).toBe('control_plane')
  })
})
