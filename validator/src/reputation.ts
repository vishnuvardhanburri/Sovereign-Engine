import type Redis from 'ioredis'
import { cacheKeys } from './cache'
import type { CatchAllResult, SmtpClassification } from './types'

export type DomainReputation = {
  total_checks: number
  smtp_success: number
  smtp_failures: number
  catch_all_true: number
  catch_all_total: number
  domain_score: number
  catch_all_rate: number
}

export async function getDomainReputation(redis: Redis, domain: string): Promise<DomainReputation> {
  const key = cacheKeys.domainReputation(domain)
  const raw = await redis.hgetall(key)
  const total_checks = Number(raw.total_checks ?? 0)
  const smtp_success = Number(raw.smtp_success ?? 0)
  const smtp_failures = Number(raw.smtp_failures ?? 0)
  const catch_all_true = Number(raw.catch_all_true ?? 0)
  const catch_all_total = Number(raw.catch_all_total ?? 0)

  const domain_score = total_checks > 0 ? smtp_success / total_checks : 0
  const catch_all_rate = catch_all_total > 0 ? catch_all_true / catch_all_total : 0

  return {
    total_checks,
    smtp_success,
    smtp_failures,
    catch_all_true,
    catch_all_total,
    domain_score,
    catch_all_rate,
  }
}

export async function updateDomainReputation(redis: Redis, domain: string, input: { smtp?: SmtpClassification | null; catchAll?: CatchAllResult | null }): Promise<void> {
  const key = cacheKeys.domainReputation(domain)

  const multi = redis.multi()
  multi.hincrby(key, 'total_checks', 1)

  if (input.smtp) {
    if (input.smtp.kind === 'deliverable') multi.hincrby(key, 'smtp_success', 1)
    if (input.smtp.kind === 'undeliverable' || input.smtp.kind === 'soft_fail' || input.smtp.kind === 'timeout') {
      multi.hincrby(key, 'smtp_failures', 1)
    }
  }

  if (input.catchAll?.ok) {
    multi.hincrby(key, 'catch_all_total', 1)
    if (input.catchAll.isCatchAll) multi.hincrby(key, 'catch_all_true', 1)
  }

  // Keep around for 30 days.
  multi.expire(key, 30 * 24 * 60 * 60)
  await multi.exec()
}

export async function shouldSkipSmtp(redis: Redis, domain: string): Promise<{ skip: boolean; reason?: string }> {
  const rep = await getDomainReputation(redis, domain)
  if (rep.total_checks >= 50 && rep.domain_score < 0.1) {
    return { skip: true, reason: 'domain_reputation_low' }
  }
  return { skip: false }
}

