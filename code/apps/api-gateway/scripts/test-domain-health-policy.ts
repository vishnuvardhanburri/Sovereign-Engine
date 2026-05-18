import assert from 'node:assert/strict'
import { calculateDomainHealthPolicy } from '@sovereign/reputation-engine'

const oneBounceTinySample = calculateDomainHealthPolicy({
  sentCount: 8,
  bounceCount: 1,
  currentStatus: 'active',
})

assert.equal(oneBounceTinySample.rawBounceRate, 12.5)
assert.equal(oneBounceTinySample.shouldPause, false)
assert.equal(oneBounceTinySample.nextStatus, 'active')
assert.ok(
  oneBounceTinySample.healthScore >= 70,
  `tiny samples should slow down, not brick the domain; got ${oneBounceTinySample.healthScore}`
)

const provenHighBounce = calculateDomainHealthPolicy({
  sentCount: 40,
  bounceCount: 4,
  currentStatus: 'active',
})

assert.equal(provenHighBounce.rawBounceRate, 10)
assert.equal(provenHighBounce.shouldPause, true)
assert.equal(provenHighBounce.nextStatus, 'paused')

console.log('domain health policy ok')
