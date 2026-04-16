import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { Event, EventType } from '@/lib/db/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { identity_id, type, contact_email, campaign_id, metadata } = body

    if (!identity_id || !type) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (!['sent', 'bounce', 'reply', 'complaint'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid event type' },
        { status: 400 }
      )
    }

    const result = await queryOne<Event>(
      `INSERT INTO events (identity_id, type, contact_email, campaign_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [identity_id, type, contact_email || null, campaign_id || null, metadata || null]
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('[API] Error creating event:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const identity_id = searchParams.get('identity_id')
    const type = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '100')
    const hours = parseInt(searchParams.get('hours') || '24')

    let sql = `
      SELECT * FROM events 
      WHERE created_at > NOW() - INTERVAL '${hours} hours'
    `
    const params: any[] = []

    if (identity_id) {
      sql += ` AND identity_id = $${params.length + 1}`
      params.push(parseInt(identity_id))
    }

    if (type && ['sent', 'bounce', 'reply', 'complaint'].includes(type)) {
      sql += ` AND type = $${params.length + 1}`
      params.push(type)
    }

    sql += ` ORDER BY created_at DESC LIMIT ${limit}`

    const results = await query<Event>(sql, params)

    return NextResponse.json({
      events: results.rows,
      count: results.rowCount,
    })
  } catch (error) {
    console.error('[API] Error fetching events:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
