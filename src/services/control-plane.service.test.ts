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

process.env.DB_PATH = ':memory:'

describe('ControlPlaneService', () => {
  beforeAll(() => {
    const db = Effect.runSync(openDatabase())
    setDatabase(db)
  })

  beforeEach(() => {
    const db = getDatabase()
    db.run('DELETE FROM tenant_rate_limit_records')
    db.run('DELETE FROM tenant_quota_policies')
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

  test('creates, updates, and deletes a tenant', () => {
    const tenant = ControlPlaneService.createTenant({
      tenant_id: 'tenant_acme',
      name: 'Acme',
    })
    expect(tenant.tenant_id).toBe('tenant_acme')

    const updated = ControlPlaneService.updateTenant({
      tenant_id: 'tenant_acme',
      name: 'Acme Co',
    })
    expect(updated?.name).toBe('Acme Co')

    expect(ControlPlaneService.deleteTenant('tenant_acme')).toBe(true)
    expect(ControlPlaneService.getTenant('tenant_acme')).toBeNull()
  })

  test('creates, updates, and deletes a project', () => {
    ControlPlaneService.createTenant({
      tenant_id: 'tenant_acme',
      name: 'Acme',
    })

    const project = ControlPlaneService.createProject({
      project_id: 'project_acme',
      tenant_id: 'tenant_acme',
      name: 'Billing',
    })
    expect(project?.project_id).toBe('project_acme')

    const updated = ControlPlaneService.updateProject({
      project_id: 'project_acme',
      name: 'Billing v2',
    })
    expect(updated?.name).toBe('Billing v2')

    expect(ControlPlaneService.deleteProject('project_acme')).toBe(true)
    expect(ControlPlaneService.getProject('project_acme')).toBeNull()
  })

  test('stores and enforces tenant quota policies', () => {
    ControlPlaneService.createTenant({
      tenant_id: 'tenant_acme',
      name: 'Acme',
    })

    const policy = ControlPlaneService.upsertTenantQuotaPolicy({
      tenant_id: 'tenant_acme',
      requests_per_minute: 1,
    })
    expect(policy?.requests_per_minute).toBe(1)

    const first = ControlPlaneService.consumeTenantQuota('tenant_acme')
    const second = ControlPlaneService.consumeTenantQuota('tenant_acme')

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
    expect(second.limit).toBe(1)
  })
})
