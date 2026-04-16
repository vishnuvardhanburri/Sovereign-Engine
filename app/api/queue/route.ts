import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { enqueueJob, peekQueue } from '@/lib/redis'
import { QueueJob } from '@/lib/db/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { contact_id, campaign_id, domain_id, scheduled_at } = body

    if (!contact_id || !campaign_id || !domain_id) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Add to database queue
    const result = await queryOne<QueueJob>(
      `INSERT INTO queue (contact_id, campaign_id, domain_id, scheduled_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [contact_id, campaign_id, domain_id, scheduled_at || null]
    )

    // Add to Redis queue for real-time processing
    const jobId = await enqueueJob({
      contact_id,
      campaign_id,
      domain_id,
      scheduled_at,
    })

    return NextResponse.json(
      { ...result, redis_id: jobId },
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Error enqueueing job:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (action === 'peek') {
      const count = parseInt(searchParams.get('count') || '10')
      const jobs = await peekQueue(count)
      return NextResponse.json({ jobs, count: jobs.length })
    }

    // Get pending jobs from database
    const results = await query<QueueJob>(
      `SELECT * FROM queue 
       WHERE status = 'pending' 
       ORDER BY scheduled_at ASC NULLS FIRST, created_at ASC
       LIMIT 100`
    )

    return NextResponse.json({
      jobs: results.rows,
      count: results.rowCount,
    })
  } catch (error) {
    console.error('[API] Error fetching queue:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
