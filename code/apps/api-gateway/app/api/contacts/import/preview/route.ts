import { NextRequest, NextResponse } from 'next/server'
import { suggestColumnMapping, buildPreviewStats } from '@/lib/data/column-mapper'

type PreviewResponse = {
  ok: true
  detectedColumns: string[]
  sampleRows: Array<Record<string, unknown>>
  stats: {
    totalRows: number
    validEmails: number
    invalidEmails: number
    duplicateEmails: number
  }
  suggestedMapping: Record<string, string> | null
} | {
  ok: false
  error: string
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  // Keep original keys; UI will show user-facing column names.
  return row
}

function parseCsvToRows(csv: string, limitRows = 50_000): { headers: string[]; rows: Array<Record<string, unknown>> } {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map((h) => h.trim()).filter(Boolean)
  const rows: Array<Record<string, unknown>> = []
  for (const line of lines.slice(1, limitRows + 1)) {
    const values = line.split(',').map((v) => v.trim())
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? ''
    })
    rows.push(row)
  }
  return { headers, rows }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    let headers: string[] = []
    let rows: Array<Record<string, unknown>> = []

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: 'file is required' } satisfies PreviewResponse, { status: 400 })
      }

      const name = file.name.toLowerCase()
      if (name.endsWith('.csv')) {
        const csv = await file.text()
        const parsed = parseCsvToRows(csv)
        headers = parsed.headers
        rows = parsed.rows
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const { default: XLSX } = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        rows = json.slice(0, 50_000).map(normalizeRowKeys)
        headers = Object.keys(rows[0] ?? {})
      } else {
        return NextResponse.json({ ok: false, error: 'Only CSV/XLSX supported' } satisfies PreviewResponse, { status: 400 })
      }
    } else {
      // JSON fallback (useful for scripts/tests): { csv: "..." }
      const body = await req.json()
      const csv = typeof body?.csv === 'string' ? body.csv : ''
      if (!csv.trim()) {
        return NextResponse.json({ ok: false, error: 'Provide multipart file or {csv}' } satisfies PreviewResponse, { status: 400 })
      }
      const parsed = parseCsvToRows(csv)
      headers = parsed.headers
      rows = parsed.rows
    }

    const suggested = suggestColumnMapping(headers)
    const stats = buildPreviewStats(rows, suggested)

    return NextResponse.json({
      ok: true,
      detectedColumns: headers,
      sampleRows: rows.slice(0, 10),
      stats,
      suggestedMapping: suggested,
    } satisfies PreviewResponse)
  } catch (error) {
    console.error('[API] contacts/import/preview failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to preview import' } satisfies PreviewResponse, { status: 500 })
  }
}

