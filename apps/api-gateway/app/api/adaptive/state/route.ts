import { NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { loadDomainSignals, computeAdaptiveThroughput, type AdaptiveState, type ProviderSignals } from '@xavira/adaptive-controller'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
let redis: IORedis | null = null

function getRedis() {
  if (!redis) redis = new IORedis(reqEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

const db = async (sql: string, params: any[] = []) => {
  const res = await pool.query(sql, params)
  return { rows: res.rows as any[], rowCount: res.rowCount ?? 0 }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const domainId = Number(url.searchParams.get('domainId') ?? '')
    const clientId = Number(url.searchParams.get('clientId') ?? 1)
    const provider = (url.searchParams.get('provider') ?? 'other') as ProviderSignals['provider']

    if (!Number.isFinite(domainId) || domainId <= 0) {
      return NextResponse.json({ ok: false, error: 'domainId required' }, { status: 400 })
    }

    const signals = await loadDomainSignals(db as any, clientId, domainId)
    const redis = getRedis()
    const stateKey = `xv:${REGION}:adaptive:state:${clientId}:${domainId}`
    let source: 'redis' | 'snapshot' | 'cold_start' = 'redis'
    let snapshotAgeMs: number | null = null
    let stateRaw = await redis.get(stateKey)
    let state: AdaptiveState | undefined = stateRaw ? (JSON.parse(stateRaw) as any) : undefined

    if (!state) {
      const snap = await db(
        `SELECT throughput_current, cooldown_active, created_at
         FROM adaptive_state_snapshots
         WHERE client_id = $1 AND domain_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [clientId, domainId]
      )
      const row = snap.rows[0] as any
      if (row) {
        const createdAt = new Date(row.created_at).getTime()
        snapshotAgeMs = Date.now() - createdAt
        const restored: AdaptiveState = {
          throughputCurrent: Number(row.throughput_current ?? 2),
          cooldownUntil: row.cooldown_active ? Date.now() + 30 * 60_000 : 0,
        }
        await redis.set(stateKey, JSON.stringify(restored), 'EX', 60 * 60 * 24 * 7)
        state = restored
        source = 'snapshot'
      } else {
        source = 'cold_start'
      }
    }

    const providerSignals: ProviderSignals = { provider, timeWindowHour: new Date().getUTCHours() }
    const { throughput, nextState } = computeAdaptiveThroughput(signals, providerSignals, state, Date.now())

    const now = Date.now()
    const mode =
      throughput.shouldPauseDomain ? 'pause' : (nextState.cooldownUntil ?? 0) > now ? 'cooldown' : 'ramp'

    return NextResponse.json({
      ok: true,
      domainId,
      clientId,
      mode,
      source,
      snapshot_age_ms: snapshotAgeMs,
      signals,
      throughput,
      state: nextState,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
