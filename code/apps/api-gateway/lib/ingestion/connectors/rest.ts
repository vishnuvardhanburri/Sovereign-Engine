import {
  asString,
  fetchJson,
  recordsAtPath,
  resolveConnectorSecret,
  type ConnectorPullInput,
  type ConnectorPullResult,
  type IngestionConnector,
} from '@/lib/ingestion/connectors/base'

export const restConnector: IngestionConnector = {
  sourceType: 'rest',
  async pull({ connection, limit }: ConnectorPullInput): Promise<ConnectorPullResult> {
    const endpoint = asString(connection.config.endpoint)
    if (!endpoint) throw new Error('rest_missing_endpoint')
    const token = await resolveConnectorSecret(connection, ['REST_INGESTION_API_KEY'])
    const cursorParam = asString(connection.config.cursorParam) || 'cursor'
    const cursor = asString(connection.cursorState.cursor)
    const url = new URL(endpoint)
    url.searchParams.set(asString(connection.config.limitParam) || 'limit', String(limit))
    if (cursor) url.searchParams.set(cursorParam, cursor)

    const payload = await fetchJson({
      url: url.toString(),
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    })

    const records = recordsAtPath(payload, asString(connection.config.recordsPath))
    const nextCursor =
      asString((payload as Record<string, unknown>).nextCursor) ||
      asString((payload as Record<string, unknown>).next_cursor) ||
      asString((payload as Record<string, unknown>).cursor)

    return {
      records: records.slice(0, limit),
      nextCursor: nextCursor ? { cursor: nextCursor } : connection.cursorState,
      exhausted: records.length === 0 || !nextCursor,
    }
  },
}

export const webhookConnector: IngestionConnector = {
  sourceType: 'webhook',
  async pull(): Promise<ConnectorPullResult> {
    return { records: [], exhausted: true }
  },
}
