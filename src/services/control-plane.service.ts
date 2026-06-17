import { getDatabase } from '../db/index.ts'
import type { Project, Tenant, TenantQuotaPolicy } from '../types/index.ts'

function generateId(): string {
  return crypto.randomUUID()
}

function rowToTenant(row: {
  tenant_id: string
  name: string
  created_at: number
}): Tenant {
  return {
    tenant_id: row.tenant_id,
    name: row.name,
    created_at: new Date(row.created_at).toISOString(),
  }
}

function rowToProject(row: {
  project_id: string
  tenant_id: string
  name: string
  created_at: number
}): Project {
  return {
    project_id: row.project_id,
    tenant_id: row.tenant_id,
    name: row.name,
    created_at: new Date(row.created_at).toISOString(),
  }
}

export const ControlPlaneService = {
  createTenant(input: { tenant_id?: string; name: string }): Tenant {
    const db = getDatabase()
    const tenantId = input.tenant_id?.trim() || `tenant_${generateId()}`
    const name = input.name.trim()
    const now = Date.now()

    db.run(
      `
      INSERT OR IGNORE INTO tenants (tenant_id, name, created_at)
      VALUES (?, ?, ?)
    `,
      [tenantId, name, now],
    )

    const row = db
      .prepare<
        { tenant_id: string; name: string; created_at: number },
        [string]
      >('SELECT tenant_id, name, created_at FROM tenants WHERE tenant_id = ?')
      .get(tenantId)

    if (!row) {
      throw new Error('Failed to create tenant')
    }

    return rowToTenant(row)
  },

  listTenants(): Tenant[] {
    const db = getDatabase()
    const rows = db
      .prepare<{ tenant_id: string; name: string; created_at: number }, []>(
        'SELECT tenant_id, name, created_at FROM tenants ORDER BY created_at DESC',
      )
      .all()

    return rows.map(rowToTenant)
  },

  getTenant(tenantId: string): Tenant | null {
    const db = getDatabase()
    const row = db
      .prepare<
        { tenant_id: string; name: string; created_at: number },
        [string]
      >('SELECT tenant_id, name, created_at FROM tenants WHERE tenant_id = ?')
      .get(tenantId)

    return row ? rowToTenant(row) : null
  },

  updateTenant(input: { tenant_id: string; name?: string }): Tenant | null {
    const db = getDatabase()
    const current = ControlPlaneService.getTenant(input.tenant_id)
    if (!current) {
      return null
    }

    if (input.name === undefined) {
      return current
    }

    const name = input.name.trim()
    db.run('UPDATE tenants SET name = ? WHERE tenant_id = ?', [
      name,
      input.tenant_id,
    ])

    return ControlPlaneService.getTenant(input.tenant_id)
  },

  deleteTenant(tenantId: string): boolean {
    const db = getDatabase()
    db.run('DELETE FROM api_keys WHERE tenant_id = ?', [tenantId])
    db.run('DELETE FROM tenant_rate_limit_records WHERE tenant_id = ?', [
      tenantId,
    ])
    db.run('DELETE FROM tenant_quota_policies WHERE tenant_id = ?', [tenantId])
    db.run('DELETE FROM projects WHERE tenant_id = ?', [tenantId])

    const result = db
      .prepare('DELETE FROM tenants WHERE tenant_id = ?')
      .run(tenantId)

    return result.changes > 0
  },

  createProject(input: {
    project_id?: string
    tenant_id: string
    name: string
  }): Project | null {
    const db = getDatabase()
    const tenant = ControlPlaneService.getTenant(input.tenant_id)
    if (!tenant) {
      return null
    }

    const projectId = input.project_id?.trim() || `project_${generateId()}`
    const name = input.name.trim()
    const now = Date.now()

    db.run(
      `
      INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at)
      VALUES (?, ?, ?, ?)
    `,
      [projectId, input.tenant_id, name, now],
    )

    const row = db
      .prepare<
        {
          project_id: string
          tenant_id: string
          name: string
          created_at: number
        },
        [string]
      >(
        'SELECT project_id, tenant_id, name, created_at FROM projects WHERE project_id = ?',
      )
      .get(projectId)

    return row ? rowToProject(row) : null
  },

  listProjects(options: { tenantId?: string } = {}): Project[] {
    const db = getDatabase()
    const rows =
      options.tenantId !== undefined
        ? db
            .prepare<
              {
                project_id: string
                tenant_id: string
                name: string
                created_at: number
              },
              [string]
            >(
              'SELECT project_id, tenant_id, name, created_at FROM projects WHERE tenant_id = ? ORDER BY created_at DESC',
            )
            .all(options.tenantId)
        : db
            .prepare<
              {
                project_id: string
                tenant_id: string
                name: string
                created_at: number
              },
              []
            >(
              'SELECT project_id, tenant_id, name, created_at FROM projects ORDER BY created_at DESC',
            )
            .all()

    return rows.map(rowToProject)
  },

  getProject(projectId: string): Project | null {
    const db = getDatabase()
    const row = db
      .prepare<
        {
          project_id: string
          tenant_id: string
          name: string
          created_at: number
        },
        [string]
      >(
        'SELECT project_id, tenant_id, name, created_at FROM projects WHERE project_id = ?',
      )
      .get(projectId)

    return row ? rowToProject(row) : null
  },

  updateProject(input: {
    project_id: string
    name?: string
    tenant_id?: string
  }): Project | null {
    const db = getDatabase()
    const current = ControlPlaneService.getProject(input.project_id)
    if (!current) {
      return null
    }

    const nextTenantId = input.tenant_id?.trim() || current.tenant_id
    if (input.tenant_id && !ControlPlaneService.getTenant(nextTenantId)) {
      return null
    }

    const nextName = input.name?.trim() || current.name
    db.run('UPDATE projects SET tenant_id = ?, name = ? WHERE project_id = ?', [
      nextTenantId,
      nextName,
      input.project_id,
    ])

    return ControlPlaneService.getProject(input.project_id)
  },

  deleteProject(projectId: string): boolean {
    const db = getDatabase()
    db.run('DELETE FROM api_keys WHERE project_id = ?', [projectId])
    const result = db
      .prepare('DELETE FROM projects WHERE project_id = ?')
      .run(projectId)

    return result.changes > 0
  },

  getTenantQuotaPolicy(tenantId: string): TenantQuotaPolicy | null {
    const db = getDatabase()
    const row = db
      .prepare<
        {
          tenant_id: string
          requests_per_minute: number | null
          created_at: number
          updated_at: number
        },
        [string]
      >(
        'SELECT tenant_id, requests_per_minute, created_at, updated_at FROM tenant_quota_policies WHERE tenant_id = ?',
      )
      .get(tenantId)

    if (!row) {
      return null
    }

    return {
      tenant_id: row.tenant_id,
      requests_per_minute: row.requests_per_minute,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    }
  },

  upsertTenantQuotaPolicy(input: {
    tenant_id: string
    requests_per_minute: number | null
  }): TenantQuotaPolicy | null {
    const db = getDatabase()
    if (!ControlPlaneService.getTenant(input.tenant_id)) {
      return null
    }

    const now = Date.now()
    db.run(
      `
      INSERT INTO tenant_quota_policies (tenant_id, requests_per_minute, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (tenant_id)
      DO UPDATE SET requests_per_minute = excluded.requests_per_minute, updated_at = excluded.updated_at
    `,
      [input.tenant_id, input.requests_per_minute, now, now],
    )

    return ControlPlaneService.getTenantQuotaPolicy(input.tenant_id)
  },

  consumeTenantQuota(tenantId: string): {
    allowed: boolean
    limit: number | null
    count: number
  } {
    const db = getDatabase()
    const policy = ControlPlaneService.getTenantQuotaPolicy(tenantId)
    if (!policy || policy.requests_per_minute === null) {
      return { allowed: true, limit: null, count: 0 }
    }

    const now = Date.now()
    const windowStart = Math.floor(now / 60000) * 60000

    db.run('DELETE FROM tenant_rate_limit_records WHERE window_start < ?', [
      windowStart - 60000,
    ])

    const current = db
      .prepare<{ request_count: number }, [string, number]>(
        'SELECT request_count FROM tenant_rate_limit_records WHERE tenant_id = ? AND window_start = ?',
      )
      .get(tenantId, windowStart)

    const nextCount = (current?.request_count ?? 0) + 1
    if (nextCount > policy.requests_per_minute) {
      return {
        allowed: false,
        limit: policy.requests_per_minute,
        count: current?.request_count ?? 0,
      }
    }

    db.run(
      `
      INSERT INTO tenant_rate_limit_records (tenant_id, window_start, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT (tenant_id, window_start)
      DO UPDATE SET request_count = request_count + 1
    `,
      [tenantId, windowStart],
    )

    return {
      allowed: true,
      limit: policy.requests_per_minute,
      count: nextCount,
    }
  },

  listTenantQuotaPolicies(): TenantQuotaPolicy[] {
    const db = getDatabase()
    const rows = db
      .prepare<
        {
          tenant_id: string
          requests_per_minute: number | null
          created_at: number
          updated_at: number
        },
        []
      >(
        'SELECT tenant_id, requests_per_minute, created_at, updated_at FROM tenant_quota_policies ORDER BY updated_at DESC',
      )
      .all()

    return rows.map((row) => ({
      tenant_id: row.tenant_id,
      requests_per_minute: row.requests_per_minute,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    }))
  },
}
