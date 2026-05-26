import { apolloConnector } from '@/lib/ingestion/connectors/apollo'
import { csvConnector } from '@/lib/ingestion/connectors/csv'
import { hubspotConnector } from '@/lib/ingestion/connectors/hubspot'
import { restConnector, webhookConnector } from '@/lib/ingestion/connectors/rest'
import { salesforceConnector } from '@/lib/ingestion/connectors/salesforce'
import type { IngestionSourceType } from '@/lib/ingestion/connector-registry'
import type { IngestionConnector } from '@/lib/ingestion/connectors/base'

const CONNECTORS = new Map<IngestionSourceType, IngestionConnector>(
  [apolloConnector, hubspotConnector, salesforceConnector, restConnector, webhookConnector, csvConnector].map((connector) => [
    connector.sourceType,
    connector,
  ])
)

export function getIngestionConnector(sourceType: IngestionSourceType): IngestionConnector {
  const connector = CONNECTORS.get(sourceType)
  if (!connector) throw new Error(`connector_not_implemented:${sourceType}`)
  return connector
}
