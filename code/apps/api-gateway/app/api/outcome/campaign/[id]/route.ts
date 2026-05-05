import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { getOutcomeCampaignAdapter } from '@/adapters/outcome'

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const clientId = claims.client_id
  const { id } = await ctx.params
  const campaignId = Number(id)
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'invalid_campaign_id' }, { status: 400 })
  }

  const result = await getOutcomeCampaignAdapter({ clientId, campaignId })
  return NextResponse.json(result)
}
