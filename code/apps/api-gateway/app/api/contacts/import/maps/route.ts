import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { appEnv } from '@/lib/env'
import {
  fetchApifyDatasetItems,
  prepareMapsLeadContacts,
} from '@/lib/maps-lead-source'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function bool(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function authorized(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

async function importFromMaps(request: NextRequest, dryRun: boolean) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}))
  const params = request.nextUrl.searchParams
  const datasetId = String(
    (body as any).datasetId ??
      params.get('datasetId') ??
      process.env.APIFY_GOOGLE_MAPS_DATASET_ID ??
      process.env.GOOGLE_MAPS_DATASET_ID ??
      ''
  ).trim()
  const token = process.env.APIFY_API_TOKEN || ''
  const limit = clampInteger(
    (body as any).limit ?? params.get('limit') ?? process.env.GOOGLE_MAPS_IMPORT_LIMIT,
    50,
    1,
    500
  )
  const offset = Math.max(0, Math.trunc(Number((body as any).offset ?? params.get('offset') ?? 0) || 0))
  const dedupeByDomain =
    typeof (body as any).dedupeByDomain === 'boolean'
      ? (body as any).dedupeByDomain
      : bool(params.get('dedupeByDomain') ?? 'true')
  const industry = String((body as any).industry ?? params.get('industry') ?? 'agency').trim()
  const region = String((body as any).region ?? params.get('region') ?? 'global').trim()

  if (!datasetId) {
    return NextResponse.json(
      { ok: false, error: 'datasetId is required. Set APIFY_GOOGLE_MAPS_DATASET_ID or pass ?datasetId=...' },
      { status: 400 }
    )
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'APIFY_API_TOKEN is not configured in the server environment' },
      { status: 400 }
    )
  }

  const clientId = await resolveClientId({
    body: body as any,
    headers: request.headers,
    searchParams: params,
  })
  const items = await fetchApifyDatasetItems({
    datasetId,
    token,
    limit,
    offset,
  })
  const prepared = prepareMapsLeadContacts(items, {
    sourceName: 'apify_google_maps',
    sourceUrl: `apify:dataset:${datasetId}`,
    limit,
    dedupeByDomain,
    industry,
    region,
  })
  const imported = dryRun
    ? []
    : await importContacts(clientId, {
        contacts: prepared.contacts,
        verify: false,
        enrich: false,
        dedupeByDomain,
      })

  if (!dryRun) {
    void notifyTelegramEvent({
      type: 'maps_import',
      imported: imported.length,
      prepared: prepared.contacts.length,
      rejected: prepared.rejected.length,
      evidenceBacked: prepared.summary.evidenceBacked,
      datasetId,
      source: 'apify_google_maps',
    })
  }

  return NextResponse.json({
    ok: true,
    clientId,
    dryRun,
    datasetId,
    offset,
    scanned: items.length,
    imported: imported.length,
    contacts: imported,
    prepared: prepared.contacts.length,
    rejected: prepared.rejected,
    summary: prepared.summary,
    guardrails: [
      'Only public business listing data is imported',
      'Personal/free-mailbox domains are rejected',
      'Blocked inboxes like support/legal/security/careers are rejected',
      'Email domain must match the business website when a website is present',
      'Imported contacts remain not_approved until evidence/research approval gates pass',
    ],
  })
}

export async function POST(request: NextRequest) {
  try {
    return await importFromMaps(request, false)
  } catch (error) {
    console.error('[API] Maps lead import failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to import Maps leads', detail: safeError(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    return await importFromMaps(request, true)
  } catch (error) {
    console.error('[API] Maps lead preview failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to preview Maps leads', detail: safeError(error) },
      { status: 500 }
    )
  }
}
