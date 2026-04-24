import { NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { query } from '@/lib/db'
import { runOptimizerOnce } from '@xavira/optimizer-engine'

export async function GET() {
  const clientId = 1
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return NextResponse.json({ error: 'REDIS_URL missing' }, { status: 500 })
  }

  const mode = (process.env.OPTIMIZER_MODE ?? 'observe') as 'observe' | 'apply'
  const redis = new IORedis(redisUrl)
  try {
    const state = await runOptimizerOnce({ db: query as any, redis, mode }, clientId)
    return NextResponse.json({ mode, ...state })
  } finally {
    await redis.quit()
  }
}
