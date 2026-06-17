import { getDatabase } from '../db/index.ts'
import type { UsageSummary } from '../types/index.ts'

export interface UsageEventInput {
  requestId: string
  actorType: 'admin' | 'api_key'
  actorId: string
  tenantId: string
  projectId: string
  method: string
  path: string
  status: number
}

export interface UsageSummaryOptions {
  tenantId?: string
  projectId?: string
  from?: number
  to?: number
}

export const UsageService = {
  record(event: UsageEventInput): void {
    const db = getDatabase()
    db.run(
      `
      INSERT INTO usage_events (
        id, request_id, occurred_at, actor_type, actor_id,
        tenant_id, project_id, method, path, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        crypto.randomUUID(),
        event.requestId,
        Date.now(),
        event.actorType,
        event.actorId,
        event.tenantId,
        event.projectId,
        event.method,
        event.path,
        event.status,
      ],
    )
  },

  summarize(options: UsageSummaryOptions = {}): UsageSummary[] {
    const db = getDatabase()
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (options.tenantId) {
      conditions.push('tenant_id = ?')
      params.push(options.tenantId)
    }

    if (options.projectId) {
      conditions.push('project_id = ?')
      params.push(options.projectId)
    }

    if (options.from !== undefined) {
      conditions.push('occurred_at >= ?')
      params.push(options.from)
    }

    if (options.to !== undefined) {
      conditions.push('occurred_at <= ?')
      params.push(options.to)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db
      .prepare<
        {
          tenant_id: string
          project_id: string
          requests: number
          last_request_at: number | null
        },
        (string | number)[]
      >(
        `
        SELECT
          tenant_id,
          project_id,
          COUNT(*) AS requests,
          MAX(occurred_at) AS last_request_at
        FROM usage_events
        ${whereClause}
        GROUP BY tenant_id, project_id
        ORDER BY requests DESC, last_request_at DESC
      `,
      )
      .all(...params)

    return rows.map((row) => ({
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      requests: row.requests,
      last_request_at: row.last_request_at
        ? new Date(row.last_request_at).toISOString()
        : null,
    }))
  },
}
