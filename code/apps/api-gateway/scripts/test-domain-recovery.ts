import assert from 'node:assert/strict'
import {
  buildDomainRecoveryActions,
  type DomainRecoverySignal,
} from '../lib/domain-recovery'

const healthyDomain: DomainRecoverySignal = {
  id: 1,
  domain: 'healthy.example',
  status: 'active',
  paused: false,
  sent_count: 120,
  bounce_count: 2,
  health_score: 96,
  bounce_rate: 1.67,
  daily_limit: 400,
  daily_cap: 100,
  sent_today: 4,
  spf_valid: true,
  dkim_valid: true,
  dmarc_valid: true,
}

const highBounceDomain: DomainRecoverySignal = {
  ...healthyDomain,
  id: 2,
  domain: 'burning.example',
  sent_count: 11,
  bounce_count: 3,
  health_score: 33,
  bounce_rate: 27.27,
}

const tinySampleDomain: DomainRecoverySignal = {
  ...healthyDomain,
  id: 3,
  domain: 'tiny-sample.example',
  sent_count: 1,
  bounce_count: 1,
  health_score: 45,
  bounce_rate: 100,
}

const alreadyPausedDomain: DomainRecoverySignal = {
  ...highBounceDomain,
  id: 4,
  domain: 'already-paused.example',
  status: 'paused',
  paused: true,
}

const lowHealthDomain: DomainRecoverySignal = {
  ...healthyDomain,
  id: 5,
  domain: 'low-health.example',
  sent_count: 10,
  bounce_count: 1,
  health_score: 24,
  bounce_rate: 10,
}

const actions = buildDomainRecoveryActions([
  healthyDomain,
  highBounceDomain,
  tinySampleDomain,
  alreadyPausedDomain,
  lowHealthDomain,
])

assert.deepEqual(
  actions.map((action) => action.domain),
  ['burning.example', 'low-health.example']
)

assert.equal(actions[0].reason, 'reputation_recovery_bounce_pressure')
assert.equal(actions[0].recommendedDailyCap, 0)
assert.equal(actions[0].cooldownHours, 24)
assert.equal(actions[0].metrics.rawBounceRatePct, 27.27)

assert.equal(actions[1].reason, 'reputation_recovery_low_health')
assert.equal(actions[1].metrics.healthScore, 24)

console.log('domain recovery tests passed')
