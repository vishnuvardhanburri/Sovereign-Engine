import { parse } from 'node:path'
import {
  asString,
  type ConnectorPullInput,
  type ConnectorPullResult,
  type IngestionConnector,
} from '@/lib/ingestion/connectors/base'

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"' && line[i + 1] === '"') {
      current += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

export function parseCsvText(text: string): Array<Record<string, unknown>> {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]!).map((header) => header.replace(/^\uFEFF/, '').trim())
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return headers.reduce<Record<string, unknown>>((row, header, index) => {
      row[header] = cells[index] ?? ''
      return row
    }, {})
  })
}

export const csvConnector: IngestionConnector = {
  sourceType: 'csv',
  async pull({ connection, limit }: ConnectorPullInput): Promise<ConnectorPullResult> {
    const csvText = asString(connection.config.csvText)
    const fileName = asString(connection.config.fileName)
    if (!csvText) throw new Error('csv_missing_inline_payload')
    const offset = Number(connection.cursorState.offset ?? 0) || 0
    const records = parseCsvText(csvText).slice(offset, offset + limit).map((record) => ({
      ...record,
      source_file: fileName ? parse(fileName).base : 'inline.csv',
    }))
    return {
      records,
      nextCursor: { offset: offset + records.length },
      exhausted: records.length < limit,
    }
  },
}
