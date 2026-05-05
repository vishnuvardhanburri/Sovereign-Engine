import { NextRequest, NextResponse } from 'next/server'
import { getReply, updateReplyStatus } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const replyId = Number(id)
    if (!replyId) {
      return NextResponse.json({ error: 'Invalid reply id' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const reply = await getReply(clientId, replyId)
    if (!reply) {
      return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
    }

    return NextResponse.json(reply)
  } catch (error) {
    console.error('[API] Failed to get reply', error)
    return NextResponse.json({ error: 'Failed to get reply' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const replyId = Number(id)
    if (!replyId) {
      return NextResponse.json({ error: 'Invalid reply id' }, { status: 400 })
    }

    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const updated = await updateReplyStatus(clientId, replyId, body.status)
    if (!updated) {
      return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[API] Failed to update reply', error)
    return NextResponse.json({ error: 'Failed to update reply' }, { status: 500 })
  }
}
