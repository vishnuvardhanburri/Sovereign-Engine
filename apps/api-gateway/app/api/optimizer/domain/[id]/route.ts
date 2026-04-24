import { NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { query } from '@/lib/db'
import { computeDomainMetrics, analyze, adjust } from '@xavira/optimizer-engine'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const clientId = 1
  const domainId = Number(params.id)
  if (!Number.isFinite(domainId)) {
    return NextResponse.json({ error: 'invalid domain id' }, { status: 400 })
  }
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return NextResponse.json({ error: 'REDIS_URL missing' }, { status: 500 })
  }

  const redis = new IORedis(redisUrl)
  try {
    const metrics = await computeDomainMetrics(query as any, clientId, domainId)
    if (!metrics) return NextResponse.json({ error: 'domain not found' }, { status: 404 })
    const analysis = analyze(metrics)
    const recommended = adjust(analysis)
    return NextResponse.json({ domainId, metrics, analysis, recommended })
  } finally {
    await redis.quit()
  }
}
