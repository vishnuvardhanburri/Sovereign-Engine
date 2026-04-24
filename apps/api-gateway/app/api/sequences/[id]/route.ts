import { NextRequest, NextResponse } from 'next/server'
import { getSequence, updateSequence } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sequenceId = Number(id)
    if (!sequenceId) {
      return NextResponse.json({ error: 'Invalid sequence id' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const sequence = await getSequence(clientId, sequenceId)
    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })
    }

    return NextResponse.json(sequence)
  } catch (error) {
    console.error('[API] Failed to get sequence', error)
    return NextResponse.json({ error: 'Failed to get sequence' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sequenceId = Number(id)
    if (!sequenceId) {
      return NextResponse.json({ error: 'Invalid sequence id' }, { status: 400 })
    }

    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const sequence = await updateSequence(clientId, sequenceId, {
      name: String(body.name ?? ''),
      steps: Array.isArray(body.steps)
        ? body.steps.map((step: any) => ({
            day: Number(step.day ?? 0),
            touchLabel: step.touchLabel ? String(step.touchLabel) : undefined,
            variantKey: step.variantKey ? String(step.variantKey) : undefined,
            recipientStrategy: step.recipientStrategy,
            ccMode: step.ccMode,
            subject: String(step.subject ?? ''),
            body: String(step.body ?? ''),
          }))
        : [],
    })

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })
    }

    return NextResponse.json(sequence)
  } catch (error) {
    console.error('[API] Failed to update sequence', error)
    return NextResponse.json({ error: 'Failed to update sequence' }, { status: 500 })
  }
}
