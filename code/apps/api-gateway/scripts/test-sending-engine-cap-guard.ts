import assert from 'node:assert/strict'
import { rotateInbox } from '@sovereign/sending-engine'

async function main() {
  const originalRecoveryMode = process.env.DAILY_OUTBOUND_RECOVERY_MODE
  const originalRecoveryCap = process.env.DOMAIN_RECOVERY_DAILY_CAP
  const originalRecoveryMinHealth = process.env.DOMAIN_RECOVERY_MIN_HEALTH
  const originalRecoveryMaxBounceRate = process.env.DOMAIN_RECOVERY_MAX_BOUNCE_RATE
  let capturedSql = ''
  let capturedParams: unknown[] | undefined

  delete process.env.DAILY_OUTBOUND_RECOVERY_MODE
  delete process.env.DOMAIN_RECOVERY_DAILY_CAP
  delete process.env.DOMAIN_RECOVERY_MIN_HEALTH
  delete process.env.DOMAIN_RECOVERY_MAX_BOUNCE_RATE

  await rotateInbox(
    {
      db: async (sql, params) => {
        capturedSql = sql
        capturedParams = params
        return { rows: [], rowCount: 0 }
      },
    },
    1,
    'normal'
  )

  assert.match(capturedSql, /d\.paused = FALSE/)
  assert.match(capturedSql, /i\.sent_today < i\.daily_limit/)
  assert.match(capturedSql, /d\.sent_today < COALESCE\(d\.daily_cap, d\.daily_limit\)/)
  assert.match(capturedSql, /COALESCE\(d\.daily_cap, d\.daily_limit\) > 0/)
  assert.doesNotMatch(capturedSql, /reputation recovery trickle/)
  assert.deepEqual(capturedParams, [1])

  process.env.DAILY_OUTBOUND_RECOVERY_MODE = 'true'
  process.env.DOMAIN_RECOVERY_DAILY_CAP = '2'
  process.env.DOMAIN_RECOVERY_MIN_HEALTH = '30'
  process.env.DOMAIN_RECOVERY_MAX_BOUNCE_RATE = '35'

  await rotateInbox(
    {
      db: async (sql, params) => {
        capturedSql = sql
        capturedParams = params
        return { rows: [], rowCount: 0 }
      },
    },
    1,
    'normal'
  )

  assert.match(capturedSql, /reputation recovery trickle/)
  assert.match(capturedSql, /COALESCE\(d\.daily_cap, d\.daily_limit\) BETWEEN 1 AND 2/)
  assert.match(capturedSql, /<= 35/)
  assert.deepEqual(capturedParams, [1])

  if (originalRecoveryMode === undefined) delete process.env.DAILY_OUTBOUND_RECOVERY_MODE
  else process.env.DAILY_OUTBOUND_RECOVERY_MODE = originalRecoveryMode
  if (originalRecoveryCap === undefined) delete process.env.DOMAIN_RECOVERY_DAILY_CAP
  else process.env.DOMAIN_RECOVERY_DAILY_CAP = originalRecoveryCap
  if (originalRecoveryMinHealth === undefined) delete process.env.DOMAIN_RECOVERY_MIN_HEALTH
  else process.env.DOMAIN_RECOVERY_MIN_HEALTH = originalRecoveryMinHealth
  if (originalRecoveryMaxBounceRate === undefined) delete process.env.DOMAIN_RECOVERY_MAX_BOUNCE_RATE
  else process.env.DOMAIN_RECOVERY_MAX_BOUNCE_RATE = originalRecoveryMaxBounceRate

  console.log('sending engine cap guard tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
