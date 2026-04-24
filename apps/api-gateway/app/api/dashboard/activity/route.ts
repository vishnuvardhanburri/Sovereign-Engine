import { NextRequest, NextResponse } from 'next/server'
import { getActivityFeed } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    return NextResponse.json(await getActivityFeed(clientId))
  } catch (error) {
    console.error('[API] Failed to get activity feed', error)
    return NextResponse.json(
      { error: 'Failed to get activity feed' },
      { status: 500 }
    )
  }
}

