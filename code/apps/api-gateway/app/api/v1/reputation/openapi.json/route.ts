import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { publicReputationOpenApi } from '@/lib/public-reputation-openapi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  return NextResponse.json(publicReputationOpenApi(appEnv.appBaseUrl()))
}
