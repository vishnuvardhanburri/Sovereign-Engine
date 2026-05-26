import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { getLicenseState, usageSummary } from '@/lib/licensing/enforcement'
import { listOperationalEvents, recordTelemetrySnapshot } from '@/lib/operational-events'
import { allAutonomousQueues } from '@/lib/queue/autonomous-queue-topology'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const [license, usage, ingestion, lanes, conversations, workflows, recentEvents, telemetry] =
      await Promise.all([
        getLicenseState(clientId),
        usageSummary(clientId),
        queryOne<{
          jobs_24h: string
          accepted_24h: string
          rejected_24h: string
          active_sources: string
        }>(
          `SELECT
             COUNT(DISTINCT ij.id) FILTER (WHERE ij.created_at >= now() - interval '24 hours')::text AS jobs_24h,
             COALESCE(SUM(ij.accepted_records) FILTER (WHERE ij.created_at >= now() - interval '24 hours'), 0)::text AS accepted_24h,
             COALESCE(SUM(ij.rejected_records) FILTER (WHERE ij.created_at >= now() - interval '24 hours'), 0)::text AS rejected_24h,
             (SELECT COUNT(*)::text FROM source_connections WHERE client_id = $1 AND status = 'active') AS active_sources
           FROM ingestion_jobs ij
           WHERE ij.client_id = $1`,
          [clientId]
        ),
        query(
          `SELECT provider,
                  lane,
                  status,
                  throttle_factor::text,
                  emergency_brake_active,
                  max_per_hour,
                  bounce_rate_24h::text,
                  failure_rate_24h::text,
                  reply_rate_7d::text
           FROM provider_lanes
           WHERE client_id = $1
           ORDER BY provider, lane`,
          [clientId]
        ),
        queryOne<{
          total: string
          interested: string
          negative: string
          licensing: string
        }>(
          `SELECT
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE classification IN ('interested','meeting_intent','partnership_intent','licensing_interest'))::text AS interested,
             COUNT(*) FILTER (WHERE classification IN ('not_interested','bounce'))::text AS negative,
             COUNT(*) FILTER (WHERE classification = 'licensing_interest')::text AS licensing
           FROM conversation_intelligence
           WHERE client_id = $1`,
          [clientId]
        ),
        queryOne<{ active: string; runs_24h: string; failed_24h: string }>(
          `SELECT
             (SELECT COUNT(*)::text FROM workflow_definitions WHERE client_id = $1 AND status = 'active') AS active,
             (SELECT COUNT(*)::text FROM workflow_runs WHERE client_id = $1 AND created_at >= now() - interval '24 hours') AS runs_24h,
             (SELECT COUNT(*)::text FROM workflow_runs WHERE client_id = $1 AND status = 'failed' AND created_at >= now() - interval '24 hours') AS failed_24h`,
          [clientId]
        ),
        listOperationalEvents({ clientId, limit: 25 }),
        query(
          `SELECT snapshot_type, metrics, created_at::text
           FROM telemetry_snapshots
           WHERE client_id = $1
           ORDER BY created_at DESC
           LIMIT 25`,
          [clientId]
        ),
      ])

    const response = {
      ok: true,
      clientId,
      generatedAt: new Date().toISOString(),
      license,
      usage,
      ingestion: ingestion ?? {
        jobs_24h: '0',
        accepted_24h: '0',
        rejected_24h: '0',
        active_sources: '0',
      },
      providerLanes: lanes.rows,
      conversations: conversations ?? {
        total: '0',
        interested: '0',
        negative: '0',
        licensing: '0',
      },
      workflows: workflows ?? {
        active: '0',
        runs_24h: '0',
        failed_24h: '0',
      },
      queues: allAutonomousQueues(),
      recentEvents,
      telemetry: telemetry.rows,
    }

    await recordTelemetrySnapshot({
      clientId,
      snapshotType: 'command_center_graph',
      metrics: {
        ingestion: response.ingestion,
        conversations: response.conversations,
        workflows: response.workflows,
        laneCount: lanes.rows.length,
      },
    })

    return NextResponse.json(response, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[API] command center graph failed', error)
    return NextResponse.json({ ok: false, error: 'failed to load command center graph' }, { status: 500 })
  }
}
