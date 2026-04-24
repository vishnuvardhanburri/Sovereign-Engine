import { NextRequest, NextResponse } from 'next/server'
import { getDashboardStats } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    return NextResponse.json(await getDashboardStats(clientId))
  } catch (error) {
    console.error('[API] Failed to get dashboard stats', error)
    return NextResponse.json(
      { error: 'Failed to get dashboard stats' },
      { status: 500 }
    )
  }
}

