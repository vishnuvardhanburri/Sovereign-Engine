/**
 * AUTO-SCALING SYSTEM
 *
 * Automatically provisions new domains and inboxes when capacity is low
 *
 * Trigger: If (current_capacity < target_volume), scale up
 * Action: Add new domains + inboxes + start warmup
 *
 * Example:
 *   Target: 50,000/day
 *   Current capacity: 40,000
 *   Gap: 10,000
 *   Needed: 50 new inboxes = 13 new domains (with 30% buffer)
 *   Action: Provision 13 domains, create 52 inboxes, start warmup
 */

import { query, transaction, type QueryExecutor } from '@/lib/db'
import { calculateCapacity } from './capacity-engine'

export interface AutoScaleAction {
  type: 'domain_added' | 'inbox_created' | 'warmup_started' | 'capacity_increased'
  domainId?: string
  domain?: string
  inboxId?: string
  inboxEmail?: string
  timestamp: Date
  reason: string
}

export interface AutoScaleResult {
  action: AutoScaleAction | null
  newCapacity: number
  domainsAdded: number
  inboxesAdded: number
  success: boolean
  error?: string
}

/**
 * Attempt to auto-scale if needed
 */
export async function autoScaleIfNeeded(targetVolume: number = 50000): Promise<AutoScaleResult[]> {
  const results: AutoScaleResult[] = []

  try {
    const metrics = await calculateCapacity(targetVolume)

    if (!metrics.needsScaling) {
      return results // No scaling needed
    }

    console.log(`[AutoScale] Scaling needed: gap = ${metrics.domainsToAdd} domains`)

    // Add domains (simulate in dev, real API in prod)
    for (let i = 0; i < metrics.domainsToAdd; i++) {
      const result = await addDomain(targetVolume)
      results.push(result)

      if (!result.success) {
        console.warn(`[AutoScale] Domain provisioning failed: ${result.error}`)
        break // Stop if provisioning fails
      }
    }

    return results
  } catch (error) {
    console.error('[AutoScale] Error:', error)
    return [
      {
        action: null,
        newCapacity: 0,
        domainsAdded: 0,
        inboxesAdded: 0,
        success: false,
        error: String(error),
      },
    ]
  }
}

/**
 * Add a single domain and its inboxes
 */
export async function addDomain(targetVolume: number = 50000): Promise<AutoScaleResult> {
  const INBOXES_PER_DOMAIN = 4

  try {
    return await transaction(async (executor: QueryExecutor) => {
      // Generate unique domain name
      const timestamp = Date.now()
      const newDomain = `xavira-${timestamp % 1000000}.io` // Simulated domain

      // Create domain record
      const domainResult = await executor(
        `INSERT INTO domains (domain, status, bounce_rate, spam_rate, warmup_stage)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
        [newDomain, 'warming', 0, 0, 1]
      )

      const domainId = domainResult.rows[0]?.id

      if (!domainId) {
        throw new Error('Failed to create domain')
      }

      // Create inboxes for this domain
      const inboxIds: string[] = []
      for (let i = 0; i < INBOXES_PER_DOMAIN; i++) {
        const email = `inbox${i}@${newDomain}`
        const inboxResult = await executor(
          `INSERT INTO identities (domain_id, email, status, client_id)
          VALUES ($1, $2, $3, (SELECT id FROM clients LIMIT 1))
          RETURNING id`,
          [domainId, email, 'active']
        )

        if (inboxResult.rows[0]?.id) {
          inboxIds.push(inboxResult.rows[0].id)
        }
      }

      // Log the action
      await executor(
        `INSERT INTO infrastructure_events (event_type, domain_id, details)
        VALUES ($1, $2, $3)`,
        ['domain_added', domainId, JSON.stringify({ inboxCount: inboxIds.length })]
      )

      // Recalculate capacity
      const newMetrics = await calculateCapacity(targetVolume)

      return {
        action: {
          type: 'domain_added',
          domainId,
          domain: newDomain,
          timestamp: new Date(),
          reason: 'Auto-scaling to meet target volume',
        },
        newCapacity: newMetrics.estimatedNewCapacity,
        domainsAdded: 1,
        inboxesAdded: inboxIds.length,
        success: true,
      }
    })
  } catch (error) {
    console.error('[AutoScale] Domain creation error:', error)
    return {
      action: null,
      newCapacity: 0,
      domainsAdded: 0,
      inboxesAdded: 0,
      success: false,
      error: String(error),
    }
  }
}

/**
 * Start warmup for a domain
 */
export async function startWarmupForDomain(domainId: string): Promise<boolean> {
  try {
    // Set warmup stage to 1 (10 emails/day)
    const result = await query(
      `UPDATE domains SET warmup_stage = 1, status = 'warming' WHERE id = $1`,
      [domainId]
    )

    // Log warmup start
    await query(
      `INSERT INTO infrastructure_events (event_type, domain_id, details)
      VALUES ($1, $2, $3)`,
      ['warmup_started', domainId, JSON.stringify({ stage: 1 })]
    )

    return result.rowCount > 0
  } catch (error) {
    console.error('[AutoScale] Warmup error:', error)
    return false
  }
}

/**
 * Create table for infrastructure events (if not exists)
 */
export async function initializeInfrastructureTables(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS infrastructure_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        domain_id UUID REFERENCES domains(id),
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_infrastructure_events_created_at 
      ON infrastructure_events(created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_infrastructure_events_domain_id 
      ON infrastructure_events(domain_id);
    `)

    console.log('[AutoScale] Infrastructure tables initialized')
  } catch (error) {
    // Table might already exist, which is fine
    if (!String(error).includes('already exists')) {
      console.error('[AutoScale] Table creation error:', error)
    }
  }
}

/**
 * Get auto-scale status
 */
export async function getAutoScaleStatus(): Promise<{
  isEnabled: boolean
  lastScaleAction?: Date
  domainCount: number
  inboxCount: number
  nextScaleCheckAt: Date
}> {
  try {
    // Get last scale action
    const lastActionResult = await query<{ created_at: string }>(
      `SELECT created_at FROM infrastructure_events 
      WHERE event_type = 'domain_added'
      ORDER BY created_at DESC LIMIT 1`
    )

    const domainResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM domains WHERE status != 'inactive'`
    )

    const inboxResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM identities WHERE status = 'active'`
    )

    return {
      isEnabled: true,
      lastScaleAction: lastActionResult.rows[0]
        ? new Date(lastActionResult.rows[0].created_at)
        : undefined,
      domainCount: parseInt(domainResult.rows[0]?.count ?? '0', 10),
      inboxCount: parseInt(inboxResult.rows[0]?.count ?? '0', 10),
      nextScaleCheckAt: new Date(Date.now() + 5 * 60 * 1000), // Check in 5 minutes
    }
  } catch (error) {
    console.error('[AutoScale] Status error:', error)
    return {
      isEnabled: true,
      domainCount: 0,
      inboxCount: 0,
      nextScaleCheckAt: new Date(),
    }
  }
}
