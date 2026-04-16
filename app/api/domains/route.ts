import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { Domain, DomainWithStats } from '@/lib/db/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { domain, daily_limit = 50, warmup_stage = 0 } = body

    if (!domain || !domain.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
      return NextResponse.json(
        { error: 'Invalid domain format' },
        { status: 400 }
      )
    }

    if (daily_limit < 1 || daily_limit > 500) {
      return NextResponse.json(
        { error: 'Daily limit must be between 1 and 500' },
        { status: 400 }
      )
    }

    const existing = await queryOne<Domain>(
      'SELECT * FROM domains WHERE domain = $1',
      [domain]
    )

    if (existing) {
      return NextResponse.json(
        { error: 'Domain already exists' },
        { status: 409 }
      )
    }

    const result = await queryOne<Domain>(
      `INSERT INTO domains (domain, daily_limit, warmup_stage)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [domain, daily_limit, warmup_stage]
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('[API] Error creating domain:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const results = await query<Domain>(
      `SELECT d.*, 
              COUNT(DISTINCT i.id) as identity_count,
              COALESCE(SUM(i.sent_today), 0) as today_sent
       FROM domains d
       LEFT JOIN identities i ON d.id = i.domain_id
       GROUP BY d.id
       ORDER BY d.created_at DESC`
    )

    const domains = results.rows.map((d: any) => ({
      ...d,
      identity_count: parseInt(d.identity_count),
      today_sent: parseInt(d.today_sent),
      capacity_remaining: Math.max(0, d.daily_limit - parseInt(d.today_sent)),
    }))

    return NextResponse.json(domains)
  } catch (error) {
    console.error('[API] Error fetching domains:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
