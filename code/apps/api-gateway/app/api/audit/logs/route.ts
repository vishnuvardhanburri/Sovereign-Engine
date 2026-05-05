import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { getLatestAuditChainAnchor, verifyAuditChain } from '@/lib/security/audit-log'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const limit = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 100), 500))
    const [logs, chain, latestAnchor] = await Promise.all([
      query(
        `SELECT
           id,
           actor_id,
           actor_type,
           action_type,
           resource_type,
           resource_id,
           ip_address,
           user_agent,
           request_id,
           service_name,
           previous_hash,
           entry_hash,
           hash_version,
           chain_hash_algorithm,
           timestamp_utc,
           details
         FROM audit_logs
         WHERE client_id = $1 OR client_id IS NULL
         ORDER BY timestamp_utc DESC NULLS LAST, timestamp DESC NULLS LAST
         LIMIT $2`,
        [clientId, limit]
      ),
      verifyAuditChain(1_000),
      getLatestAuditChainAnchor(),
    ])

    return NextResponse.json({
      ok: true,
      clientId,
      chain,
      latestAnchor,
      logs: logs.rows,
    })
  } catch (error) {
    console.error('[api/audit/logs] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
