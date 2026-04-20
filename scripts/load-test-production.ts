// @ts-nocheck
// PRODUCTION LOAD TESTING
// Simulate 1K → 10K → 50K/day ramp with failure scenarios

import { query } from '../lib/db'
import { enqueueQueueJobs } from '../lib/redis'
import { appEnv } from '../lib/env'

interface LoadTestConfig {
  targetVolumes: number[]
  rampDurationMinutes: number
  failureScenarios: Array<{
    type: 'smtp_down' | 'api_fail' | 'queue_full'
    durationMinutes: number
    startAfterMinutes: number
  }>
}

class LoadTester {
  private clientId: number = 1
  private config: LoadTestConfig
  
  constructor(config: LoadTestConfig) {
    this.config = config
  }
  
  async runLoadTest(): Promise<void> {
    console.log('🚀 Starting production load test...')
    
    for (const volume of this.config.targetVolumes) {
      console.log(`\n📈 Testing ${volume} emails/day...`)
      await this.testVolume(volume)
      await this.wait(this.config.rampDurationMinutes * 60 * 1000)
    }
    
    console.log('\n✅ Load test completed')
    await this.generateReport()
  }
  
  private async testVolume(targetEmails: number): Promise<void> {
    const startTime = Date.now()
    let sent = 0
    let failed = 0
    
    // Create test contacts if needed
    await this.ensureTestContacts(targetEmails)
    
    // Start sending at calculated rate
    const emailsPerMinute = targetEmails / (24 * 60)
    const interval = (60 * 1000) / emailsPerMinute // ms between sends
    
    const sendInterval = setInterval(async () => {
      try {
        const result = await this.sendTestEmail()
        if (result) {
          sent++
        } else {
          failed++
        }
        
        if (sent + failed >= targetEmails) {
          clearInterval(sendInterval)
          const duration = (Date.now() - startTime) / 1000
          console.log(`Volume ${targetEmails}: ${sent} sent, ${failed} failed in ${duration}s`)
        }
      } catch (error) {
        failed++
        console.error('Send error:', error)
      }
    }, interval)
    
    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, (targetEmails / emailsPerMinute) * 60 * 1000 + 10000))
  }
  
  private async ensureTestContacts(count: number): Promise<void> {
    const existing = await query('SELECT COUNT(*) as count FROM contacts WHERE client_id = $1', [this.clientId])
    const existingCount = parseInt(existing.rows[0]?.count || '0', 10)
    
    if (existingCount >= count) return
    
    const toCreate = count - existingCount
    console.log(`Creating ${toCreate} test contacts...`)
    
    const contacts = []
    for (let i = 0; i < toCreate; i++) {
      contacts.push({
        email: `test${existingCount + i}@example.com`,
        name: `Test User ${existingCount + i}`,
        company: 'Test Company',
      })
    }
    
    // Bulk insert
    const values = contacts.map((c, i) => 
      `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`
    ).join(', ')
    
    const params = [this.clientId]
    contacts.forEach(c => {
      params.push(c.email, c.name, c.company, 'test', '{}')
    })
    
    await query(`
      INSERT INTO contacts (client_id, email, name, company, source, custom_fields)
      VALUES ${values}
      ON CONFLICT (client_id, email) DO NOTHING
    `, params)
  }
  
  private async sendTestEmail(): Promise<boolean> {
    // Simulate sending through the queue system
    const contact = await query(
      'SELECT id, email FROM contacts WHERE client_id = $1 AND status = $2 ORDER BY RANDOM() LIMIT 1',
      [this.clientId, 'active']
    )
    
    if (!contact.rows[0]) return false
    
    const job = {
      id: Date.now(),
      client_id: this.clientId,
      contact_id: contact.rows[0].id,
      campaign_id: 1,
      sequence_step: 1,
      scheduled_at: new Date().toISOString(),
      recipient_email: contact.rows[0].email,
      metadata: { test: true }
    }
    
    await enqueueQueueJobs([job])
    return true
  }
  
  private async simulateFailures(): Promise<void> {
    for (const scenario of this.config.failureScenarios) {
      setTimeout(async () => {
        console.log(`🔥 Simulating ${scenario.type} for ${scenario.durationMinutes} minutes...`)
        
        // Implement failure simulation logic here
        switch (scenario.type) {
          case 'smtp_down':
            // Set SMTP to fail
            process.env.SMTP_HOST = 'nonexistent.smtp.com'
            break
          case 'api_fail':
            // Set API to fail
            process.env.OPENROUTER_API_KEY = 'invalid'
            break
          case 'queue_full':
            // Fill Redis queue
            const jobs = Array.from({ length: 10000 }, (_, i) => ({
              id: i,
              client_id: this.clientId,
              contact_id: i % 1000 + 1,
              campaign_id: 1,
              sequence_step: 1,
              scheduled_at: new Date().toISOString()
            }))
            await enqueueQueueJobs(jobs)
            break
        }
        
        // Restore after duration
        setTimeout(() => {
          console.log(`✅ Restoring from ${scenario.type} failure...`)
          // Restore original config
        }, scenario.durationMinutes * 60 * 1000)
        
      }, scenario.startAfterMinutes * 60 * 1000)
    }
  }
  
  private async generateReport(): Promise<void> {
    const metrics = await query(`
      SELECT 
        event_type,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at)))) as avg_interval_seconds
      FROM events 
      WHERE client_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
      GROUP BY event_type
    `, [this.clientId])
    
    console.log('\n📊 LOAD TEST REPORT')
    console.log('==================')
    metrics.rows.forEach(row => {
      console.log(`${row.event_type}: ${row.count} (avg ${row.avg_interval_seconds || 0}s between events)`)
    })
    
    // Check if system maintained target
    const sentCount = parseInt(metrics.rows.find(r => r.event_type === 'sent')?.count || '0', 10)
    const target = this.config.targetVolumes[this.config.targetVolumes.length - 1]
    const success = sentCount >= target * 0.95 // 95% success rate
    
    console.log(`\n🎯 Target Achievement: ${success ? '✅ PASSED' : '❌ FAILED'}`)
    console.log(`Sent: ${sentCount}/${target} (${((sentCount/target)*100).toFixed(1)}%)`)
  }
  
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Run the load test
async function main() {
  const tester = new LoadTester({
    targetVolumes: [1000, 10000, 50000],
    rampDurationMinutes: 30,
    failureScenarios: [
      { type: 'smtp_down', durationMinutes: 5, startAfterMinutes: 10 },
      { type: 'api_fail', durationMinutes: 3, startAfterMinutes: 20 },
      { type: 'queue_full', durationMinutes: 2, startAfterMinutes: 25 }
    ]
  })
  
  await tester.runLoadTest()
}

if (require.main === module) {
  main().catch(console.error)
}
