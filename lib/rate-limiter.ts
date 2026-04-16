import { query, queryOne } from '@/lib/db'
import { getRandomSendDelaySeconds, recalculateDomainHealth, selectBestIdentity } from '@/lib/backend'
import { Domain, Identity } from '@/lib/db/types'

export interface RateLimitResult {
  allowed: boolean
  reason?: string
  wait_seconds?: number
  identity_id?: number
  domain_id?: number
}

export async function checkCanSend(
  identityId: number,
  domainId: number
): Promise<RateLimitResult> {
  const identity = await queryOne<Identity>(
    `SELECT *
     FROM identities
     WHERE id = $1`,
    [identityId]
  )
  const domain = await queryOne<Domain>(
    `SELECT *
     FROM domains
     WHERE id = $1`,
    [domainId]
  )

  if (!identity || !domain) {
    return { allowed: false, reason: 'identity or domain missing' }
  }

  if (identity.status !== 'active' || domain.status !== 'active') {
    return { allowed: false, reason: 'identity or domain inactive' }
  }

  if (identity.sent_today >= identity.daily_limit) {
    return { allowed: false, reason: 'identity daily limit reached' }
  }

  if (domain.sent_today >= domain.daily_limit) {
    return { allowed: false, reason: 'domain daily limit reached' }
  }

  if (identity.last_sent_at) {
    const waitSeconds = getRandomSendDelaySeconds()
    const nextAllowedAt =
      new Date(identity.last_sent_at).getTime() + waitSeconds * 1000

    if (nextAllowedAt > Date.now()) {
      return {
        allowed: false,
        reason: 'identity cooling down',
        wait_seconds: Math.ceil((nextAllowedAt - Date.now()) / 1000),
      }
    }
  }

  return {
    allowed: true,
    identity_id: identityId,
    domain_id: domainId,
  }
}

export async function recordSend(identityId: number, domainId: number) {
  await Promise.all([
    query(
      `UPDATE identities
       SET sent_today = sent_today + 1,
           sent_count = sent_count + 1,
           last_sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [identityId]
    ),
    query(
      `UPDATE domains
       SET sent_today = sent_today + 1,
           sent_count = sent_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [domainId]
    ),
  ])

  const domain = await queryOne<Domain>('SELECT * FROM domains WHERE id = $1', [domainId])
  if (domain) {
    await recalculateDomainHealth(domain.client_id, domain.id)
  }
}

export async function selectAndValidateIdentity(clientId: number) {
  const selection = await selectBestIdentity(clientId)
  if (!selection) {
    return null
  }

  const canSend = await checkCanSend(selection.identity.id, selection.domain.id)
  if (!canSend.allowed) {
    return null
  }

  return selection.identity
}

export async function resetDailyCounters() {
  await Promise.all([
    query(
      `UPDATE identities
       SET sent_today = 0,
           last_reset_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`
    ),
    query(
      `UPDATE domains
       SET sent_today = 0,
           last_reset_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`
    ),
  ])
}

export async function scaleDomainLimits() {
  const domains = await query<Domain>('SELECT * FROM domains')

  for (const domain of domains.rows) {
    const identityCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM identities
       WHERE domain_id = $1 AND status = 'active'`,
      [domain.id]
    )

    const activeIdentities = Math.max(Number(identityCount?.count ?? 0), 1)
    const perIdentityLimit =
      domain.health_score >= 90 ? 400 : domain.health_score >= 75 ? 300 : 200

    await query(
      `UPDATE domains
       SET daily_limit = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [domain.id, activeIdentities * perIdentityLimit]
    )
  }
}

