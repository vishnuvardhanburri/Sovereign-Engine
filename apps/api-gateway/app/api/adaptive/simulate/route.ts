import { NextResponse } from 'next/server'
import { computeAdaptiveThroughput, type AdaptiveState, type DomainSignals, type ProviderSignals } from '@sovereign/adaptive-controller'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      signals: DomainSignals | null
      provider?: ProviderSignals
      state?: AdaptiveState
      nowMs?: number
    }

    const { throughput, nextState } = computeAdaptiveThroughput(
      body.signals ?? null,
      body.provider,
      body.state,
      body.nowMs ?? Date.now()
    )

    return NextResponse.json({ ok: true, throughput, nextState })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 400 })
  }
}

