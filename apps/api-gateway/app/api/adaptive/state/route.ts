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
const redis = new IORedis(reqEnv('REDIS_URL'))

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
    const stateKey = `xv:${REGION}:adaptive:state:${clientId}:${domainId}`
    const stateRaw = await redis.get(stateKey)
    const state: AdaptiveState | undefined = stateRaw ? (JSON.parse(stateRaw) as any) : undefined

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
      signals,
      throughput,
      state: nextState,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}

