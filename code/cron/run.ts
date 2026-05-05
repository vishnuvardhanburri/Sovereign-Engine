import { collectSystemMetrics } from '@/lib/services/metrics'
import { query, queryOne } from '@/lib/db'
import { resolveClientContext } from '@/lib/tenancy/context'
import { assessWarmup } from '@/lib/agents/control/warmup-agent'
import { decideBossAction } from '@/lib/agents/boss-agent'
import { executeDecision } from '@/lib/agents/executor'
import { resolveSelfHealing } from '@/lib/agents/control/self-healing-agent'
import { selectHealthyDomain } from '@/lib/services/domain-pool'

export async function runCronCycle(clientId?: number) {
  const tenant = resolveClientContext(clientId)
  const client = tenant.clientId
  const system = await collectSystemMetrics(client)
  const domainContext = await selectHealthyDomain(client, system.campaignState.campaignId ?? 0)
  const warmup = await assessWarmup({
    domain_age_days: domainContext?.ageDays ?? 0,
    current_volume: system.metrics.sentCount,
    reply_rate: system.metrics.replyRate,
    bounce_rate: system.metrics.bounceRate,
    domain_health: system.domainHealth.healthScore,
  })

  const failedJobs = Number(
    (await queryOne<{ count: string }>(
      `SELECT COALESCE(COUNT(*)::text, '0') AS count
       FROM queue_jobs
       WHERE client_id = $1
         AND status = 'failed'
         AND updated_at >= NOW() - INTERVAL '1 hour'`,
      [client]
    ))?.count ?? '0'
  )

  if (failedJobs > 10) {
    const healthRecovery = await resolveSelfHealing({
      error: new Error(`failed jobs spike: ${failedJobs} in the last hour`),
      system_state: {
        metrics: system.metrics,
        campaignState: system.campaignState,
      },
      domain: system.domainHealth,
    })

    if (healthRecovery.action === 'pause' && system.campaignState.campaignId) {
      await query(
        `UPDATE campaigns
         SET status = 'paused',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [system.campaignState.campaignId]
      )
    }

    if (healthRecovery.action === 'reduce_volume' && system.domainHealth.domainId) {
      await query(
        `UPDATE domains
         SET daily_limit = GREATEST(0, daily_limit - $1),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [healthRecovery.recovery_plan.volume_adjustment, system.domainHealth.domainId]
      )
    }
  }

  const bossDecision = await decideBossAction({
    metrics: system.metrics,
    domainHealth: system.domainHealth,
    campaignState: system.campaignState,
    warmup,
  })

  if (bossDecision.decision === 'pause') {
    return {
      bossDecision,
      result: {
        paused: true,
        reason: bossDecision.reason,
      },
    }
  }

  const selectedLeads = system.outboundLeads.slice(0, bossDecision.execution_plan.volume)
  const jobs = selectedLeads.map((lead) => ({
    clientId: client,
    campaignId: system.campaignState.campaignId ?? 0,
    domainId: domainContext?.domainId ?? 0,
    contactId: lead.contact.id,
    contactEmail: lead.contact.email,
    subject: `Outbound ${bossDecision.execution_plan.sequence_step}`,
    body: `Hi ${lead.contact.name ?? 'there'}, this is a message for step ${bossDecision.execution_plan.sequence_step}.`,
    sequenceStep: bossDecision.execution_plan.sequence_step,
    scheduledAt: new Date(Date.now() + bossDecision.execution_plan.timing * 60 * 1000).toISOString(),
  }))

  if (jobs.length === 0) {
    return {
      bossDecision,
      result: {
        skipped: true,
        reason: 'no outbound leads available for the current campaign',
      },
    }
  }

  const result = await executeDecision({
    bossDecision,
    campaignState: system.campaignState,
    systemMetrics: system.metrics,
    domainHealth: system.domainHealth,
    payload: {
      clientId: client,
      jobs,
      sendRequest: {
        fromEmail: `no-reply@sovereignengine.com`,
        toEmail: jobs[0]?.contactEmail ?? 'recipient@example.com',
        subject: `Outbound message - ${bossDecision.execution_plan.sequence_step}`,
        html: `<p>Message body for ${bossDecision.execution_plan.sequence_step}</p>`,
        text: `Message body for ${bossDecision.execution_plan.sequence_step}`,
        headers: {
          'X-System-Decision': bossDecision.decision,
        },
      },
      followUp: {
        currentStep: bossDecision.execution_plan.sequence_step,
      },
      retry: {
        jobId: 0,
        clientId: client,
        attempts: 0,
        maxAttempts: 3,
      },
      compliance: {
        clientId: client,
        recipientEmails: jobs.map((job) => job.contactEmail),
      },
      personalization: {
        company: 'target organization',
        role: 'Decision Maker',
        offer: 'improved outreach',
        pain: 'low reply rates',
      },
      subject: {
        company: 'target organization',
        angle: 'pattern',
      },
      insight: {
        metrics: system.metrics,
        domainHealth: system.domainHealth,
      },
      research: {
        company: 'target organization',
      },
      warmupCap: warmup.allowed_volume,
      replyText: 'Thanks for the note, interested in learning more.',
      objection: 'interested',
      response: {
        classification: 'interested',
        originalMessage: 'Thanks for the note, interested in learning more.',
      },
    },
  })

  return {
    bossDecision,
    result,
  }
}

async function main() {
  const clientId = Number(process.env.CLIENT_ID || '1')

  try {
    const execution = await runCronCycle(clientId)
    console.log(JSON.stringify(execution, null, 2))
  } catch (error) {
    console.error('[CRON] run failed', error)
    process.exit(1)
  }
}

if (process.argv[1]?.endsWith('cron/run.ts')) {
  void main()
}
