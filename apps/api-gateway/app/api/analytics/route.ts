import { NextRequest, NextResponse } from 'next/server'
import { getAnalytics } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    return NextResponse.json(await getAnalytics(clientId))
  } catch (error) {
    console.error('[API] Failed to get analytics', error)
    return NextResponse.json({ error: 'Failed to get analytics' }, { status: 500 })
  }
}

