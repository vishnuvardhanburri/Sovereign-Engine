import {
  asNumber,
  asString,
  fetchJson,
  recordsAtPath,
  resolveConnectorSecret,
  type ConnectorPullInput,
  type ConnectorPullResult,
  type IngestionConnector,
} from '@/lib/ingestion/connectors/base'

export const hubspotConnector: IngestionConnector = {
  sourceType: 'hubspot',
  async pull({ connection, limit }: ConnectorPullInput): Promise<ConnectorPullResult> {
    const token = await resolveConnectorSecret(connection, ['HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_API_KEY'])
    if (!token) throw new Error('hubspot_missing_token')

    const after = asString(connection.cursorState.after)
    const baseUrl = asString(connection.config.endpoint) || 'https://api.hubapi.com/crm/v3/objects/contacts'
    const properties = asString(connection.config.properties) || 'email,firstname,lastname,jobtitle,company,website,hs_object_id'
    const url = new URL(baseUrl)
    url.searchParams.set('limit', String(Math.min(asNumber(connection.config.pageSize, 100), limit)))
    url.searchParams.set('properties', properties)
    if (after) url.searchParams.set('after', after)

    const payload = await fetchJson({
      url: url.toString(),
      headers: { authorization: `Bearer ${token}` },
    })

    const rows = recordsAtPath(payload, asString(connection.config.recordsPath) || 'results')
    const records = rows.map((row) => {
      const props = (row.properties ?? {}) as Record<string, unknown>
      return {
        id: row.id ?? props.hs_object_id,
        email: props.email,
        first_name: props.firstname,
        last_name: props.lastname,
        title: props.jobtitle,
        company: props.company,
        company_domain: props.website,
        source_record_type: 'hubspot_contact',
      }
    })

    const nextAfter = ((payload as any)?.paging?.next?.after ?? '') as string
    return {
      records: records.slice(0, limit),
      nextCursor: nextAfter ? { after: nextAfter } : connection.cursorState,
      exhausted: !nextAfter,
    }
  },
}
