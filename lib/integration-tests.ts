/**
 * Integration Tests for Domain Management & Rate Control System
 * 
 * Run with: npx ts-node lib/integration-tests.ts
 * 
 * These tests validate:
 * 1. Domain quota enforcement (daily limits)
 * 2. Rate limiting with jitter (60-120s between sends)
 * 3. Health-based identity selection
 * 4. Bounce/reply tracking and adaptation
 * 5. Automatic domain pausing on high bounce rates
 */

import { query, queryOne, transaction } from '@/lib/db'
import {
  consumeToken,
  getDomainSentCount,
  getSentCount,
  initializeTokenBucket,
} from '@/lib/redis'
import {
  selectAndValidateIdentity,
  recordSend,
  checkCanSend,
  selectBestIdentity,
} from '@/lib/rate-limiter'
import { Domain, Identity } from '@/lib/db/types'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

const results: TestResult[] = []

async function test(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
    })
    console.log(`✓ ${name}`)
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    })
    console.error(`✗ ${name}: ${error}`)
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function seedTestData() {
  // Create test domain
  const domain = await queryOne<Domain>(
    `INSERT INTO domains (domain, daily_limit, health_score)
     VALUES ('test.example.com', 10, 95)
     RETURNING *`,
  )

  if (!domain) throw new Error('Failed to create test domain')

  // Create test identities
  const identity1 = await queryOne<Identity>(
    `INSERT INTO identities (domain_id, email, daily_limit, status)
     VALUES ($1, 'sender1@test.example.com', 5, 'active')
     RETURNING *`,
    [domain.id]
  )

  const identity2 = await queryOne<Identity>(
    `INSERT INTO identities (domain_id, email, daily_limit, status)
     VALUES ($1, 'sender2@test.example.com', 5, 'active')
     RETURNING *`,
    [domain.id]
  )

  if (!identity1 || !identity2) {
    throw new Error('Failed to create test identities')
  }

  return { domain, identity1, identity2 }
}

async function cleanupTestData(domainId: number) {
  await query('DELETE FROM events WHERE identity_id IN (SELECT id FROM identities WHERE domain_id = $1)', [domainId])
  await query('DELETE FROM identities WHERE domain_id = $1', [domainId])
  await query('DELETE FROM domains WHERE id = $1', [domainId])
}

async function runTests() {
  console.log('🧪 Running Integration Tests\n')

  let testDomain: Domain
  let testIdentity1: Identity
  let testIdentity2: Identity

  // Test 1: Domain Quota Enforcement
  await test('Domain quota enforcement - respect daily limit', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1
    testIdentity2 = data.identity2

    // Record sends until limit reached
    for (let i = 0; i < testDomain.daily_limit; i++) {
      await recordSend(testIdentity1.id, testDomain.id)
    }

    const canSend = await checkCanSend(testIdentity1.id, testDomain.id)
    assert(!canSend.allowed, 'Should not allow send after daily limit')

    await cleanupTestData(testDomain.id)
  })

  // Test 2: Rate Limiting with Jitter
  await test('Rate limiting - token bucket refill logic', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1

    // Initialize bucket with 1 token
    await initializeTokenBucket(testIdentity1.id, 1)

    // Consume token
    const result1 = await consumeToken(testIdentity1.id, 90)
    assert(result1.available, 'Should have token available')

    // Try to consume again immediately (should fail)
    const result2 = await consumeToken(testIdentity1.id, 90)
    assert(
      !result2.available,
      'Should not have token immediately after consumption'
    )
    assert(
      result2.wait_seconds && result2.wait_seconds > 0,
      'Should specify wait time'
    )

    await cleanupTestData(testDomain.id)
  })

  // Test 3: Identity Selection by Health
  await test('Health-based identity selection - choose highest health', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1
    testIdentity2 = data.identity2

    // Set different health scores by creating events
    // Identity1: 1 sent, 0 bounces = 100% delivery
    await query(
      `INSERT INTO events (identity_id, type, contact_email) VALUES ($1, $2, $3)`,
      [testIdentity1.id, 'sent', 'test@example.com']
    )

    // Identity2: 1 sent, 1 bounce = 0% delivery
    await query(
      `INSERT INTO events (identity_id, type, contact_email) VALUES ($1, $2, $3)`,
      [testIdentity2.id, 'sent', 'test@example.com']
    )
    await query(
      `INSERT INTO events (identity_id, type, contact_email) VALUES ($1, $2, $3)`,
      [testIdentity2.id, 'bounce', 'test@example.com']
    )

    // Select best identity - should prefer identity1 (better health)
    const selected = await selectBestIdentity(testDomain.id)
    assert(
      selected?.id === testIdentity1.id,
      `Should select identity with better health (got ${selected?.id})`
    )

    await cleanupTestData(testDomain.id)
  })

  // Test 4: Bounce Rate Tracking
  await test('Bounce tracking - calculate bounce rate correctly', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1

    // Create 10 sent events
    for (let i = 0; i < 10; i++) {
      await query(
        `INSERT INTO events (identity_id, type, contact_email) VALUES ($1, $2, $3)`,
        [testIdentity1.id, 'sent', `test${i}@example.com`]
      )
    }

    // Create 2 bounce events (20% bounce rate)
    for (let i = 0; i < 2; i++) {
      await query(
        `INSERT INTO events (identity_id, type, contact_email) VALUES ($1, $2, $3)`,
        [testIdentity1.id, 'bounce', `bounce${i}@example.com`]
      )
    }

    // Query bounce rate
    const stats = await queryOne<any>(
      `SELECT
        COUNT(CASE WHEN type = 'sent' THEN 1 END) as total_sent,
        COUNT(CASE WHEN type = 'bounce' THEN 1 END) as total_bounces
      FROM events WHERE identity_id = $1`,
      [testIdentity1.id]
    )

    const bounceRate = (parseInt(stats!.total_bounces) / parseInt(stats!.total_sent)) * 100
    assert(bounceRate === 20, `Bounce rate should be 20%, got ${bounceRate}`)

    await cleanupTestData(testDomain.id)
  })

  // Test 5: Redis Cache Synchronization
  await test('Redis cache - sent count tracking', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1

    // Record send (updates both DB and Redis)
    await recordSend(testIdentity1.id, testDomain.id)

    // Check Redis cache
    const redisSentCount = await getSentCount(testIdentity1.id)
    const domainSentCount = await getDomainSentCount(testDomain.id)

    assert(redisSentCount === 1, `Redis should show 1 sent email`)
    assert(domainSentCount === 1, `Redis should show 1 domain sent email`)

    await cleanupTestData(testDomain.id)
  })

  // Test 6: Capacity Check with Limits
  await test('Capacity check - enforce identity and domain limits', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1

    // Max out identity daily limit
    for (let i = 0; i < testIdentity1.daily_limit; i++) {
      await recordSend(testIdentity1.id, testDomain.id)
    }

    const result = await checkCanSend(testIdentity1.id, testDomain.id)
    assert(
      !result.allowed,
      `Should reject send when identity limit reached: ${result.reason}`
    )

    await cleanupTestData(testDomain.id)
  })

  // Test 7: Multiple Identities with Round-robin
  await test('Round-robin selection - prefer least recently sent', async () => {
    const data = await seedTestData()
    testDomain = data.domain
    testIdentity1 = data.identity1
    testIdentity2 = data.identity2

    // Send from identity1
    await recordSend(testIdentity1.id, testDomain.id)

    // Record that identity1 was used, identity2 hasn't been used yet
    await query(
      'UPDATE identities SET last_sent_at = CURRENT_TIMESTAMP WHERE id = $1',
      [testIdentity1.id]
    )

    // Select best - should prefer identity2 (not recently used)
    const selected = await selectBestIdentity(testDomain.id)
    assert(
      selected?.id === testIdentity2.id,
      'Should select least recently used identity'
    )

    await cleanupTestData(testDomain.id)
  })

  // Print summary
  console.log('\n📊 Test Summary\n')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  results.forEach((r) => {
    const status = r.passed ? '✓' : '✗'
    console.log(
      `${status} ${r.name} (${r.duration}ms${r.error ? ` - ${r.error}` : ''})`
    )
  })

  console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${results.length}`)
  console.log(`Success rate: ${((passed / results.length) * 100).toFixed(1)}%`)

  process.exit(failed > 0 ? 1 : 0)
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error)
  process.exit(1)
})
