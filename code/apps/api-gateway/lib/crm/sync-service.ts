import { query, queryOne } from '@/lib/db'
import { fetchJson, resolveConnectorSecret, type SourceConnection } from '@/lib/ingestion/connectors/base'
import { appendOperationalEvent, stableHash } from '@/lib/operational-events'

interface CrmSourceRow {
  id: string
  client_id: string
  source_type: 'hubspot' | 'salesforce'
  name: string
  auth_type: SourceConnection['authType']
  config: Record<string, unknown>
  cursor_state: Record<string, unknown>
  rate_limit_per_minute: number
}

interface ContactRow {
  id: string
  email: string
  name: string | null
  title: string | null
  company: string | null
  company_domain: string | null
  status: string
  updated_at: string
}

function toConnection(row: CrmSourceRow): SourceConnection {
  return {
    id: row.id,
    clientId: Number(row.client_id),
    sourceType: row.source_type,
    name: row.name,
    authType: row.auth_type,
    config: row.config ?? {},
    cursorState: row.cursor_state ?? {},
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
  }
}

async function loadCrmSource(clientId: number, provider: 'hubspot' | 'salesforce') {
  const row = await queryOne<CrmSourceRow>(
    `SELECT id::text, client_id::text, source_type, name, auth_type, config, cursor_state, rate_limit_per_minute
     FROM source_connections
     WHERE client_id = $1
       AND source_type = $2
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [clientId, provider]
  )
  return row ? toConnection(row) : null
}

async function syncHubSpotContact(connection: SourceConnection, contact: ContactRow) {
  const token = await resolveConnectorSecret(connection, ['HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_API_KEY'])
  if (!token) throw new Error('hubspot_missing_token')
  const payload = {
    properties: {
      email: contact.email,
      firstname: contact.name?.split(/\s+/)[0] ?? '',
      lastname: contact.name?.split(/\s+/).slice(1).join(' ') ?? '',
      jobtitle: contact.title ?? '',
      company: contact.company ?? '',
      website: contact.company_domain ?? '',
      xavira_status: contact.status,
    },
  }
  return fetchJson({
    url: 'https://api.hubapi.com/crm/v3/objects/contacts',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: payload,
  })
}

async function syncSalesforceLead(connection: SourceConnection, contact: ContactRow) {
  const token = await resolveConnectorSecret(connection, ['SALESFORCE_ACCESS_TOKEN'])
  const instanceUrl = String(connection.config.instanceUrl ?? process.env.SALESFORCE_INSTANCE_URL ?? '').replace(/\/$/, '')
  if (!token) throw new Error('salesforce_missing_token')
  if (!instanceUrl) throw new Error('salesforce_missing_instance_url')
  const version = String(connection.config.apiVersion ?? 'v60.0')
  return fetchJson({
    url: `${instanceUrl}/services/data/${version}/sobjects/Lead`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      Email: contact.email,
      FirstName: contact.name?.split(/\s+/)[0] ?? undefined,
      LastName: contact.name?.split(/\s+/).slice(1).join(' ') || contact.email,
      Title: contact.title ?? undefined,
      Company: contact.company ?? contact.company_domain ?? contact.email.split('@')[1],
      Website: contact.company_domain ?? undefined,
    },
  })
}

export async function syncRecentContactsToCrm(input: {
  clientId: number
  provider: 'hubspot' | 'salesforce'
  limit?: number
}) {
  const connection = await loadCrmSource(input.clientId, input.provider)
  if (!connection) return { synced: 0, skipped: true, reason: 'crm_source_not_configured' }

  const contacts = await query<ContactRow>(
    `SELECT id::text, email, name, title, company, company_domain, status, updated_at::text
     FROM contacts
     WHERE client_id = $1
       AND email IS NOT NULL
       AND updated_at > now() - INTERVAL '30 days'
     ORDER BY updated_at DESC
     LIMIT $2`,
    [input.clientId, Math.min(Math.max(input.limit ?? 50, 1), 200)]
  )

  let synced = 0
  for (const contact of contacts.rows) {
    const idempotencyKey = stableHash({ provider: input.provider, contactId: contact.id, updatedAt: contact.updated_at })
    const existing = await queryOne<{ id: string }>(
      `SELECT id::text
       FROM crm_sync_events
       WHERE client_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [input.clientId, idempotencyKey]
    )
    if (existing) continue

    try {
      const remote =
        input.provider === 'hubspot'
          ? await syncHubSpotContact(connection, contact)
          : await syncSalesforceLead(connection, contact)
      await query(
        `INSERT INTO crm_sync_events (
           client_id,
           source_connection_id,
           direction,
           provider,
           local_entity_type,
           local_entity_id,
           remote_entity_id,
           status,
           idempotency_key,
           payload
         )
         VALUES ($1,$2,'outbound',$3,'contact',$4,$5,'synced',$6,$7::jsonb)`,
        [
          input.clientId,
          connection.id,
          input.provider,
          contact.id,
          String((remote as any)?.id ?? ''),
          idempotencyKey,
          JSON.stringify({ email: contact.email }),
        ]
      )
      synced += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await query(
        `INSERT INTO crm_sync_events (
           client_id,
           source_connection_id,
           direction,
           provider,
           local_entity_type,
           local_entity_id,
           status,
           idempotency_key,
           error,
           payload
         )
         VALUES ($1,$2,'outbound',$3,'contact',$4,'failed',$5,$6,$7::jsonb)
         ON CONFLICT DO NOTHING`,
        [input.clientId, connection.id, input.provider, contact.id, idempotencyKey, message.slice(0, 500), JSON.stringify({ email: contact.email })]
      )
    }
  }

  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'crm.sync_completed',
    aggregateType: 'crm',
    aggregateId: input.provider,
    actorType: 'worker',
    payload: { provider: input.provider, synced, scanned: contacts.rows.length },
  })

  return { synced, scanned: contacts.rows.length, skipped: false }
}
