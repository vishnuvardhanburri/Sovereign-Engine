import { queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'

export interface ClientContextSource {
  body?: Record<string, unknown> | null
  searchParams?: URLSearchParams
  headers?: Headers
}

export async function ensureClientExists(clientId: number): Promise<void> {
  await queryOne(
    `INSERT INTO clients (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [clientId, clientId === 1 ? 'Default Client' : `Client ${clientId}`]
  )
}

export async function resolveClientId(
  source: ClientContextSource = {}
): Promise<number> {
  const bodyClientId = source.body?.client_id
  const queryClientId = source.searchParams?.get('client_id')
  const headerClientId = source.headers?.get('x-client-id')

  const resolved =
    Number(bodyClientId) ||
    Number(queryClientId) ||
    Number(headerClientId) ||
    appEnv.defaultClientId()

  const clientId = Number.isFinite(resolved) && resolved > 0 ? resolved : 1
  await ensureClientExists(clientId)

  return clientId
}

