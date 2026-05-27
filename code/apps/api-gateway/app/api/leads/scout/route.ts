import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidenceTimeboxed } from '@/lib/lead-scout'

export const dynamic = 'force-dynamic'

function filterImportableLeads<T extends { autoApprovalEligible?: boolean }>(
  leads: T[],
  includeUnverified: boolean
) {
  return includeUnverified ? leads : leads.filter((lead) => lead.autoApprovalEligible)
}

function numberFromValue(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === '' || raw === undefined || raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function numberFromSearch(
  searchParams: URLSearchParams,
  names: string[],
  envName: string,
  fallback: number
): number {
  for (const name of names) {
    const raw = searchParams.get(name)
    if (raw === null) continue
    return numberFromValue(raw, fallback)
  }
  return numberFromValue(process.env[envName], fallback)
}

function evidenceOptions(searchParams?: URLSearchParams, body?: Record<string, unknown>) {
  const queryValue = (names: string[], envName: string, fallback: number) => {
    for (const name of names) {
      if (body && Object.prototype.hasOwnProperty.call(body, name)) {
        return numberFromValue(body[name], fallback)
      }
    }
    return searchParams ? numberFromSearch(searchParams, names, envName, fallback) : numberFromValue(process.env[envName], fallback)
  }

  return {
    deadlineMs: Math.max(
      5_000,
      Math.min(
        queryValue(['leadScoutEvidenceDeadlineMs', 'evidenceDeadlineMs'], 'LEAD_SCOUT_EVIDENCE_DEADLINE_MS', 25_000),
        55_000
      )
    ),
    maxPagesPerLead: Math.max(
      3,
      Math.min(
        queryValue(['leadScoutEvidenceMaxPages', 'evidenceMaxPages'], 'LEAD_SCOUT_EVIDENCE_MAX_PAGES', 8),
        12
      )
    ),
    requestTimeoutMs: Math.max(
      800,
      Math.min(
        queryValue(
          ['leadScoutEvidenceRequestTimeoutMs', 'evidenceRequestTimeoutMs'],
          'LEAD_SCOUT_EVIDENCE_REQUEST_TIMEOUT_MS',
          2_000
        ),
        4_000
      )
    ),
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const result = scoutOpenLeads({
      industry: searchParams.get('industry') ?? undefined,
      region: searchParams.get('region') ?? undefined,
      persona: searchParams.get('persona') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 25),
      offset: Number(searchParams.get('offset') ?? 0),
    })

    const verification = evidenceOptions(searchParams)
    const verifiedLeads = await verifyOpenLeadEvidenceTimeboxed(result.leads, verification)
    const shouldImport = searchParams.get('import') === '1'
    const includeUnverified = searchParams.get('include_unverified') === '1'
    if (!shouldImport) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
        verification,
        leads: verifiedLeads,
        verifiedEvidenceCount: verifiedLeads.filter((lead) => lead.autoApprovalEligible).length,
      })
    }

    const importableLeads = filterImportableLeads(verifiedLeads, includeUnverified)
    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(importableLeads),
      verify: false,
      enrich: false,
      dedupeByDomain: true,
    })

    return NextResponse.json({
      ok: true,
      clientId,
      imported: contacts.length,
      contacts,
      ...result,
      verification,
      leads: verifiedLeads,
      verifiedEvidenceCount: importableLeads.length,
      blockedUnverified: verifiedLeads.length - importableLeads.length,
    })
  } catch (error) {
    console.error('[LeadScout] Failed to scout leads', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to scout leads' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const result = scoutOpenLeads({
      industry: body.industry,
      region: body.region,
      persona: body.persona,
      limit: body.limit,
      offset: body.offset,
    })

    const verification = evidenceOptions(undefined, body)
    const verifiedLeads = await verifyOpenLeadEvidenceTimeboxed(result.leads, verification)
    if (!body.importContacts) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
        verification,
        leads: verifiedLeads,
        verifiedEvidenceCount: verifiedLeads.filter((lead) => lead.autoApprovalEligible).length,
      })
    }

    const importableLeads = filterImportableLeads(verifiedLeads, Boolean(body.includeUnverified))
    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(importableLeads),
      verify: false,
      enrich: false,
      dedupeByDomain: true,
    })

    return NextResponse.json({
      ok: true,
      clientId,
      imported: contacts.length,
      contacts,
      ...result,
      verification,
      leads: verifiedLeads,
      verifiedEvidenceCount: importableLeads.length,
      blockedUnverified: verifiedLeads.length - importableLeads.length,
    })
  } catch (error) {
    console.error('[LeadScout] Failed to scout leads', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to scout leads' },
      { status: 500 }
    )
  }
}
