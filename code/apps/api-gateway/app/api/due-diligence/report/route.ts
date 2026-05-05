import { NextRequest, NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { resolveClientId } from '@/lib/client-context'
import { queryOne } from '@/lib/db'
import { buildProductionReadinessReport } from '@/lib/setup-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DueDiligenceStats = {
  activeDomains: number
  reputationStates: number
  reputationEvents24h: number
  auditLogs24h: number
  activeSenderWorkers: number
  queueWaiting: number
}

function escapePdfText(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ')
}

function buildSimplePdf(lines: string[]) {
  const safeLines = lines.slice(0, 44)
  const body = [
    'BT',
    '/F1 20 Tf',
    '72 760 Td',
    `(${escapePdfText(safeLines[0] || 'Sovereign Engine Due Diligence Packet')}) Tj`,
    '/F1 10 Tf',
    '0 -26 Td',
    '14 TL',
    ...safeLines.slice(1).flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(body, 'utf8')} >>\nstream\n${body}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}

async function countOne(sql: string, params: unknown[]) {
  const row = await queryOne<{ count: string | number }>(sql, params).catch(() => null)
  return Number(row?.count ?? 0)
}

async function scanActiveSenderWorkers(redisUrl: string) {
  const region = process.env.XV_REGION ?? 'local'
  const freshMs = Number(process.env.WORKER_HEALTH_FRESH_MS ?? 45_000)
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 })
  try {
    let cursor = '0'
    const keys: string[] = []
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', `xv:${region}:workers:sender:*`, 'COUNT', 100)
      cursor = nextCursor
      keys.push(...batch)
    } while (cursor !== '0')

    if (!keys.length) return 0
    const now = Date.now()
    const raw = await redis.mget(...keys)
    return raw.filter((value) => {
      if (!value) return false
      try {
        const parsed = JSON.parse(value) as { lastSeenAt?: string }
        const lastSeen = Date.parse(String(parsed.lastSeenAt ?? ''))
        return Number.isFinite(lastSeen) && now - lastSeen <= freshMs
      } catch {
        return false
      }
    }).length
  } finally {
    await redis.quit()
  }
}

async function collectStats(clientId: number): Promise<DueDiligenceStats> {
  const redisUrl = process.env.REDIS_URL || ''
  const [activeDomains, reputationStates, reputationEvents24h, auditLogs24h, activeSenderWorkers, queueWaiting] =
    await Promise.all([
      countOne(`SELECT COUNT(*) AS count FROM domains WHERE client_id = $1 AND paused = false`, [clientId]),
      countOne(`SELECT COUNT(*) AS count FROM reputation_state WHERE client_id = $1`, [clientId]),
      countOne(`SELECT COUNT(*) AS count FROM reputation_events WHERE client_id = $1 AND created_at >= now() - INTERVAL '24 hours'`, [clientId]),
      countOne(`SELECT COUNT(*) AS count FROM audit_logs WHERE client_id = $1 AND timestamp_utc >= now() - INTERVAL '24 hours'`, [clientId]),
      redisUrl ? scanActiveSenderWorkers(redisUrl).catch(() => 0) : Promise.resolve(0),
      countOne(`SELECT COUNT(*) AS count FROM queue_jobs WHERE client_id = $1 AND status = 'pending'`, [clientId]),
    ])

  return {
    activeDomains,
    reputationStates,
    reputationEvents24h,
    auditLogs24h,
    activeSenderWorkers,
    queueWaiting,
  }
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const report = await buildProductionReadinessReport({
      domain: request.nextUrl.searchParams.get('domain'),
      smtpHost: request.nextUrl.searchParams.get('smtp_host'),
    })
    const stats = await collectStats(clientId)
    const generatedAt = new Date().toISOString()

    const lines = [
      'Sovereign Engine Due Diligence Packet',
      `Generated UTC: ${generatedAt}`,
      `Client ID: ${clientId}`,
      `Readiness: ${report.status} (${report.score}/100)`,
      `Domain: ${report.domain || 'not provided'}`,
      `SMTP host: ${report.smtpHost || 'not configured'}`,
      '',
      'Operational Proof',
      `Active sender workers: ${stats.activeSenderWorkers}`,
      `Active domains: ${stats.activeDomains}`,
      `Reputation lanes tracked: ${stats.reputationStates}`,
      `Queue jobs waiting: ${stats.queueWaiting}`,
      `Reputation events in last 24h: ${stats.reputationEvents24h}`,
      `Immutable audit logs in last 24h: ${stats.auditLogs24h}`,
      '',
      'Security Controls',
      '- Tamper-evident SHA-256 audit chain enabled for privileged actions.',
      '- Secret values are masked before they enter logs or dashboard events.',
      '- Demo mode uses reserved .example data and never sends real mail.',
      '- Production readiness blocks risky launch conditions before scaling.',
      '',
      'Buyer Handoff',
      '- Connect production Postgres, Redis, SMTP/ESP, validation, and sending domains.',
      '- Publish SPF, DKIM, DMARC, MTA-STS, and optional BIMI records.',
      '- Run docker compose -f docker-compose.prod.yml up -d for the production stack.',
      '- Use /setup, /reputation, /activity, and /api/health/stats for verification.',
      '',
      'Open Actions',
      ...(report.nextActions.length ? report.nextActions.map((action) => `- ${action}`) : ['- No blocking actions reported.']),
    ]

    return new NextResponse(buildSimplePdf(lines), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="sovereign-engine-due-diligence.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/due-diligence/report] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to generate due diligence report' }, { status: 500 })
  }
}
