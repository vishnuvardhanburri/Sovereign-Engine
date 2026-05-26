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

export const apolloConnector: IngestionConnector = {
  sourceType: 'apollo',
  async pull({ connection, limit }: ConnectorPullInput): Promise<ConnectorPullResult> {
    const apiKey = await resolveConnectorSecret(connection, ['APOLLO_API_KEY'])
    if (!apiKey) throw new Error('apollo_missing_api_key')

    const page = asNumber(connection.cursorState.page, 1)
    const perPage = Math.min(Math.max(asNumber(connection.config.perPage, Math.min(limit, 25)), 1), 100)
    const url = asString(connection.config.endpoint) || 'https://api.apollo.io/api/v1/mixed_people/search'
    const body = {
      page,
      per_page: Math.min(perPage, limit),
      q_keywords: asString(connection.config.keywords) || undefined,
      person_titles: Array.isArray(connection.config.personTitles) ? connection.config.personTitles : undefined,
      organization_locations: Array.isArray(connection.config.locations) ? connection.config.locations : undefined,
      organization_num_employees_ranges: Array.isArray(connection.config.employeeRanges)
        ? connection.config.employeeRanges
        : undefined,
    }

    const payload = await fetchJson({
      url,
      method: 'POST',
      headers: {
        'cache-control': 'no-cache',
        'x-api-key': apiKey,
      },
      body,
    })

    const people = recordsAtPath(payload, asString(connection.config.recordsPath) || 'people')
    const contacts = people.map((person) => {
      const org = (person.organization ?? {}) as Record<string, unknown>
      return {
        ...person,
        company: org.name ?? person.company,
        company_domain: org.website_url ?? org.primary_domain ?? person.company_domain,
        employee_count: org.estimated_num_employees ?? person.employee_count,
        source_record_type: 'apollo_person',
      }
    })

    return {
      records: contacts.slice(0, limit),
      nextCursor: { page: page + 1 },
      exhausted: contacts.length === 0,
    }
  },
}
