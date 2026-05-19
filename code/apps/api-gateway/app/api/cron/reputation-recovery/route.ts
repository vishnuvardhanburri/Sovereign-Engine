import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query, transaction } from '@/lib/db'
import {
  buildDomainRecoveryActions,
  type DomainRecoverySignal,
} from '@/lib/domain-recovery'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function boolQuery(value: string | null): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function handle(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const clientId = Number(request.nextUrl.searchParams.get('client_id') || 1)
  const dryRun = boolQuery(request.nextUrl.searchParams.get('dryRun'))

  try {
    const domains = await query<DomainRecoverySignal>(
      `SELECT
         id,
         domain,
         status,
         paused,
         sent_count,
         bounce_count,
         health_score,
         bounce_rate,
         daily_limit,
         daily_cap,
         sent_today,
         spf_valid,
         dkim_valid,
         dmarc_valid
       FROM domains
       WHERE client_id = $1
       ORDER BY id`,
      [clientId]
    )

    const actions = buildDomainRecoveryActions(domains.rows)

    if (!dryRun && actions.length > 0) {
      await transaction(async (tx) => {
        for (const action of actions) {
          await tx(
            `UPDATE domains
             SET status = 'paused',
                 paused = true,
                 daily_cap = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE client_id = $1
               AND id = $2
               AND status = 'active'
               AND paused = false`,
            [clientId, action.domainId, action.recommendedDailyCap]
          )

          await tx(
            `INSERT INTO domain_pause_events (client_id, domain_id, reason, metrics_snapshot)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [
              clientId,
              action.domainId,
              action.reason,
              JSON.stringify({
                ...action.metrics,
                domain: action.domain,
                cooldownHours: action.cooldownHours,
                source: 'cron_reputation_recovery',
              }),
            ]
          )
        }
      })

      void notifyTelegramEvent({
        type: 'reputation_recovery',
        clientId,
        paused: actions.length,
        domains: actions.map((action) => action.domain),
        reason: 'domain_health_recovery_guard',
      })
    }

    return NextResponse.json({
      ok: true,
      clientId,
      dryRun,
      scanned: domains.rows.length,
      paused: dryRun ? 0 : actions.length,
      wouldPause: actions.length,
      actions,
      policy: {
        minBounceCount: 3,
        minSentCount: 10,
        bounceRatePct: 5,
        lowHealthScore: 30,
        recommendedDailyCap: 0,
      },
    })
  } catch (error) {
    console.error('[Cron] Reputation recovery failed', error)
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
