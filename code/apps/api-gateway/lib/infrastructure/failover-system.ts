/**
 * FAILOVER SYSTEM
 *
 * Automatically switches to healthy alternatives when domains fail
 *
 * Triggers:
 * - SMTP connection failure
 * - Too many bounces (> 5%)
 * - Too many spam complaints (> 2%)
 * - DNS validation failures
 * - Rate limiting (>3 failures in 5 minutes)
 *
 * Actions:
 * - Mark inbox as temporarily unavailable
 * - Switch to next healthy inbox
 * - Retry with fallback domain
 * - Log failure for investigation
 * - Auto-recover after cool-off period
 */

import { query } from '@/lib/db'

export interface FailoverEvent {
  timestamp: Date
  inboxId: string
  domainId: string
  domain: string
  failureReason: string
  failureType:
    | 'smtp_error'
    | 'bounce_spike'
    | 'spam_spike'
    | 'dns_failure'
    | 'rate_limit'
    | 'unknown'
  recoveryAction: string
  fallbackInboxId?: string
  fallbackDomain?: string
  success: boolean
}

export interface FailoverMetrics {
  failureCount24h: number
  recoveryCount24h: number
  averageRecoveryTime: number
  affectedDomains: string[]
  availableFailovers: number
}

/**
 * Handle inbox failure
 */
export async function handleInboxFailure(
  inboxId: string,
  failureReason: string,
  failureType: FailoverEvent['failureType'] = 'unknown'
): Promise<FailoverEvent | null> {
  try {
    // Get inbox details
    const inboxResult = await query<any>(
      `SELECT d.id as domain_id, d.domain, i.email FROM identities i
      JOIN domains d ON d.id = i.domain_id
      WHERE i.id = $1`,
      [inboxId]
    )

    if (inboxResult.rows.length === 0) {
      return null
    }

    const inbox = inboxResult.rows[0]

    // Mark inbox as temporarily unavailable
    const tempUnavailableUntil = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    await query(
      `UPDATE identities SET status = 'temporarily_unavailable', unavailable_until = $1 WHERE id = $2`,
      [tempUnavailableUntil, inboxId]
    )

    // Try to find fallback inbox
    let fallbackTarget = null
    fallbackTarget = await selectFallbackInbox(inbox.domain_id)

    // Log failure
    await query(
      `INSERT INTO infrastructure_events (event_type, details)
      VALUES ($1, $2)`,
      [
        'inbox_failure',
        JSON.stringify({
          inboxId,
          domain: inbox.domain,
          reason: failureReason,
          type: failureType,
          fallback: fallbackTarget?.inboxId || null,
          timestamp: new Date(),
        }),
      ]
    )

    return {
      timestamp: new Date(),
      inboxId,
      domainId: inbox.domain_id,
      domain: inbox.domain,
      failureReason,
      failureType,
      recoveryAction: fallbackTarget ? `Switched to ${fallbackTarget.email}` : 'No healthy fallback',
      fallbackInboxId: fallbackTarget?.inboxId,
      fallbackDomain: fallbackTarget?.domain,
      success: !!fallbackTarget,
    }
  } catch (error) {
    console.error('[Failover] Error handling failure:', error)
    return null
  }
}

/**
 * Select fallback inbox from healthy alternatives
 */
export async function selectFallbackInbox(domainId: string): Promise<any | null> {
  try {
    // First, try same domain
    let result = await query<any>(
      `SELECT 
        d.id as domain_id,
        d.domain,
        i.id as inbox_id,
        i.email,
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) as sent_today
      FROM domains d
      JOIN identities i ON i.domain_id = d.id
      LEFT JOIN events e ON e.from_inbox_id = i.id
      WHERE d.id = $1 
        AND i.status = 'active'
        AND d.bounce_rate < 0.05
        AND d.spam_rate < 0.02
      GROUP BY d.id, d.domain, i.id, i.email
      HAVING COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) < 50
      ORDER BY sent_today ASC
      LIMIT 1`,
      [domainId]
    )

    if (result.rows.length > 0) {
      return result.rows[0]
    }

    // If no inbox in same domain, try healthiest alternative domain
    result = await query<any>(
      `SELECT 
        d.id as domain_id,
        d.domain,
        i.id as inbox_id,
        i.email,
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) as sent_today
      FROM domains d
      JOIN identities i ON i.domain_id = d.id
      LEFT JOIN events e ON e.from_inbox_id = i.id
      WHERE d.status = 'active'
        AND d.bounce_rate < 0.05
        AND d.spam_rate < 0.02
        AND i.status = 'active'
      GROUP BY d.id, d.domain, i.id, i.email
      HAVING COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) < 50
      ORDER BY d.bounce_rate ASC, sent_today ASC
      LIMIT 1`
    )

    return result.rows[0] || null
  } catch (error) {
    console.error('[Failover] Fallback selection error:', error)
    return null
  }
}

/**
 * Auto-recover temporarily unavailable inboxes
 */
export async function autoRecoverInboxes(): Promise<string[]> {
  try {
    const recoveredIds: string[] = []

    const result = await query<any>(
      `SELECT id FROM identities 
      WHERE status = 'temporarily_unavailable' 
      AND unavailable_until IS NOT NULL 
      AND unavailable_until <= NOW()`
    )

    for (const row of result.rows) {
      const updateResult = await query(
        `UPDATE identities 
        SET status = 'active', unavailable_until = NULL 
        WHERE id = $1`,
        [row.id]
      )

      if (updateResult.rowCount > 0) {
        recoveredIds.push(row.id)

        // Log recovery
        await query(
          `INSERT INTO infrastructure_events (event_type, details)
          VALUES ($1, $2)`,
          [
            'inbox_recovered',
            JSON.stringify({
              inboxId: row.id,
              timestamp: new Date(),
            }),
          ]
        )
      }
    }

    return recoveredIds
  } catch (error) {
    console.error('[Failover] Auto-recovery error:', error)
    return []
  }
}

/**
 * Get failover metrics
 */
export async function getFailoverMetrics(): Promise<FailoverMetrics> {
  try {
    // Get failure count (last 24h)
    const failureResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM infrastructure_events 
      WHERE event_type = 'inbox_failure' 
      AND created_at > NOW() - INTERVAL '1 day'`
    )

    // Get recovery count (last 24h)
    const recoveryResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM infrastructure_events 
      WHERE event_type = 'inbox_recovered' 
      AND created_at > NOW() - INTERVAL '1 day'`
    )

    // Get affected domains
    const affectedResult = await query<any>(
      `SELECT DISTINCT d.domain FROM infrastructure_events ie
      JOIN identities i ON JSON_EXTRACT(ie.details, '$.inboxId') = i.id
      JOIN domains d ON d.id = i.domain_id
      WHERE ie.event_type = 'inbox_failure'
      AND ie.created_at > NOW() - INTERVAL '1 day'`
    )

    // Calculate average recovery time
    const recoveryTimeResult = await query<any>(
      `SELECT AVG(EXTRACT(EPOCH FROM (
        (SELECT created_at FROM infrastructure_events WHERE event_type = 'inbox_recovered' 
         ORDER BY created_at DESC LIMIT 1) - 
        (SELECT created_at FROM infrastructure_events WHERE event_type = 'inbox_failure' 
         ORDER BY created_at DESC LIMIT 1)
      ))) as avg_recovery_seconds`
    )

    const avgRecoverySeconds = parseInt(
      recoveryTimeResult.rows[0]?.avg_recovery_seconds ?? '0',
      10
    )

    // Get available failovers
    const failoverResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM identities 
      WHERE status = 'active' AND domain_id IN (
        SELECT id FROM domains WHERE status = 'active' 
        AND bounce_rate < 0.05 AND spam_rate < 0.02
      )`
    )

    return {
      failureCount24h: parseInt(failureResult.rows[0]?.count ?? '0', 10),
      recoveryCount24h: parseInt(recoveryResult.rows[0]?.count ?? '0', 10),
      averageRecoveryTime: avgRecoverySeconds,
      affectedDomains: affectedResult.rows.map((r: any) => r.domain),
      availableFailovers: parseInt(failoverResult.rows[0]?.count ?? '0', 10),
    }
  } catch (error) {
    console.error('[Failover] Metrics error:', error)
    return {
      failureCount24h: 0,
      recoveryCount24h: 0,
      averageRecoveryTime: 0,
      affectedDomains: [],
      availableFailovers: 0,
    }
  }
}

/**
 * Check if inbox is available
 */
export async function isInboxAvailable(inboxId: string): Promise<boolean> {
  try {
    const result = await query<{ status: string }>(
      `SELECT status FROM identities WHERE id = $1`,
      [inboxId]
    )

    if (result.rows.length === 0) return false

    const status = result.rows[0]?.status
    return status === 'active'
  } catch (error) {
    return false
  }
}

/**
 * Get inbox status details
 */
export async function getInboxStatus(inboxId: string): Promise<any | null> {
  try {
    const result = await query<any>(
      `SELECT 
        i.id,
        i.email,
        i.status,
        i.unavailable_until as "unavailableUntil",
        d.domain,
        d.bounce_rate as "bounceRate",
        d.spam_rate as "spamRate"
      FROM identities i
      JOIN domains d ON d.id = i.domain_id
      WHERE i.id = $1`,
      [inboxId]
    )

    return result.rows[0] || null
  } catch (error) {
    return null
  }
}
