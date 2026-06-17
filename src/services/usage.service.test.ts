import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { Effect } from 'effect'
import {
  closeDatabase,
  getDatabase,
  openDatabase,
  setDatabase,
} from '../db/index.ts'
import { ControlPlaneService } from './control-plane.service.ts'
import { UsageService } from './usage.service.ts'

process.env.DB_PATH = ':memory:'

describe('UsageService', () => {
  beforeAll(() => {
    const db = Effect.runSync(openDatabase())
    setDatabase(db)
  })

  beforeEach(() => {
    const db = getDatabase()
    db.run('DELETE FROM usage_events')
    db.run('DELETE FROM api_keys')
    db.run('DELETE FROM projects')
    db.run('DELETE FROM tenants')
    db.run(
      'INSERT OR IGNORE INTO tenants (tenant_id, name, created_at) VALUES (?, ?, ?)',
      ['default_tenant', 'Default Tenant', Date.now()],
    )
    db.run(
      'INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)',
      ['default_project', 'default_tenant', 'Default Project', Date.now()],
    )
  })

  afterAll(() => {
    closeDatabase()
  })

  test('records usage events and summarizes them by tenant and project', () => {
    ControlPlaneService.createTenant({
      tenant_id: 'tenant_acme',
      name: 'Company Inc',
    })
    ControlPlaneService.createProject({
      project_id: 'project_a',
      tenant_id: 'tenant_acme',
      name: 'Project A',
    })
    ControlPlaneService.createProject({
      project_id: 'project_b',
      tenant_id: 'tenant_acme',
      name: 'Project B',
    })

    UsageService.record({
      requestId: 'req-1',
      actorType: 'api_key',
      actorId: 'key-1',
      tenantId: 'tenant_acme',
      projectId: 'project_a',
      method: 'GET',
      path: '/v1/a',
      status: 200,
    })
    UsageService.record({
      requestId: 'req-2',
      actorType: 'api_key',
      actorId: 'key-2',
      tenantId: 'tenant_acme',
      projectId: 'project_a',
      method: 'POST',
      path: '/v1/b',
      status: 201,
    })
    UsageService.record({
      requestId: 'req-3',
      actorType: 'admin',
      actorId: 'admin',
      tenantId: 'tenant_acme',
      projectId: 'project_b',
      method: 'GET',
      path: '/v1/c',
      status: 200,
    })

    const all = UsageService.summarize()
    expect(all.length).toBe(2)
    expect(all[0]?.tenant_id).toBe('tenant_acme')
    expect(all[0]?.requests).toBe(2)

    const filtered = UsageService.summarize({
      tenantId: 'tenant_acme',
      projectId: 'project_a',
    })
    expect(filtered.length).toBe(1)
    expect(filtered[0]?.requests).toBe(2)
    expect(filtered[0]?.project_id).toBe('project_a')
  })
})
