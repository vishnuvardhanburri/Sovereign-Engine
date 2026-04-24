import { NextRequest, NextResponse } from 'next/server'
import { unsubscribeContactFromToken } from '@/lib/backend'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const contact = await unsubscribeContactFromToken(token)

    if (!contact) {
      return new NextResponse('Not found', { status: 404 })
    }

    return new NextResponse(
      'You have been unsubscribed from future outreach from Xavira Orbit.',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      }
    )
  } catch (error) {
    console.error('[API] Failed to unsubscribe contact', error)
    return new NextResponse('Invalid unsubscribe link', { status: 400 })
  }
}
