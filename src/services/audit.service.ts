import { getDatabase } from '../db/index.ts'
import type { AuditEvent } from '../types/index.ts'

export interface AuditEventInput {
  requestId: string
  actorType: 'admin' | 'api_key'
  actorId: string
  tenantId: string
  projectId: string
  method: string
  path: string
  status: number
  authResult: string
}

function rowToAuditEvent(row: {
  id: string
  request_id: string
  occurred_at: number
  actor_type: 'admin' | 'api_key'
  actor_id: string
  tenant_id: string
  project_id: string
  method: string
  path: string
  status: number
  auth_result: string
}): AuditEvent {
  return {
    id: row.id,
    request_id: row.request_id,
    occurred_at: new Date(row.occurred_at).toISOString(),
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    method: row.method,
    path: row.path,
    status: row.status,
    auth_result: row.auth_result,
  }
}

export const AuditService = {
  record(event: AuditEventInput): void {
    const db = getDatabase()
    db.run(
      `
      INSERT INTO audit_events (
        id, request_id, occurred_at, actor_type, actor_id,
        tenant_id, project_id, method, path, status, auth_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        event.authResult,
      ],
    )
  },

  list(limit = 50): AuditEvent[] {
    const db = getDatabase()
    const rows = db
      .prepare<
        {
          id: string
          request_id: string
          occurred_at: number
          actor_type: 'admin' | 'api_key'
          actor_id: string
          tenant_id: string
          project_id: string
          method: string
          path: string
          status: number
          auth_result: string
        },
        [number]
      >('SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT ?')
      .all(limit)

    return rows.map(rowToAuditEvent)
  },
}
