import assert from 'node:assert/strict'
import { rotateInbox } from '@sovereign/sending-engine'

async function main() {
  let capturedSql = ''
  let capturedParams: unknown[] | undefined

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
  assert.deepEqual(capturedParams, [1])

  console.log('sending engine cap guard tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
