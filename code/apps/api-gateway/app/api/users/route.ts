import { NextRequest, NextResponse } from 'next/server'
import { createClientMember, listClientMembers } from '@/lib/backend'
import { resolveAccessContext } from '@/lib/authz'

export async function GET(request: NextRequest) {
  try {
    const access = await resolveAccessContext({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const members = await listClientMembers(access.clientId)
    return NextResponse.json(members)
  } catch (error) {
    console.error('[API] Failed to list users', error)
    const message = error instanceof Error ? error.message : 'Failed to list users'
    const status =
      message.includes('permission') || message.includes('assigned') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const access = await resolveAccessContext(
      {
        body,
        headers: request.headers,
      },
      'admin'
    )

    if (!body.email || !body.role) {
      return NextResponse.json(
        { error: 'email and role are required' },
        { status: 400 }
      )
    }

    const member = await createClientMember({
      clientId: access.clientId,
      email: String(body.email),
      name: body.name ? String(body.name) : null,
      role: body.role,
    })

    return NextResponse.json(member, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create user', error)
    const message = error instanceof Error ? error.message : 'Failed to create user'
    const status =
      message.includes('permission') || message.includes('assigned') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
