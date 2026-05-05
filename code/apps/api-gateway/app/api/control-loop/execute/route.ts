/**
 * Control Loop Enforcer API Endpoint
 * POST /api/control-loop/execute
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeControlLoop, getControlLoopStatus, ControlLoopEnforcer } from '@/lib/control-loop-enforcer'
import { query } from '@/lib/db'

interface ExecuteRequest {
  target?: number
  emailIds?: string[]
  campaignId?: string
}

type QueueEmail = {
  id: string
  to: string
  subject: string
  body: string
  campaign_id: string
  contact_id: string
}

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteRequest = await request.json()
    const { target = 50000, emailIds, campaignId } = body

    if (!emailIds && !campaignId) {
      return NextResponse.json(
        { error: 'Either emailIds or campaignId must be provided' },
        { status: 400 }
      )
    }

    // Get emails to send
    let emailQueue: QueueEmail[] = []

    if (emailIds) {
      // Get specific emails
      const result = await query<QueueEmail>(`
        SELECT id, recipient_email as "to", subject, body, campaign_id, contact_id
        FROM emails
        WHERE id = ANY($1) AND status = 'pending'
        ORDER BY created_at ASC
      `, [emailIds])

      emailQueue = result.rows.map((row) => ({
        ...row,
        campaign_id: String(row.campaign_id),
        contact_id: String(row.contact_id),
      }))
    } else if (campaignId) {
      // Get all pending emails for campaign
      const result = await query<QueueEmail>(`
        SELECT id, recipient_email as "to", subject, body, campaign_id, contact_id
        FROM emails
        WHERE campaign_id = $1 AND status = 'pending'
        ORDER BY created_at ASC
      `, [campaignId])

      emailQueue = result.rows.map((row) => ({
        ...row,
        campaign_id: String(row.campaign_id),
        contact_id: String(row.contact_id),
      }))
    }

    if (emailQueue.length === 0) {
      return NextResponse.json(
        { error: 'No pending emails found' },
        { status: 400 }
      )
    }

    console.log(`[API] Starting control loop enforcer for ${target} emails from queue of ${emailQueue.length}`)

    // Execute control loop (this will run synchronously and may take a long time)
    const result = await executeControlLoop(emailQueue, target)

    // Update email statuses in database
    if (result.sent > 0) {
      // Mark sent emails as sent
      const sentEmails = emailQueue.slice(0, result.sent)
      const sentIds = sentEmails.map(e => e.id)

      await query(`
        UPDATE emails
        SET status = 'sent', sent_at = NOW()
        WHERE id = ANY($1)
      `, [sentIds])
    }

    return NextResponse.json({
      success: true,
      result,
      message: `Control loop completed: ${result.sent}/${result.target} emails sent`,
    })

  } catch (error) {
    console.error('[API] Control loop execution error:', error)
    return NextResponse.json(
      { error: 'Control loop execution failed', details: String(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const status = await getControlLoopStatus()

    return NextResponse.json({
      success: true,
      status,
    })
  } catch (error) {
    console.error('[API] Control loop status error:', error)
    return NextResponse.json(
      { error: 'Failed to get control loop status', details: String(error) },
      { status: 500 }
    )
  }
}
