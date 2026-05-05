import { NextRequest, NextResponse } from 'next/server'
import { listReplies } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const page = Number(searchParams.get('page') ?? 1)
    const limit = Number(searchParams.get('limit') ?? 50)

    return NextResponse.json(await listReplies(clientId, { page, limit }))
  } catch (error) {
    console.error('[API] Failed to list replies', error)
    return NextResponse.json({ error: 'Failed to list replies' }, { status: 500 })
  }
}

