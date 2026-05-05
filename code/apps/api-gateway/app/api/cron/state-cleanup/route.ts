import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${appEnv.cronSecret()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const keepHours = Math.max(24, Math.min(48, Number(request.nextUrl.searchParams.get('keepHours') ?? 48)))
    const keepPerEntity = Math.max(10, Math.min(50, Number(request.nextUrl.searchParams.get('keepPerEntity') ?? 50)))

    // Time-window cleanup.
    const del1 = await query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM adaptive_state_snapshots
         WHERE created_at < (NOW() - ($1::int || ' hours')::interval)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [keepHours]
    ).catch(() => ({ rows: [{ count: '0' }], rowCount: 0 } as any))

    const del2 = await query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM provider_health_snapshots
         WHERE created_at < (NOW() - ($1::int || ' hours')::interval)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [keepHours]
    ).catch(() => ({ rows: [{ count: '0' }], rowCount: 0 } as any))

    // Per-entity cap cleanup.
    const cap1 = await query<{ count: string }>(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY client_id, domain_id ORDER BY created_at DESC) AS rn
         FROM adaptive_state_snapshots
       ),
       deleted AS (
         DELETE FROM adaptive_state_snapshots
         WHERE id IN (SELECT id FROM ranked WHERE rn > $1)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [keepPerEntity]
    ).catch(() => ({ rows: [{ count: '0' }], rowCount: 0 } as any))

    const cap2 = await query<{ count: string }>(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY client_id, provider ORDER BY created_at DESC) AS rn
         FROM provider_health_snapshots
       ),
       deleted AS (
         DELETE FROM provider_health_snapshots
         WHERE id IN (SELECT id FROM ranked WHERE rn > $1)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [keepPerEntity]
    ).catch(() => ({ rows: [{ count: '0' }], rowCount: 0 } as any))

    return NextResponse.json({
      ok: true,
      keepHours,
      keepPerEntity,
      deleted: {
        adaptive_time_window: Number(del1.rows[0]?.count ?? 0),
        provider_time_window: Number(del2.rows[0]?.count ?? 0),
        adaptive_cap: Number(cap1.rows[0]?.count ?? 0),
        provider_cap: Number(cap2.rows[0]?.count ?? 0),
      },
    })
  } catch (error) {
    console.error('[cron/state-cleanup] failed', error)
    return NextResponse.json({ error: 'Failed to cleanup state' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'state-cleanup' })
}

