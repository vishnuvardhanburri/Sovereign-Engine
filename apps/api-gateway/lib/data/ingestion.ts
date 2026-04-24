import { parseCsvLeadFile } from '@/lib/ai/document-parser'

export type IngestLead = {
  name: string
  email: string
  company: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function ingestCsvBuffer(input: { buffer: Buffer; limit?: number }): Promise<IngestLead[]> {
  const rows = await parseCsvLeadFile(input.buffer.toString('utf8'))
  const limit = Math.max(1, Math.min(50000, input.limit ?? 5000))
  const seen = new Set<string>()
  const out: IngestLead[] = []

  for (const row of rows) {
    const email = normalizeEmail(String(row.email ?? ''))
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    out.push({
      name: String(row.name ?? '').trim(),
      email,
      company: String(row.company ?? '').trim(),
    })
    if (out.length >= limit) break
  }

  return out
}

