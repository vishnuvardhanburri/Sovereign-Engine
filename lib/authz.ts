import { query, queryOne, transaction } from '@/lib/db'
import { ClientUser, User } from '@/lib/db/types'
import { ClientContextSource, resolveClientId } from '@/lib/client-context'

export type MembershipRole = 'owner' | 'admin' | 'member'

const ROLE_WEIGHT: Record<MembershipRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
}

export interface AccessContext {
  clientId: number
  user: User | null
  membership: ClientUser | null
}

function parseUserId(source: ClientContextSource): number | null {
  const bodyValue = source.body?.user_id
  const queryValue = source.searchParams?.get('user_id')
  const headerValue = source.headers?.get('x-user-id')
  const candidate = Number(bodyValue ?? queryValue ?? headerValue ?? 0)
  return Number.isFinite(candidate) && candidate > 0 ? candidate : null
}

function parseUserEmail(source: ClientContextSource): string | null {
  const bodyValue = source.body?.user_email
  const queryValue = source.searchParams?.get('user_email')
  const headerValue = source.headers?.get('x-user-email')

  const candidate = String(bodyValue ?? queryValue ?? headerValue ?? '').trim().toLowerCase()
  return candidate || null
}

export async function upsertUser(input: {
  email: string
  name?: string | null
  passwordHash?: string | null
}) {
  const email = input.email.trim().toLowerCase()
  if (!email) {
    throw new Error('email is required')
  }

  return queryOne<User>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
     SET name = COALESCE(EXCLUDED.name, users.name),
         password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [email, input.name?.trim() || null, input.passwordHash ?? null]
  )
}

export async function assignUserToClient(input: {
  clientId: number
  userId: number
  role: MembershipRole
}) {
  return queryOne<ClientUser>(
    `INSERT INTO client_users (client_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.clientId, input.userId, input.role]
  )
}

export async function listClientUsers(clientId: number) {
  return query<
    ClientUser & {
      user_email: string
      user_name: string | null
    }
  >(
    `SELECT
       cu.*,
       u.email AS user_email,
       u.name AS user_name
     FROM client_users cu
     JOIN users u ON u.id = cu.user_id
     WHERE cu.client_id = $1
     ORDER BY cu.created_at ASC`,
    [clientId]
  )
}

export async function resolveAccessContext(
  source: ClientContextSource,
  minimumRole: MembershipRole = 'member'
): Promise<AccessContext> {
  const clientId = await resolveClientId(source)
  const userId = parseUserId(source)
  const userEmail = parseUserEmail(source)

  if (!userId && !userEmail) {
    return { clientId, user: null, membership: null }
  }

  const params: unknown[] = [clientId]
  let userFilter = ''

  if (userId) {
    params.push(userId)
    userFilter = `AND u.id = $${params.length}`
  } else if (userEmail) {
    params.push(userEmail)
    userFilter = `AND u.email = $${params.length}`
  }

  const membership = await queryOne<
    ClientUser & User & { user_id: number }
  >(
    `SELECT
       cu.*,
       u.id AS user_id,
       u.email,
       u.name,
       u.password_hash
     FROM client_users cu
     JOIN users u ON u.id = cu.user_id
     WHERE cu.client_id = $1
       ${userFilter}`,
    params
  )

  if (!membership) {
    throw new Error('User is not assigned to this client')
  }

  if (ROLE_WEIGHT[membership.role] < ROLE_WEIGHT[minimumRole]) {
    throw new Error('Insufficient permissions for this action')
  }

  return {
    clientId,
    user: {
      id: membership.user_id,
      email: membership.email,
      name: membership.name,
      password_hash: membership.password_hash,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
    },
    membership: {
      id: membership.id,
      client_id: membership.client_id,
      user_id: membership.user_id,
      role: membership.role,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
    },
  }
}

export async function bootstrapClientOwner(input: {
  clientId: number
  email: string
  name?: string | null
}) {
  return transaction(async () => {
    const user = await upsertUser({
      email: input.email,
      name: input.name,
    })

    if (!user) {
      throw new Error('Failed to create user')
    }

    const membership = await assignUserToClient({
      clientId: input.clientId,
      userId: user.id,
      role: 'owner',
    })

    return { user, membership }
  })
}
