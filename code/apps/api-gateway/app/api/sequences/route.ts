import { NextRequest, NextResponse } from 'next/server'
import { createSequence, listSequences } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

type SequenceStepInput = {
  day?: number
  touchLabel?: string
  variantKey?: string
  recipientStrategy?: 'primary' | 'cxo' | 'generic' | 'fallback'
  ccMode?: 'none' | 'manager' | 'team'
  subject?: string
  body?: string
}

type CreateSequenceBody = {
  name?: string
  steps?: SequenceStepInput[]
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    return NextResponse.json(await listSequences(clientId))
  } catch (error) {
    console.error('[API] Failed to list sequences', error)
    return NextResponse.json({ error: 'Failed to list sequences' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateSequenceBody
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
      return NextResponse.json(
        { error: 'name and at least one step are required' },
        { status: 400 }
      )
    }

    const sequence = await createSequence(clientId, {
      name: String(body.name),
      steps: body.steps.map((step: SequenceStepInput) => ({
        day: Number(step.day ?? 0),
        touchLabel: step.touchLabel ? String(step.touchLabel) : undefined,
        variantKey: step.variantKey ? String(step.variantKey) : undefined,
        recipientStrategy: step.recipientStrategy,
        ccMode: step.ccMode,
        subject: String(step.subject ?? ''),
        body: String(step.body ?? ''),
      })),
    })

    return NextResponse.json(sequence, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create sequence', error)
    return NextResponse.json({ error: 'Failed to create sequence' }, { status: 500 })
  }
}
