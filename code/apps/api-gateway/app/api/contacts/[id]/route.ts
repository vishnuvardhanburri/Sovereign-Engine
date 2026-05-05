import { NextRequest, NextResponse } from 'next/server'
import { deleteContact } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const contactId = Number(id)
    if (!contactId) {
      return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const deleted = await deleteContact(clientId, contactId)
    if (!deleted) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Failed to delete contact', error)
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
  }
}
