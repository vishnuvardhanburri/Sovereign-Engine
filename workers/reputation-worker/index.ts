import 'dotenv/config'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { resolve4 } from 'dns/promises'
import { AdaptiveControlEngine, type GlobalCooldownInput, type ProviderLane } from '@sovereign/adaptive-controller'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function intEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const REGION = process.env.XV_REGION ?? 'local'
const INTERVAL_MS = Number(process.env.REPUTATION_TICK_MS ?? 30_000)
const BLACKLIST_CHECK_ENABLED = process.env.BLACKLIST_CHECK_ENABLED !== 'false'
const BLACKLIST_CHECK_INTERVAL_MS = Number(process.env.BLACKLIST_CHECK_INTERVAL_MS ?? 6 * 60 * 60_000)
const DOMAIN_BLACKLIST_ZONES = String(process.env.BLACKLIST_DOMAIN_ZONES ?? 'dbl.spamhaus.org,multi.uribl.com')
  .split(',')
  .map((zone) => zone.trim())
  .filter(Boolean)
const IP_BLACKLIST_ZONES = String(process.env.BLACKLIST_IP_ZONES ?? 'zen.spamhaus.org')
  .split(',')
  .map((zone) => zone.trim())
  .filter(Boolean)
const SENDING_IPS = String(process.env.SENDING_IPS ?? '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean)
const PG_POOL_MAX = intEnv('PG_POOL_MAX', 5, 1, 50)
const pool = new Pool({
  connectionString: reqEnv('DATABASE_URL'),
  max: PG_POOL_MAX,
  idleTimeoutMillis: intEnv('PG_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 10 * 60_000),
  connectionTimeoutMillis: intEnv('PG_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
})
const redis = new IORedis(reqEnv('REDIS_URL'))

function parseRedisPeers(raw: string | undefined) {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [regionRaw, ...urlParts] = entry.split('=')
      const region = regionRaw?.trim()
      const url = urlParts.join('=').trim()
      if (!region || !url) return null
      return { region, redis: new IORedis(url) }
    })
    .filter(Boolean) as Array<{ region: string; redis: IORedis }>
}

type DbExecutor = <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>
const db: DbExecutor = async (text, params = []) => {
  const client = await pool.connect()
  try {
    const res = await client.query(text, params)
    return { rows: res.rows as any, rowCount: res.rowCount }
  } finally {
    client.release()
  }
}
const REDIS_PEERS = parseRedisPeers(process.env.ADAPTIVE_REDIS_PEERS)
const controlEngine = new AdaptiveControlEngine({ db: db as any, redis, region: REGION, redisPeers: REDIS_PEERS })

async function broadcastCooldownOnce(key: string, input: GlobalCooldownInput, ttlSec: number) {
  const lockKey = `xv:${REGION}:adaptive:cooldown-broadcast:${key}`
  const locked = await redis.set(lockKey, '1', 'EX', ttlSec, 'NX')
  if (!locked) return
  await controlEngine.broadcastGlobalCooldown({ ...input, sourceRegion: REGION }).catch((err) => {
    console.error('[reputation-worker] global cooldown broadcast failed', { key, err })
  })
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function providerList(): ProviderLane[] {
  return ['gmail', 'outlook', 'yahoo', 'other']
}

function reverseIp(ip: string) {
  const parts = ip.split('.')
  return parts.length === 4 && parts.every((part) => Number(part) >= 0 && Number(part) <= 255)
    ? parts.reverse().join('.')
    : null
}

async function dnsblListed(queryName: string): Promise<string[] | null> {
  try {
    const answers = await resolve4(queryName)
    return answers.length ? answers : null
  } catch (error: any) {
    if (error?.code === 'ENOTFOUND' || error?.code === 'ENODATA' || error?.code === 'ETIMEOUT') return null
    return null
  }
}

async function checkDomainBlacklists(domain: string) {
  const hits: Array<{ zone: string; query: string; answers: string[] }> = []
  for (const zone of DOMAIN_BLACKLIST_ZONES) {
    const query = `${domain}.${zone}`
    const answers = await dnsblListed(query)
    if (answers) hits.push({ zone, query, answers })
  }
  return hits
}

async function checkIpBlacklists() {
  const hits: Array<{ ip: string; zone: string; query: string; answers: string[] }> = []
  for (const ip of SENDING_IPS) {
    const reversed = reverseIp(ip)
    if (!reversed) continue
    for (const zone of IP_BLACKLIST_ZONES) {
      const query = `${reversed}.${zone}`
      const answers = await dnsblListed(query)
      if (answers) hits.push({ ip, zone, query, answers })
    }
  }
  return hits
}

async function pauseDomainForBlacklist(input: {
  clientId: number
  domainId: number
  domain: string
  hits: unknown[]
}) {
  await db(
    `UPDATE domains
     SET status = 'paused', paused = TRUE, updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [input.clientId, input.domainId]
  )

  await db(
    `INSERT INTO domain_pause_events (client_id, domain_id, reason, metrics_snapshot)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [
      input.clientId,
      input.domainId,
      'blacklist_flagged',
      JSON.stringify({ hits: input.hits, checked_at: new Date().toISOString() }),
    ]
  ).catch(() => {})

  for (const provider of providerList()) {
    const signal = {
      clientId: input.clientId,
      domainId: input.domainId,
      provider,
      state: 'paused',
      action: 'pause',
      maxPerHour: 0,
      maxPerMinute: 0,
      maxConcurrency: 0,
      ratePerSecond: 0,
      burst: 0,
      jitterPct: 0.15,
      cooldownUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      reasons: ['blacklist_flagged'],
      metrics: {
        deferralRate1h: 0,
        blockRate1h: 1,
        sendSuccessRate1h: 0,
        seedPlacementInboxRate: 0,
        providerRisk: 1,
      },
    }
    await db(
      `INSERT INTO reputation_state (
         client_id, domain_id, provider, state, max_per_hour, max_per_minute,
         max_concurrency, cooldown_until, reasons, metrics_snapshot, updated_at
       )
       VALUES ($1,$2,$3,'paused',0,0,0,$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)
       ON CONFLICT (client_id, domain_id, provider)
       DO UPDATE SET
         state = 'paused',
         max_per_hour = 0,
         max_per_minute = 0,
         max_concurrency = 0,
         cooldown_until = EXCLUDED.cooldown_until,
         reasons = EXCLUDED.reasons,
         metrics_snapshot = EXCLUDED.metrics_snapshot,
         updated_at = CURRENT_TIMESTAMP`,
      [
        input.clientId,
        input.domainId,
        provider,
        signal.cooldownUntil,
        JSON.stringify(signal.reasons),
        JSON.stringify({ metrics: signal.metrics, blacklist_hits: input.hits }),
      ]
    ).catch(() => {})

    await redis.set(
      `xv:${REGION}:adaptive:lane:${input.clientId}:${input.domainId}:${provider}`,
      JSON.stringify(signal),
      'EX',
      24 * 60 * 60
    ).catch(() => {})
    await redis.set(
      `xv:${REGION}:adaptive:lane_pause:${input.clientId}:${input.domainId}:${provider}`,
      JSON.stringify(signal),
      'EX',
      24 * 60 * 60
    ).catch(() => {})
  }

  await db(
    `INSERT INTO reputation_events (client_id, domain_id, provider, event_type, severity, message, next_state, metrics_snapshot)
     VALUES ($1,$2,NULL,'pause','critical',$3,$4::jsonb,$5::jsonb)`,
    [
      input.clientId,
      input.domainId,
      `Paused ${input.domain} automatically because blacklist monitoring returned a positive listing.`,
      JSON.stringify({ state: 'paused', max_per_hour: 0, reasons: ['blacklist_flagged'] }),
      JSON.stringify({ blacklist_hits: input.hits }),
    ]
  ).catch(() => {})
}

async function runBlacklistCheck() {
  if (!BLACKLIST_CHECK_ENABLED) return
  const lockKey = `xv:${REGION}:blacklist-check:lock`
  const locked = await redis.set(lockKey, '1', 'EX', Math.ceil(BLACKLIST_CHECK_INTERVAL_MS / 1000), 'NX')
  if (!locked) return

  const ipHits = await checkIpBlacklists()
  if (ipHits.length) {
    const clients = await db<{ id: number }>(`SELECT id FROM clients ORDER BY id ASC`)
    for (const client of clients.rows) {
      await broadcastCooldownOnce(
        `client:${client.id}:ip-blacklist`,
        {
          clientId: Number(client.id),
          provider: 'all',
          reason: 'sending_ip_blacklist_flagged',
          cooldownMs: 24 * 60 * 60_000,
          severity: 'critical',
          metadata: { ipHits },
        },
        24 * 60 * 60
      )
    }
  }

  const domains = await db<{ client_id: number; id: number; domain: string }>(
    `SELECT client_id, id, domain
     FROM domains
     WHERE status = 'active'
     ORDER BY id ASC`
  )

  for (const domain of domains.rows) {
    const domainHits = await checkDomainBlacklists(domain.domain)
    const hits = [...domainHits, ...ipHits]
    if (!hits.length) continue
    await pauseDomainForBlacklist({
      clientId: Number(domain.client_id),
      domainId: Number(domain.id),
      domain: domain.domain,
      hits,
    })
  }
}

async function computeProviderLaneSignals(clientId: number, domainId: number) {
  // Uses existing events table and smtp_class tagging emitted by sender-worker.
  // This is intentionally conservative and measurement-only.
  const res = await db<{
    provider: string
    attempts_1h: string
    deferrals_1h: string
    blocks_1h: string
    successes_1h: string
  }>(
    `WITH base AS (
       SELECT
         COALESCE(metadata->>'provider','other') AS provider,
         event_type,
         created_at,
         COALESCE(metadata->>'smtp_class','') AS smtp_class
       FROM events
       WHERE client_id = $1 AND domain_id = $2
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
     )
     SELECT
       provider,
       COUNT(*)::text AS attempts_1h,
       COUNT(*) FILTER (WHERE event_type = 'failed' AND smtp_class = 'deferral')::text AS deferrals_1h,
       COUNT(*) FILTER (WHERE event_type = 'failed' AND smtp_class = 'block')::text AS blocks_1h,
       COUNT(*) FILTER (WHERE event_type IN ('sent','delivered'))::text AS successes_1h
     FROM base
     GROUP BY provider`,
    [clientId, domainId]
  )

  const map = new Map<string, { attempts: number; deferrals: number; blocks: number; successes: number }>()
  for (const row of res.rows) {
    map.set(String(row.provider || 'other'), {
      attempts: Number(row.attempts_1h ?? 0),
      deferrals: Number(row.deferrals_1h ?? 0),
      blocks: Number(row.blocks_1h ?? 0),
      successes: Number(row.successes_1h ?? 0),
    })
  }
  return map
}

async function tickOnce() {
  const clients = await db<{ id: number }>(`SELECT id FROM clients ORDER BY id ASC`)
  for (const c of clients.rows) {
    const clientId = Number(c.id)

    const domains = await db<{ id: number; domain: string; status: string }>(
      `SELECT id, domain, status FROM domains WHERE client_id = $1 ORDER BY id ASC`,
      [clientId]
    )

    for (const d of domains.rows) {
      const domainId = Number(d.id)
      const providerSignalsByLane = await computeProviderLaneSignals(clientId, domainId)

      for (const p of providerList()) {
        const laneSignals = providerSignalsByLane.get(p) ?? { attempts: 0, deferrals: 0, blocks: 0, successes: 0 }
        const attempts = laneSignals.attempts
        const deferralRate = attempts > 0 ? laneSignals.deferrals / attempts : 0
        const blockRate = attempts > 0 ? laneSignals.blocks / attempts : 0
        const successRate = attempts > 0 ? laneSignals.successes / attempts : 1

        // Convert to a conservative providerRisk used by sender-worker.
        const risk = clamp(deferralRate * 0.6 + blockRate * 1.2 + (1 - successRate) * 0.5, 0, 1)
        const providerKey = `xv:${REGION}:adaptive:provider_risk:${clientId}:${p}`
        // Store 0..0.5 to match sender-worker clamp.
        await redis.set(providerKey, String(clamp(risk, 0, 0.5)), 'EX', 60 * 10)

        if (attempts >= 5 && blockRate > 0.05) {
          await broadcastCooldownOnce(
            `client:${clientId}:provider:${p}:block-rate`,
            {
              clientId,
              provider: p,
              reason: 'provider_block_rate_1h_gt_5_percent',
              cooldownMs: 60 * 60_000,
              severity: 'critical',
              metadata: { domainId, attempts, deferralRate, blockRate, successRate },
            },
            60 * 60
          )
        }

        // Snapshot for audit/visibility.
        const throttleFactor = clamp(1 - clamp(risk, 0, 0.5), 0.5, 1)
        await db(
          `INSERT INTO provider_health_snapshots (client_id, domain_id, provider, deferral_rate, block_rate, success_rate, throttle_factor)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [clientId, domainId, p, deferralRate, blockRate, successRate, throttleFactor]
        ).catch(() => {})

        await controlEngine.runLane(clientId, domainId, p).catch((err) => {
          console.error('[reputation-worker] adaptive control failed', { clientId, domainId, provider: p, err })
        })
      }
    }
  }
}

async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now()
    try {
      await tickOnce()
      await runBlacklistCheck()
    } catch (err) {
      console.error('[reputation-worker] tick failed', err)
    }
    const elapsed = Date.now() - started
    const sleepMs = Math.max(1_000, INTERVAL_MS - elapsed)
    await new Promise((r) => setTimeout(r, sleepMs))
  }
}

main().catch((e) => {
  console.error('[reputation-worker] fatal', e)
  process.exit(1)
})
