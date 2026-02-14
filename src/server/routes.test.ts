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
})
