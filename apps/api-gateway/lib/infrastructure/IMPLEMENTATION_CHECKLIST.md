/**
 * IMPLEMENTATION CHECKLIST
 *
 * Step-by-step guide to integrate the autonomous infrastructure
 */

// ============================================================
// STEP 1: Update Queue Worker
// ============================================================

/*
File: worker/index.ts

Replace the manual distribution logic with the coordinator:
*/

import { coordinator } from '@/lib/infrastructure'

async function processQueueWorker() {
  console.log('[Worker] Starting queue processor...')

  // Initialize coordinator (auto-done on import)

  // Main processing loop
  setInterval(async () => {
    try {
      // Get batch of emails to send
      const emails = await getQueuedEmails({ limit: 100, status: 'pending' })

      if (emails.length === 0) {
        console.log('[Worker] No emails to process')
        return
      }

      console.log(`[Worker] Processing ${emails.length} emails...`)

      // Get infrastructure state
      const state = await coordinator.getState()

      // Check if system is healthy before processing
      if (!state.systemHealth.isHealthy) {
        console.warn('[Worker] System has issues:', state.systemHealth.issues)
        // Still process, but coordinator will handle it
      }

      // Process each email
      const results = {
        sent: 0,
        failed: 0,
        failedIds: [] as string[],
      }

      for (const email of emails) {
        // Use coordinator for sending
        const result = await coordinator.send({
          campaignId: email.campaign_id,
          to: email.to,
          from: email.from || 'noreply@sovereignengine.com',
          subject: email.subject,
          html: email.html_body,
          text: email.text_body,
          metadata: {
            contactId: email.contact_id,
            campaignId: email.campaign_id,
            sequenceId: email.sequence_id,
          },
        })

        if (result.success) {
          // Mark as sent in database
          await markEmailAsSent(email.id, {
            messageId: result.messageId,
            inbox: result.inboxUsed,
            domain: result.domainUsed,
          })
          results.sent++
        } else {
          // Mark as failed
          await markEmailAsFailed(email.id, result.error)
          results.failed++
          results.failedIds.push(email.id)
        }
      }

      console.log(`[Worker] Processed: ${results.sent} sent, ${results.failed} failed`)

      // Log metrics
      await logQueueMetrics({
        timestamp: new Date(),
        processed: emails.length,
        sent: results.sent,
        failed: results.failed,
        successRate: (results.sent / emails.length) * 100,
      })
    } catch (error) {
      console.error('[Worker] Processing error:', error)
    }
  }, 5000) // Process every 5 seconds
}

// ============================================================
// STEP 2: Create Infrastructure Status API
// ============================================================

/*
File: app/api/infrastructure/status/route.ts
Endpoint: GET /api/infrastructure/status
*/

import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

export async function GET() {
  try {
    const state = await coordinator.getState()

    return NextResponse.json({
      success: true,
      data: {
        capacity: {
          current: state.currentCapacity,
          target: state.targetCapacity,
          utilization: Math.round(state.capacityUtilization),
          utilizationPercent: `${Math.round(state.capacityUtilization)}%`,
        },
        domains: {
          healthy: state.healthyDomains,
          total: state.healthyDomains, // Would need to fetch total
        },
        inboxes: {
          active: state.totalInboxes,
        },
        health: {
          status: state.systemHealth.isHealthy ? 'healthy' : 'degraded',
          issues: state.systemHealth.issues,
          lastCheck: state.lastHealthCheck,
        },
        system: {
          isPaused: state.isPaused,
          lastOptimization: state.lastOptimization,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// ============================================================
// STEP 3: Create Distribution Report API
// ============================================================

/*
File: app/api/infrastructure/distribution/route.ts
Endpoint: GET /api/infrastructure/distribution
*/

import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

export async function GET() {
  try {
    const report = await coordinator.getReport()

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalInboxes: report.totalInboxes,
          healthyInboxes: report.healthyInboxes,
          fullyUsedInboxes: report.fullyUsedInboxes,
          availableCapacity: report.availableCapacity,
          averageUtilization: Math.round(report.averageUtilization),
        },
        distributions: report.distributions.map((d: any) => ({
          domain: d.domain,
          inbox: d.inbox,
          sentToday: d.sentToday,
          remaining: d.remaining,
          utilizationPercent: Math.round(d.utilization),
        })),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// ============================================================
// STEP 4: Create Emergency Control API
// ============================================================

/*
File: app/api/infrastructure/pause/route.ts
Endpoints:
  POST /api/infrastructure/pause - Pause sending
  POST /api/infrastructure/resume - Resume sending
*/

import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

export async function POST(req: Request) {
  try {
    const { action, reason } = await req.json()

    if (action === 'pause') {
      await coordinator.pause(reason || 'Manual pause')
      return NextResponse.json({ success: true, status: 'paused' })
    } else if (action === 'resume') {
      await coordinator.resume()
      return NextResponse.json({ success: true, status: 'resumed' })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// ============================================================
// STEP 5: Create Dashboard Component
// ============================================================

/*
File: components/infrastructure-dashboard.tsx

Real-time monitoring dashboard
*/

'use client'

import { useEffect, useState } from 'react'

export function InfrastructureDashboard() {
  const [state, setState] = useState<any>(null)
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [stateRes, reportRes] = await Promise.all([
          fetch('/api/infrastructure/status'),
          fetch('/api/infrastructure/distribution'),
        ])

        if (stateRes.ok && reportRes.ok) {
          const stateData = await stateRes.json()
          const reportData = await reportRes.json()

          setState(stateData.data)
          setReport(reportData.data)
        }
      } catch (error) {
        console.error('Failed to fetch data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div>Loading infrastructure data...</div>
  if (!state) return <div>Failed to load data</div>

  const capacityPercent = state.capacity.utilization
  const healthStatus = state.health.status

  return (
    <div className="grid gap-4">
      {/* Capacity Card */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Capacity</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Current</span>
            <span>{state.capacity.current.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Target</span>
            <span>{state.capacity.target.toLocaleString()}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                capacityPercent > 90
                  ? 'bg-red-500'
                  : capacityPercent > 75
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(capacityPercent, 100)}%` }}
            />
          </div>
          <div className="text-sm text-gray-500">{capacityPercent}% utilized</div>
        </div>
      </div>

      {/* Health Card */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-4">System Health</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                healthStatus === 'healthy' ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="capitalize">{healthStatus}</span>
          </div>
          {state.health.issues.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-medium text-red-600">Issues:</p>
              <ul className="text-sm text-red-500 list-disc list-inside">
                {state.health.issues.map((issue: string, i: number) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Distribution Card */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Distribution</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Healthy Inboxes</span>
            <span>
              {report.summary.healthyInboxes} / {report.summary.totalInboxes}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Available Capacity</span>
            <span>{report.summary.availableCapacity}</span>
          </div>
          <div className="flex justify-between">
            <span>Average Utilization</span>
            <span>{report.summary.averageUtilization}%</span>
          </div>
        </div>
      </div>

      {/* Domains Card */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Domains</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Healthy Domains</span>
            <span>{state.domains.healthy}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Inboxes</span>
            <span>{state.inboxes.active}</span>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-4">System Status</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Status</span>
            <span className={state.system.isPaused ? 'text-red-500' : 'text-green-500'}>
              {state.system.isPaused ? 'PAUSED' : 'RUNNING'}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Last optimization: {new Date(state.system.lastOptimization).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// STEP 6: Add to Campaign Send API
// ============================================================

/*
File: app/api/campaigns/[id]/send/route.ts

Integrate coordinator into campaign sending endpoint
*/

import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { contactIds } = await req.json()
    const campaignId = params.id

    // Get campaign and contacts
    const campaign = await getCampaign(campaignId)
    const contacts = await getContactsForCampaign(contactIds)

    // Queue emails
    const results = []

    for (const contact of contacts) {
      // Use coordinator to send immediately (or queue for later)
      const result = await coordinator.send({
        campaignId,
        to: contact.email,
        subject: campaign.subject,
        html: campaign.html,
        text: campaign.text,
        metadata: {
          contactId: contact.id,
          listId: contact.list_id,
        },
      })

      results.push({
        contactId: contact.id,
        success: result.success,
        error: result.error,
        inbox: result.inboxUsed,
      })
    }

    const successCount = results.filter((r) => r.success).length

    return NextResponse.json({
      success: true,
      sent: successCount,
      failed: results.length - successCount,
      details: results,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// ============================================================
// STEP 7: Database Migration
// ============================================================

/*
Run this migration to create infrastructure tables:

-- Create domains table with warmup support
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  bounce_rate DECIMAL(5,4) DEFAULT 0,
  spam_rate DECIMAL(5,4) DEFAULT 0,
  warmup_stage INT DEFAULT 1,
  paused_until TIMESTAMP,
  api_token_expires_at TIMESTAMP,
  sending_throttle DECIMAL(3,2) DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create identities table with temp unavailable status
ALTER TABLE identities ADD COLUMN unavailable_until TIMESTAMP DEFAULT NULL;
ALTER TABLE identities ADD COLUMN sending_throttle DECIMAL(3,2) DEFAULT 1.0;

-- Create infrastructure events table
CREATE TABLE IF NOT EXISTS infrastructure_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  domain_id UUID REFERENCES domains(id),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_infrastructure_events_created_at 
ON infrastructure_events(created_at DESC);

CREATE INDEX idx_infrastructure_events_domain_id 
ON infrastructure_events(domain_id);
*/

// ============================================================
// STEP 8: Monitoring & Alerts
// ============================================================

/*
File: lib/infrastructure-monitoring.ts

Setup alerts for critical issues
*/

import { coordinator } from '@/lib/infrastructure'

export async function monitorInfrastructure() {
  setInterval(async () => {
    const state = await coordinator.getState()

    // Alert if capacity is high
    if (state.capacityUtilization > 90) {
      await sendAlert('CRITICAL', 'Capacity utilization > 90%')
    }

    // Alert if system has issues
    if (!state.systemHealth.isHealthy) {
      await sendAlert(
        'WARNING',
        `System issues: ${state.systemHealth.issues.join(', ')}`
      )
    }

    // Alert if paused
    if (state.isPaused) {
      await sendAlert('WARNING', 'Email sending is paused')
    }
  }, 60000) // Check every minute
}

async function sendAlert(severity: string, message: string) {
  console.log(`[ALERT] ${severity}: ${message}`)
  // TODO: Integrate with Slack, PagerDuty, etc.
}

// ============================================================
// SUMMARY OF CHANGES
// ============================================================

/*
Files to modify/create:

1. worker/index.ts
   - Import coordinator
   - Replace manual send logic with coordinator.send()

2. app/api/infrastructure/status/route.ts (NEW)
   - GET endpoint to retrieve infrastructure state
   - Shows capacity, health, domains, inboxes

3. app/api/infrastructure/distribution/route.ts (NEW)
   - GET endpoint to retrieve distribution details
   - Shows inbox utilization per domain

4. app/api/infrastructure/pause/route.ts (NEW)
   - POST endpoint to pause/resume sending
   - Used for emergency control

5. components/infrastructure-dashboard.tsx (NEW)
   - React component to visualize infrastructure
   - Real-time updates every 10 seconds

6. app/api/campaigns/[id]/send/route.ts
   - Integrate coordinator into campaign sending
   - Replace manual distribution

7. Database migrations
   - Add columns to existing tables
   - Create infrastructure_events table

8. lib/infrastructure-monitoring.ts (NEW)
   - Setup alerts for critical issues
   - Integrate with your alerting service

The coordinator will:
✓ Automatically scale capacity
✓ Monitor domain health
✓ Distribute emails intelligently
✓ Handle failures with failover
✓ Self-heal common issues
✓ Learn and optimize over time
*/
