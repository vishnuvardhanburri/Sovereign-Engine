import { NextRequest, NextResponse } from 'next/server'
import { importContacts, parseContactsCsv } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { applyColumnMapping, type ColumnMapping } from '@/lib/data/column-mapper'

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.includes('multipart/form-data')

    const body = isMultipart ? null : await request.json()
    const clientId = await resolveClientId({
      body: body ?? undefined,
      headers: request.headers,
    })

    const sourceOverride = !isMultipart && typeof body?.sourceOverride === 'string' ? body.sourceOverride : undefined
    const mode = (!isMultipart && body?.mode === 'manual') ? 'manual' : 'auto'

    let contacts: any[] | null = null

    if (isMultipart) {
      const form = await request.formData()
      const file = form.get('file')
      const mappingRaw = form.get('mapping')
      const verifyRaw = form.get('verify')
      const dedupeByDomainRaw = form.get('dedupeByDomain')

      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }
      if (typeof mappingRaw !== 'string' || !mappingRaw.trim()) {
        return NextResponse.json({ error: 'mapping is required' }, { status: 400 })
      }

      const mapping = JSON.parse(mappingRaw) as ColumnMapping
      if (!mapping?.email) {
        return NextResponse.json({ error: 'mapping.email is required' }, { status: 400 })
      }

      const name = file.name.toLowerCase()
      let rows: Array<Record<string, unknown>> = []
      if (name.endsWith('.csv')) {
        // Use the existing CSV parser for deterministic header normalization + custom fields.
        const csv = await file.text()
        contacts = parseContactsCsv(csv, { sourceOverride: 'manual_upload' })
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const { default: XLSX } = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }).slice(0, 50_000)
        contacts = applyColumnMapping(rows, mapping, { sourceOverride: 'manual_upload' })
      } else {
        return NextResponse.json({ error: 'Only CSV/XLSX supported' }, { status: 400 })
      }

      const imported = await importContacts(clientId, {
        contacts,
        // Manual mode: allow verification, but never enrichment / auto expansion.
        verify: String(verifyRaw ?? '') !== 'false',
        enrich: false,
        dedupeByDomain: String(dedupeByDomainRaw ?? '') === 'true',
      })

      return NextResponse.json({
        imported: imported.length,
        contacts: imported,
      })
    }

    contacts = Array.isArray(body?.contacts)
      ? body.contacts
      : typeof body?.csv === 'string'
      ? parseContactsCsv(body.csv, { sourceOverride })
      : null

    if (!contacts) {
      return NextResponse.json(
        { error: 'Provide either contacts[] or csv' },
        { status: 400 }
      )
    }

    const imported = await importContacts(clientId, {
      contacts,
      verify: body.verify !== false,
      // Manual mode: never enrich; auto mode may enrich if explicitly requested.
      enrich: mode === 'manual' ? false : Boolean(body.enrich),
      dedupeByDomain: Boolean(body.dedupeByDomain),
    })

    return NextResponse.json({
      imported: imported.length,
      contacts: imported,
    })
  } catch (error) {
    console.error('[API] Failed to import contacts', error)
    return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 })
  }
}
