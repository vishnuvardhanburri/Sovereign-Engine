import type { ValidationResult } from './types'
import { normalizeEmail, isRoleAddress } from './normalize'
import { resolveMx } from './dns-mx'
import { smtpVerifyRcpt } from './smtp-probe'
import { detectCatchAll } from './catchall'
import { scoreEmail } from './scoring'
import { cacheKeys } from './cache'
import { validatorEnv } from './config'
import type Redis from 'ioredis'
import type { Queue } from 'bullmq'
import { loadLists } from './lists'
import { updateDomainReputation, shouldSkipSmtp, getDomainReputation } from './reputation'
import { isBreakerOpen, recordDomainFailure, recordDomainSuccess } from './circuit-breaker'
import { withDomainSmtpSlot } from './slots'
import { getCachedDomainAuth } from './dmarc'

const MX_TTL_SECONDS = 6 * 60 * 60
const CATCHALL_TTL_SECONDS = 24 * 60 * 60

export async function validateOne(input: { email: string; redis: Redis; domainQueue?: Queue }): Promise<ValidationResult> {
  const startedAt = Date.now()
  const budgetMs = validatorEnv.pipelineTimeoutMs()

  const bumpMetric = async (field: string, inc = 1) => {
    await input.redis.hincrby(cacheKeys.metrics(), field, inc)
    await input.redis.expire(cacheKeys.metrics(), 30 * 24 * 60 * 60)
  }

  const norm = normalizeEmail(input.email)
  if (!norm.ok) {
    await bumpMetric('total_validations', 1)
    return {
      email: input.email,
      normalizedEmail: '',
      verdict: 'invalid',
      score: 0,
      reasons: [`syntax:${norm.reason}`],
      mx: { ok: false, reason: 'dns_error' },
      smtp: null,
      catchAll: null,
      meta: { durationMs: Date.now() - startedAt, domain: '', localPart: '' },
    }
  }

  const { email, local, domain } = norm
  await bumpMetric('total_validations', 1)

  // Disposable early exit (before DNS/MX).
  const lists = await loadLists(input.redis)
  if (lists.disposableDomains.has(domain)) {
    await bumpMetric('disposable_filtered', 1)
    return {
      email: input.email,
      normalizedEmail: email,
      verdict: 'invalid',
      score: 0,
      reasons: ['disposable_domain'],
      mx: { ok: false, reason: 'no_mx' },
      smtp: null,
      catchAll: null,
      meta: { durationMs: Date.now() - startedAt, domain, localPart: local },
    }
  }

  const isRole = isRoleAddress(local)

  // MX cache
  const mxCacheKey = cacheKeys.mx(domain)
  const mxCached = await input.redis.get(mxCacheKey)
  const mx = mxCached ? (JSON.parse(mxCached) as any) : await resolveMx(domain)
  if (!mxCached) {
    await input.redis.set(mxCacheKey, JSON.stringify(mx), 'EX', MX_TTL_SECONDS)
  }

  const elapsed = () => Date.now() - startedAt
  const remaining = () => Math.max(0, budgetMs - elapsed())

  // Circuit breaker / reputation based skips (protect infra first).
  if (await isBreakerOpen(input.redis, domain)) {
    return {
      email: input.email,
      normalizedEmail: email,
      verdict: 'unknown',
      score: 0.2,
      reasons: ['domain_breaker_open'],
      mx,
      smtp: null,
      catchAll: null,
      meta: { durationMs: elapsed(), domain, localPart: local },
    }
  }

  const repSkip = await shouldSkipSmtp(input.redis, domain)
  const shouldAttemptSmtp = !repSkip.skip

  let smtp: any = null
  let usedMxHost: string | undefined
  if (shouldAttemptSmtp && mx.ok && mx.mxHosts.length && remaining() >= 1500) {
    usedMxHost = mx.mxHosts[0].host
    try {
      smtp = await withDomainSmtpSlot(input.redis, domain, async () =>
        smtpVerifyRcpt({
          mxHost: usedMxHost!,
          port: validatorEnv.smtpPort(),
          timeoutMs: Math.min(validatorEnv.smtpTimeoutMs(), remaining()),
          heloName: validatorEnv.heloName(),
          fromEmail: validatorEnv.fromEmail(),
          toEmail: email,
        })
      )
    } catch (err: any) {
      if (err?.code === 'DOMAIN_BUSY') {
        // Overflow: let the queue retry later.
        const e: any = new Error('domain_busy_retry')
        e.code = 'DOMAIN_BUSY'
        throw e
      }
      smtp = { kind: 'soft_fail', message: err?.message ?? String(err) }
    }
  }

  // Catch-all cache
  let catchAll: any = null
  if (smtp?.kind === 'deliverable' && mx.ok && mx.mxHosts.length && remaining() >= 1500) {
    const ck = cacheKeys.catchAll(domain)
    const cached = await input.redis.get(ck)
    if (cached) {
      catchAll = JSON.parse(cached)
    } else {
      catchAll = await withDomainSmtpSlot(input.redis, domain, async () =>
        detectCatchAll({
          domain,
          mx,
          port: validatorEnv.smtpPort(),
          timeoutMs: Math.min(validatorEnv.smtpTimeoutMs(), remaining()),
          heloName: validatorEnv.heloName(),
          fromEmail: validatorEnv.fromEmail(),
        })
      )
      await input.redis.set(ck, JSON.stringify(catchAll), 'EX', CATCHALL_TTL_SECONDS)
    }
  }

  // Update reputation + breaker inputs
  await updateDomainReputation(input.redis, domain, { smtp, catchAll })
  if (smtp?.kind === 'deliverable') {
    await bumpMetric('smtp_success', 1)
    await recordDomainSuccess(input.redis, domain)
  } else if (smtp) {
    await bumpMetric('smtp_failures', 1)
    await recordDomainFailure(input.redis, domain)
  }
  if (catchAll?.ok) {
    await bumpMetric('catch_all_total', 1)
    if (catchAll.isCatchAll) await bumpMetric('catch_all_true', 1)
  }

  // Dynamic scoring adjustments from reputation + cached DMARC/SPF
  const rep = await getDomainReputation(input.redis, domain)
  const base = scoreEmail({ local, domain, mx, smtp, catchAll })
  let score = base.score
  const reasons = [...base.reasons]

  if (rep.total_checks >= 20) {
    if (rep.domain_score < 0.2) {
      score = Math.max(0, score - 0.15)
      reasons.push('domain_rep_low')
    } else if (rep.domain_score > 0.8) {
      score = Math.min(1, score + 0.05)
      reasons.push('domain_rep_high')
    }
  }

  const auth = await getCachedDomainAuth(input.redis, domain)
  if (auth) {
    if (!auth.spf.present) {
      score = Math.max(0, score - 0.1)
      reasons.push('spf_missing')
    }
    if (!auth.dmarc.present) {
      score = Math.max(0, score - 0.1)
      reasons.push('dmarc_missing')
    }
    if (auth.dmarc.present && (auth.dmarc.policy === 'reject' || auth.dmarc.policy === 'quarantine')) {
      score = Math.min(1, score + 0.05)
      reasons.push('dmarc_strong')
    }
  }

  score = Number(score.toFixed(2))
  let verdict = base.verdict

  // Role rule: never reject, but mark risky.
  if (isRole && verdict === 'valid') verdict = 'risky'
  if (isRole) reasons.push('role_address')

  // If we skipped SMTP due to rep or breaker, keep verdict unknown.
  if (!shouldAttemptSmtp && verdict !== 'invalid') {
    verdict = 'unknown'
    reasons.push('smtp_skipped_reputation')
  }

  // Async domain auth enrichment (non-blocking, cached 24h)
  if (input.domainQueue && !auth) {
    try {
      await input.domainQueue.add('auth', { domain }, { jobId: `auth:${domain}`, removeOnComplete: 1000, removeOnFail: 5000 })
    } catch {}
  }

  return {
    email: input.email,
    normalizedEmail: email,
    verdict,
    score,
    reasons,
    mx,
    smtp,
    catchAll,
    meta: {
      durationMs: elapsed(),
      domain,
      localPart: local,
      usedMxHost,
    },
  }
}
