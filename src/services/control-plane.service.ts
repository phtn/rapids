import { getDatabase } from '../db/index.ts'
import type { Project, Tenant } from '../types/index.ts'

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
}
