import { queryOne } from '@/lib/db'
import { appendOperationalEvent } from '@/lib/operational-events'

export type XaviraRole = 'owner' | 'admin' | 'operator' | 'analyst' | 'viewer'

export type XaviraPermission =
  | 'tenant:read'
  | 'tenant:manage'
  | 'ingestion:read'
  | 'ingestion:write'
  | 'contacts:read'
  | 'contacts:write'
  | 'outbound:read'
  | 'outbound:operate'
  | 'governance:read'
  | 'governance:manage'
  | 'license:read'
  | 'license:manage'
  | 'workflow:read'
  | 'workflow:manage'
  | 'command_center:read'

const ROLE_PERMISSIONS: Record<XaviraRole, XaviraPermission[]> = {
  owner: [
    'tenant:read',
    'tenant:manage',
    'ingestion:read',
    'ingestion:write',
    'contacts:read',
    'contacts:write',
    'outbound:read',
    'outbound:operate',
    'governance:read',
    'governance:manage',
    'license:read',
    'license:manage',
    'workflow:read',
    'workflow:manage',
    'command_center:read',
  ],
  admin: [
    'tenant:read',
    'ingestion:read',
    'ingestion:write',
    'contacts:read',
    'contacts:write',
    'outbound:read',
    'outbound:operate',
    'governance:read',
    'workflow:read',
    'workflow:manage',
    'command_center:read',
  ],
  operator: [
    'tenant:read',
    'ingestion:read',
    'contacts:read',
    'outbound:read',
    'outbound:operate',
    'governance:read',
    'workflow:read',
    'command_center:read',
  ],
  analyst: ['tenant:read', 'ingestion:read', 'contacts:read', 'outbound:read', 'governance:read', 'command_center:read'],
  viewer: ['tenant:read', 'outbound:read', 'command_center:read'],
}

interface ClientUserRow {
  role: XaviraRole
}

export function permissionsForRole(role: XaviraRole): XaviraPermission[] {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer
}

export function hasPermission(role: XaviraRole, permission: XaviraPermission): boolean {
  return permissionsForRole(role).includes(permission)
}

export async function requireTenantPermission(input: {
  clientId: number
  userId?: number | null
  permission: XaviraPermission
  actorId?: string | number | null
}): Promise<XaviraRole> {
  if (!input.userId) {
    await appendOperationalEvent({
      clientId: input.clientId,
      eventType: 'rbac.denied',
      aggregateType: 'permission',
      aggregateId: input.permission,
      actorType: 'user',
      actorId: input.actorId ?? 'anonymous',
      payload: { reason: 'missing_user', permission: input.permission },
    })
    throw new Error(`permission_denied:${input.permission}`)
  }

  const row = await queryOne<ClientUserRow>(
    `SELECT role
     FROM client_users
     WHERE client_id = $1 AND user_id = $2
     LIMIT 1`,
    [input.clientId, input.userId]
  )

  const role = row?.role ?? 'viewer'
  if (!hasPermission(role, input.permission)) {
    await appendOperationalEvent({
      clientId: input.clientId,
      eventType: 'rbac.denied',
      aggregateType: 'permission',
      aggregateId: input.permission,
      actorType: 'user',
      actorId: input.actorId ?? input.userId,
      payload: { role, permission: input.permission },
    })
    throw new Error(`permission_denied:${input.permission}`)
  }

  return role
}
