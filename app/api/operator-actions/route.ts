import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { query } from '@/lib/db'

type OperatorActionRow = {
  id: string
  action_type: string
  summary: string
  payload: Record<string, unknown> | null
  created_at: string
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const limit = Math.min(Number(searchParams.get('limit') ?? 50) || 50, 200)

    const rows = await query<OperatorActionRow>(
      `
      SELECT
        id::text AS id,
        action_type,
        summary,
        payload,
        created_at::text AS created_at
      FROM operator_actions
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [clientId, limit]
    )

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      data: rows.rows,
    })
  } catch (error) {
    console.error('[API] Failed to list operator actions', error)
    return NextResponse.json({ error: 'Failed to list operator actions' }, { status: 500 })
  }
}

