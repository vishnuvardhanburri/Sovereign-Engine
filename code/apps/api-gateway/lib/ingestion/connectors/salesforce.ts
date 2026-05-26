import {
  asString,
  fetchJson,
  recordsAtPath,
  resolveConnectorSecret,
  type ConnectorPullInput,
  type ConnectorPullResult,
  type IngestionConnector,
} from '@/lib/ingestion/connectors/base'

export const salesforceConnector: IngestionConnector = {
  sourceType: 'salesforce',
  async pull({ connection, limit }: ConnectorPullInput): Promise<ConnectorPullResult> {
    const token = await resolveConnectorSecret(connection, ['SALESFORCE_ACCESS_TOKEN'])
    const instanceUrl = asString(connection.config.instanceUrl) || process.env.SALESFORCE_INSTANCE_URL
    if (!token) throw new Error('salesforce_missing_token')
    if (!instanceUrl) throw new Error('salesforce_missing_instance_url')

    const nextUrl = asString(connection.cursorState.nextRecordsUrl)
    const apiVersion = asString(connection.config.apiVersion) || 'v60.0'
    const soql =
      asString(connection.config.soql) ||
      `SELECT Id, Email, FirstName, LastName, Title, Company, Website FROM Lead WHERE Email != null ORDER BY LastModifiedDate DESC LIMIT ${Math.min(
        limit,
        200
      )}`
    const url = nextUrl
      ? new URL(nextUrl, instanceUrl).toString()
      : `${instanceUrl.replace(/\/$/, '')}/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`

    const payload = await fetchJson({
      url,
      headers: { authorization: `Bearer ${token}` },
    })
    const records = recordsAtPath(payload, asString(connection.config.recordsPath) || 'records').map((lead) => ({
      id: lead.Id ?? lead.id,
      email: lead.Email ?? lead.email,
      first_name: lead.FirstName ?? lead.first_name,
      last_name: lead.LastName ?? lead.last_name,
      title: lead.Title ?? lead.title,
      company: lead.Company ?? lead.company,
      company_domain: lead.Website ?? lead.website,
      source_record_type: 'salesforce_lead',
    }))

    const nextRecordsUrl = asString((payload as Record<string, unknown>).nextRecordsUrl)
    return {
      records: records.slice(0, limit),
      nextCursor: nextRecordsUrl ? { nextRecordsUrl } : connection.cursorState,
      exhausted: Boolean((payload as Record<string, unknown>).done),
    }
  },
}
