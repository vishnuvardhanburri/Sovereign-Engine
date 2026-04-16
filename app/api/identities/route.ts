import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { Identity } from '@/lib/db/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { domain_id, email, daily_limit = 50 } = body

    if (!domain_id || !email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return NextResponse.json(
        { error: 'Invalid domain_id or email format' },
        { status: 400 }
      )
    }

    const result = await queryOne<Identity>(
      `INSERT INTO identities (domain_id, email, daily_limit)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [domain_id, email, daily_limit]
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error('[API] Error creating identity:', error)

    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Identity already exists for this domain' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const domain_id = searchParams.get('domain_id')

    if (!domain_id) {
      return NextResponse.json(
        { error: 'domain_id query parameter required' },
        { status: 400 }
      )
    }

    const results = await query<Identity>(
      `SELECT * FROM identities 
       WHERE domain_id = $1 
       ORDER BY created_at DESC`,
      [parseInt(domain_id)]
    )

    return NextResponse.json(results.rows)
  } catch (error) {
    console.error('[API] Error fetching identities:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
