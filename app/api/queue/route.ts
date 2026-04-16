import { NextRequest, NextResponse } from 'next/server'
import {
  enqueueCampaignJobs,
  listQueueJobs,
  promoteReadyQueueJobs,
} from '@/lib/backend'
import { peekQueue } from '@/lib/redis'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const action = searchParams.get('action')

    if (action === 'peek') {
      const jobs = await peekQueue(Number(searchParams.get('count') ?? 10))
      return NextResponse.json({ jobs, count: jobs.length })
    }

    if (action === 'promote') {
      const promoted = await promoteReadyQueueJobs()
      return NextResponse.json({ promoted })
    }

    const jobs = await listQueueJobs(clientId, {
      page: Number(searchParams.get('page') ?? 1),
      limit: Number(searchParams.get('limit') ?? 50),
      status: (searchParams.get('status') as any) ?? undefined,
    })

    return NextResponse.json(jobs)
  } catch (error) {
    console.error('[API] Failed to list queue jobs', error)
    return NextResponse.json({ error: 'Failed to list queue jobs' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.campaign_id) {
      return NextResponse.json(
        { error: 'campaign_id is required' },
        { status: 400 }
      )
    }

    const result = await enqueueCampaignJobs(
      clientId,
      Number(body.campaign_id),
      Array.isArray(body.contact_ids)
        ? body.contact_ids.map((value: unknown) => Number(value)).filter(Boolean)
        : undefined
    )

    return NextResponse.json({
      queued_jobs: result.jobs.length,
      contact_count: result.contactCount,
    })
  } catch (error) {
    console.error('[API] Failed to enqueue campaign', error)
    return NextResponse.json({ error: 'Failed to enqueue campaign' }, { status: 500 })
  }
}

