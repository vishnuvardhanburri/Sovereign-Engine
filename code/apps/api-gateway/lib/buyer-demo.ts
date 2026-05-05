import { importContacts, parseContactsCsv } from '@/lib/backend'
import { ensureClientExists } from '@/lib/client-context'
import { query, queryOne, transaction } from '@/lib/db'
import { setDemoModeEnabled } from '@/lib/demo-mode'
import { recordAuditLog } from '@/lib/security/audit-log'

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'

const DEMO_DOMAIN = 'sovereign-demo.example'
const DEMO_CLIENT_ID = 1
const PROVIDERS: Provider[] = ['gmail', 'outlook', 'yahoo', 'other']

const SAMPLE_CSV = `email,name,company,title,timezone,company_domain,source
ava.chen@northstar.example,Ava Chen,Northstar Robotics,VP Revenue,America/New_York,northstar.example,buyer_demo
marco.silva@bluefin.example,Marco Silva,Bluefin Analytics,Head of Growth,Europe/Lisbon,bluefin.example,buyer_demo
priya.rao@cobalt.example,Priya Rao,Cobalt Cloud,Founder,Asia/Kolkata,cobalt.example,buyer_demo
elena.morris@atlas.example,Elena Morris,Atlas Ops,RevOps Director,Europe/London,atlas.example,buyer_demo
noah.kim@signalforge.example,Noah Kim,SignalForge,CEO,America/Los_Angeles,signalforge.example,buyer_demo`

const providerMetrics: Record<Provider, {
  state: 'warmup' | 'normal' | 'degraded' | 'cooldown' | 'paused'
  maxPerHour: number
  maxPerMinute: number
  maxConcurrency: number
  deferralRate: number
  blockRate: number
  successRate: number
  throttleFactor: number
  seedInbox: number
  eventType: 'ramp' | 'throttle' | 'pause' | 'resume' | 'cooldown' | 'measurement'
  severity: 'info' | 'warning' | 'critical'
  message: string
}> = {
  gmail: {
    state: 'warmup',
    maxPerHour: 100,
    maxPerMinute: 2,
    maxConcurrency: 2,
    deferralRate: 0.012,
    blockRate: 0.001,
    successRate: 0.986,
    throttleFactor: 0.9,
    seedInbox: 0.93,
    eventType: 'ramp',
    severity: 'info',
    message: '[Demo] Gmail lane safe-ramped from 50/hr to 100/hr after two healthy windows.',
  },
  outlook: {
    state: 'degraded',
    maxPerHour: 45,
    maxPerMinute: 1,
    maxConcurrency: 1,
    deferralRate: 0.041,
    blockRate: 0.006,
    successRate: 0.944,
    throttleFactor: 0.5,
    seedInbox: 0.86,
    eventType: 'throttle',
    severity: 'warning',
    message: '[Demo] Outlook lane throttled by 50% due to elevated 421 deferrals.',
  },
  yahoo: {
    state: 'normal',
    maxPerHour: 180,
    maxPerMinute: 3,
    maxConcurrency: 2,
    deferralRate: 0.006,
    blockRate: 0,
    successRate: 0.992,
    throttleFactor: 1,
    seedInbox: 0.96,
    eventType: 'measurement',
    severity: 'info',
    message: '[Demo] Yahoo lane healthy; throughput held steady under adaptive control.',
  },
  other: {
    state: 'paused',
    maxPerHour: 0,
    maxPerMinute: 0,
    maxConcurrency: 0,
    deferralRate: 0.018,
    blockRate: 0.061,
    successRate: 0.91,
    throttleFactor: 0,
    seedInbox: 0.74,
    eventType: 'pause',
    severity: 'critical',
    message: '[Demo] iCloud lane paused automatically after block rate crossed emergency threshold.',
  },
}

function providerLabel(provider: Provider) {
  return provider === 'other' ? 'iCloud' : provider[0].toUpperCase() + provider.slice(1)
}

async function getDemoDomainId(clientId: number) {
  const row = await queryOne<{ id: string | number }>(
    `SELECT id FROM domains WHERE client_id = $1 AND domain = $2 LIMIT 1`,
    [clientId, DEMO_DOMAIN]
  )
  return row ? Number(row.id) : null
}

async function seedReputation(clientId: number) {
  await ensureClientExists(clientId)

  const domain = await queryOne<{ id: string | number }>(
    `INSERT INTO domains (
       client_id,
       domain,
       status,
       paused,
       warmup_stage,
       spf_valid,
       dkim_valid,
       dmarc_valid,
       daily_limit,
       daily_cap,
       sent_today,
       sent_count,
       bounce_count,
       health_score,
       bounce_rate,
       spam_rate,
       updated_at
     )
     VALUES ($1,$2,'warming',false,2,true,true,true,1200,1200,840,18420,318,91.5,1.72,0.021,CURRENT_TIMESTAMP)
     ON CONFLICT (client_id, domain)
     DO UPDATE SET
       status = EXCLUDED.status,
       paused = false,
       spf_valid = true,
       dkim_valid = true,
       dmarc_valid = true,
       daily_limit = EXCLUDED.daily_limit,
       daily_cap = EXCLUDED.daily_cap,
       sent_today = EXCLUDED.sent_today,
       sent_count = EXCLUDED.sent_count,
       bounce_count = EXCLUDED.bounce_count,
       health_score = EXCLUDED.health_score,
       bounce_rate = EXCLUDED.bounce_rate,
       spam_rate = EXCLUDED.spam_rate,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [clientId, DEMO_DOMAIN]
  )

  const domainId = Number(domain?.id)
  if (!domainId) throw new Error('Failed to create demo domain')

  await transaction(async (exec) => {
    for (const provider of PROVIDERS) {
      const metrics = providerMetrics[provider]
      const metricsSnapshot = {
        demo: true,
        metrics: {
          deferralRate1h: metrics.deferralRate,
          blockRate1h: metrics.blockRate,
          sendSuccessRate1h: metrics.successRate,
          seedPlacementInboxRate: metrics.seedInbox,
        },
        signal: {
          provider,
          label: providerLabel(provider),
          safeRamp: true,
        },
      }

      await exec(
        `INSERT INTO reputation_state (
           client_id,
           domain_id,
           provider,
           state,
           max_per_hour,
           max_per_minute,
           max_concurrency,
           cooldown_until,
           reasons,
           metrics_snapshot,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,CURRENT_TIMESTAMP)
         ON CONFLICT (client_id, domain_id, provider)
         DO UPDATE SET
           state = EXCLUDED.state,
           max_per_hour = EXCLUDED.max_per_hour,
           max_per_minute = EXCLUDED.max_per_minute,
           max_concurrency = EXCLUDED.max_concurrency,
           cooldown_until = EXCLUDED.cooldown_until,
           reasons = EXCLUDED.reasons,
           metrics_snapshot = EXCLUDED.metrics_snapshot,
           updated_at = CURRENT_TIMESTAMP`,
        [
          clientId,
          domainId,
          provider,
          metrics.state,
          metrics.maxPerHour,
          metrics.maxPerMinute,
          metrics.maxConcurrency,
          metrics.state === 'paused' ? new Date(Date.now() + 45 * 60_000).toISOString() : null,
          JSON.stringify(['buyer_demo_seed', `${provider}_lane`]),
          JSON.stringify(metricsSnapshot),
        ]
      )

      await exec(
        `INSERT INTO provider_health_snapshots (
           client_id,
           domain_id,
           provider,
           deferral_rate,
           block_rate,
           success_rate,
           throttle_factor,
           created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
        [
          clientId,
          domainId,
          provider,
          metrics.deferralRate,
          metrics.blockRate,
          metrics.successRate,
          metrics.throttleFactor,
        ]
      )

      await exec(
        `INSERT INTO reputation_events (
           client_id,
           domain_id,
           provider,
           event_type,
           severity,
           message,
           previous_state,
           next_state,
           metrics_snapshot,
           created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,CURRENT_TIMESTAMP)`,
        [
          clientId,
          domainId,
          provider,
          metrics.eventType,
          metrics.severity,
          metrics.message,
          JSON.stringify({ demo: true, max_per_hour: Math.max(0, Math.floor(metrics.maxPerHour / 2)) }),
          JSON.stringify({ demo: true, state: metrics.state, max_per_hour: metrics.maxPerHour }),
          JSON.stringify(metricsSnapshot),
        ]
      )

      for (let i = 0; i < 8; i++) {
        await exec(
          `INSERT INTO seed_placement_events (
             client_id,
             provider,
             mailbox,
             message_id,
             placement,
             metadata,
             created_at
           )
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,CURRENT_TIMESTAMP - ($7::int * INTERVAL '12 minutes'))`,
          [
            clientId,
            provider,
            `seed-${i + 1}@${provider === 'other' ? 'icloud' : provider}.example`,
            `demo-${provider}-${i + 1}`,
            i / 8 < metrics.seedInbox ? 'inbox' : 'spam',
            JSON.stringify({ demo: true, domain_id: domainId }),
            i,
          ]
        )
      }
    }
  })

  return domainId
}

export async function startBuyerDemo(input?: { request?: any; clientId?: number }) {
  const clientId = input?.clientId ?? DEMO_CLIENT_ID
  await setDemoModeEnabled(true)

  const contacts = parseContactsCsv(SAMPLE_CSV, { sourceOverride: 'demo_sample_csv' })
  const imported = await importContacts(clientId, {
    contacts,
    verify: false,
    enrich: false,
    dedupeByDomain: false,
  })
  const domainId = await seedReputation(clientId)

  await recordAuditLog({
    request: input?.request,
    actorId: input?.request ? undefined : 'buyer-demo',
    actorType: input?.request ? undefined : 'system',
    clientId,
    actionType: 'buyer_demo.start',
    resourceType: 'demo_workspace',
    resourceId: `client:${clientId}`,
    details: {
      demo_mode: true,
      contacts_imported: imported.length,
      demo_domain_id: domainId,
      routes: ['/reputation', '/setup', '/activity', '/raas', '/demo-import', '/handoff'],
    },
  })

  return {
    ok: true,
    clientId,
    domain: DEMO_DOMAIN,
    domainId,
    contactsImported: imported.length,
    routes: ['/reputation', '/setup', '/activity', '/raas', '/demo-import', '/handoff'],
  }
}

export async function resetBuyerDemo(input?: { request?: any; clientId?: number }) {
  const clientId = input?.clientId ?? DEMO_CLIENT_ID
  await setDemoModeEnabled(false)
  const domainId = await getDemoDomainId(clientId)

  if (domainId) {
    await transaction(async (exec) => {
      await exec(`DELETE FROM reputation_events WHERE client_id = $1 AND domain_id = $2`, [clientId, domainId])
      await exec(`DELETE FROM reputation_state WHERE client_id = $1 AND domain_id = $2`, [clientId, domainId])
      await exec(`DELETE FROM provider_health_snapshots WHERE client_id = $1 AND domain_id = $2`, [clientId, domainId])
      await exec(`DELETE FROM seed_placement_events WHERE client_id = $1 AND metadata->>'domain_id' = $2`, [clientId, String(domainId)])
      await exec(`DELETE FROM domains WHERE client_id = $1 AND id = $2`, [clientId, domainId])
    })
  }

  const contacts = await query<{ id: string | number }>(
    `DELETE FROM contacts
     WHERE client_id = $1
       AND source = 'demo_sample_csv'
     RETURNING id`,
    [clientId]
  )

  await recordAuditLog({
    request: input?.request,
    actorId: input?.request ? undefined : 'buyer-demo',
    actorType: input?.request ? undefined : 'system',
    clientId,
    actionType: 'buyer_demo.reset',
    resourceType: 'demo_workspace',
    resourceId: `client:${clientId}`,
    details: {
      demo_mode: false,
      removed_contacts: contacts.rowCount,
      removed_domain_id: domainId,
    },
  })

  return {
    ok: true,
    clientId,
    removedContacts: contacts.rowCount,
    removedDomainId: domainId,
  }
}

export { SAMPLE_CSV as BUYER_DEMO_SAMPLE_CSV, DEMO_DOMAIN as BUYER_DEMO_DOMAIN }
