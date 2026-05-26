import { NextRequest } from 'next/server'
import { listOperationalEvents } from '@/lib/operational-events'
import { collectOperationalTelemetry } from '@/lib/observability/autonomous-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(request: NextRequest) {
  const clientId = Number(request.nextUrl.searchParams.get('client_id') ?? 1)
  const intervalMs = Math.min(Math.max(Number(request.nextUrl.searchParams.get('interval_ms') ?? 5000), 2000), 30000)
  const encoder = new TextEncoder()
  let closed = false

  request.signal.addEventListener('abort', () => {
    closed = true
  })

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sse('connected', { ok: true, clientId, ts: new Date().toISOString() })))
      while (!closed) {
        try {
          const [telemetry, events] = await Promise.all([
            collectOperationalTelemetry(clientId),
            listOperationalEvents({ clientId, limit: 25 }),
          ])
          controller.enqueue(encoder.encode(sse('telemetry', telemetry)))
          controller.enqueue(encoder.encode(sse('activity', events)))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              sse('error', {
                message: error instanceof Error ? error.message : String(error),
                ts: new Date().toISOString(),
              })
            )
          )
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  })
}
