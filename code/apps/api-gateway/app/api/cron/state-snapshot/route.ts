import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import IORedis from 'ioredis'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
let redis: IORedis | null = null

function getRedis() {
  if (!redis) redis = new IORedis(reqEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

function providerFromEmail(email: string | null): 'gmail' | 'outlook' | 'yahoo' | 'other' {
  const d = String(email ?? '').toLowerCase().split('@')[1] ?? ''
  if (!d) return 'other'
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail'
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return 'outlook'
  if (d === 'yahoo.com' || d.endsWith('.yahoo.com')) return 'yahoo'
  return 'other'
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${appEnv.cronSecret()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Iterate active domains per client and snapshot Redis adaptive state.
    const domains = await query<{ client_id: number; domain_id: number }>(
      `SELECT client_id, id AS domain_id
       FROM domains
       WHERE status = 'active'`
    )

    const now = Date.now()
    const redis = getRedis()
    let adaptiveRows = 0
    for (const d of domains.rows) {
      const stateKey = `xv:${REGION}:adaptive:state:${d.client_id}:${d.domain_id}`
      const stateRaw = await redis.get(stateKey)
      const state = stateRaw ? (JSON.parse(stateRaw) as any) : null
      if (!state) continue

      const throughput_current = Number(state.throughputCurrent ?? null)
      const cooldown_active = Number(state.cooldownUntil ?? 0) > now
      const pressureSlow = Number((await redis.get(`xv:${REGION}:adaptive:pressure_slow:${d.client_id}`)) ?? 0) || null

      await query(
        `INSERT INTO adaptive_state_snapshots (
           client_id, domain_id, throughput_current, cooldown_active, provider_bias, pressure_slow_factor
         )
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          d.client_id,
          d.domain_id,
          Number.isFinite(throughput_current) ? throughput_current : null,
          cooldown_active,
          JSON.stringify({
            emaBounce24h: state.emaBounce24h ?? null,
            emaReply24h: state.emaReply24h ?? null,
            emaComplaint24h: state.emaComplaint24h ?? null,
            emaDeferral1h: state.emaDeferral1h ?? null,
            emaBlock1h: state.emaBlock1h ?? null,
            emaSuccess1h: state.emaSuccess1h ?? null,
            healthyWindows: state.healthyWindows ?? null,
          }),
          pressureSlow,
        ]
      ).catch(() => {})
      adaptiveRows++
    }

    // Provider health snapshot (last 1 hour), plus throttle factor from Redis provider_risk key.
    const events = await query<{ client_id: number; to_email: string | null; event_type: string; smtp_class: string | null }>(
      `SELECT
         client_id,
         COALESCE(metadata->>'to_email', NULL) AS to_email,
         event_type,
         COALESCE(metadata->>'smtp_class', NULL) AS smtp_class
       FROM events
       WHERE created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
         AND event_type IN ('sent','failed','bounce')`
    )

    const grouped = new Map<string, { clientId: number; provider: string; sent: number; failed: number; bounce: number; deferral: number; block: number }>()
    function key(clientId: number, provider: string) {
      return `${clientId}:${provider}`
    }
    function ensure(clientId: number, provider: string) {
      const k = key(clientId, provider)
      const cur = grouped.get(k)
      if (cur) return cur
      const next = { clientId, provider, sent: 0, failed: 0, bounce: 0, deferral: 0, block: 0 }
      grouped.set(k, next)
      return next
    }

    for (const r of events.rows) {
      const p = providerFromEmail(r.to_email)
      const g = ensure(r.client_id, p)
      if (r.event_type === 'sent') g.sent++
      else if (r.event_type === 'bounce') g.bounce++
      else if (r.event_type === 'failed') {
        g.failed++
        if (r.smtp_class === 'deferral') g.deferral++
        if (r.smtp_class === 'block') g.block++
      }
    }

    let providerRows = 0
    for (const g of grouped.values()) {
      const attempts = g.sent + g.failed + g.bounce
      const success_rate = attempts > 0 ? g.sent / attempts : 1
      const deferral_rate = attempts > 0 ? g.deferral / attempts : 0
      const block_rate = attempts > 0 ? g.block / attempts : 0
      const riskKey = `xv:${REGION}:adaptive:provider_risk:${g.clientId}:${g.provider}`
      const throttle_factor = Number((await redis.get(riskKey)) ?? 0) || 0

      await query(
        `INSERT INTO provider_health_snapshots (
           client_id, provider, deferral_rate, block_rate, success_rate, throttle_factor
         )
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [g.clientId, g.provider, deferral_rate, block_rate, success_rate, throttle_factor]
      ).catch(() => {})
      providerRows++
    }

    return NextResponse.json({
      ok: true,
      adaptive_snapshots_created: adaptiveRows,
      provider_snapshots_created: providerRows,
    })
  } catch (error) {
    console.error('[cron/state-snapshot] failed', error)
    return NextResponse.json({ error: 'Failed to snapshot state' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'state-snapshot' })
}
