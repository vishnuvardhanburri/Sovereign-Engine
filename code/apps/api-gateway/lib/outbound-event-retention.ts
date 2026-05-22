import { query } from '@/lib/db'

export type OutboundEventRetentionResult = {
  brevoFailuresDeleted: number
  staleGuardrailFailuresDeleted: number
  staleFailuresDeleted: number
  bodiesRedacted: number
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function brevoDisabled(): boolean {
  if (envBool('BREVO_DISABLED', true)) return true
  return !envBool('BREVO_ENABLED', false)
}

export async function runOutboundEventRetention(
  clientId: number
): Promise<OutboundEventRetentionResult> {
  const guardrailRetentionMinutes = envInt(
    'OUTBOUND_GUARDRAIL_EVENT_RETENTION_MINUTES',
    10,
    0,
    24 * 60
  )
  const failedRetentionHours = envInt('OUTBOUND_FAILED_EVENT_RETENTION_HOURS', 6, 0, 24 * 30)
  const redactBodies = envBool('OUTBOUND_REDACT_EVENT_BODIES', true)

  const result: OutboundEventRetentionResult = {
    brevoFailuresDeleted: 0,
    staleGuardrailFailuresDeleted: 0,
    staleFailuresDeleted: 0,
    bodiesRedacted: 0,
  }

  if (brevoDisabled()) {
    const deleted = await query(
      `DELETE FROM events
       WHERE client_id = $1
         AND event_type = 'failed'
         AND (
           COALESCE(metadata->>'error', '') ILIKE 'brevo_send_failed:%'
           OR COALESCE(metadata->>'reason', '') ILIKE 'brevo_send_failed:%'
         )`,
      [clientId]
    )
    result.brevoFailuresDeleted = deleted.rowCount
  }

  if (guardrailRetentionMinutes >= 0) {
    const deleted = await query(
      `DELETE FROM events
       WHERE client_id = $1
         AND event_type = 'failed'
         AND COALESCE(metadata->>'reason', metadata->>'error', '') = 'pre_send_guardrail'
         AND created_at < NOW() - ($2::int * INTERVAL '1 minute')`,
      [clientId, guardrailRetentionMinutes]
    )
    result.staleGuardrailFailuresDeleted = deleted.rowCount
  }

  if (failedRetentionHours > 0) {
    const deleted = await query(
      `DELETE FROM events
       WHERE client_id = $1
         AND event_type = 'failed'
         AND created_at < NOW() - ($2::int * INTERVAL '1 hour')`,
      [clientId, failedRetentionHours]
    )
    result.staleFailuresDeleted = deleted.rowCount
  }

  if (redactBodies) {
    const redacted = await query(
      `UPDATE events
       SET metadata = COALESCE(metadata, '{}'::jsonb)
         - 'body'
         - 'body_text'
         - 'body_html'
         - 'html'
         - 'text'
       WHERE client_id = $1
         AND event_type IN ('sent', 'failed', 'bounce')
         AND (
           metadata ? 'body'
           OR metadata ? 'body_text'
           OR metadata ? 'body_html'
           OR metadata ? 'html'
           OR metadata ? 'text'
         )`,
      [clientId]
    )
    result.bodiesRedacted = redacted.rowCount
  }

  return result
}
