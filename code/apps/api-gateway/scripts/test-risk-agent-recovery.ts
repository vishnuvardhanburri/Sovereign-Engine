import assert from 'node:assert/strict'
import { shouldEnableRecoveryTrickle } from '../lib/agents/data/risk-agent'

const baseDomain = {
  id: 1,
  client_id: 1,
  domain: 'vishnuvardhanburri.in',
  status: 'paused',
  paused: false,
  sent_count: 11,
  bounce_count: 3,
  health_score: 33,
  bounce_rate: 27.27,
  daily_limit: 20,
  daily_cap: 0,
}

const recoveryOptions = {
  enabled: true,
  cap: 1,
  minHealth: 30,
  maxBounceRate: 35,
}

assert.equal(
  shouldEnableRecoveryTrickle(baseDomain as never, recoveryOptions),
  true,
  'paused-but-not-manually-paused domains inside recovery thresholds should get a tiny verified cap'
)

assert.equal(
  shouldEnableRecoveryTrickle(
    { ...baseDomain, domain: 'vishnulabs.com', health_score: 16 } as never,
    recoveryOptions
  ),
  false,
  'low-health domains must stay blocked even in recovery mode'
)

assert.equal(
  shouldEnableRecoveryTrickle({ ...baseDomain, paused: true } as never, recoveryOptions),
  false,
  'manual operator pause must override recovery mode'
)

assert.equal(
  shouldEnableRecoveryTrickle({ ...baseDomain, daily_cap: 5 } as never, recoveryOptions),
  false,
  'domains that already have capacity do not need recovery override'
)

console.log('risk agent recovery tests passed')
