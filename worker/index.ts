/**
 * Email Queue Worker Service
 * 
 * This is a separate Node.js service that runs independently from the Next.js app.
 * It pulls jobs from the Redis queue and sends emails via Resend.
 * 
 * Deployment options:
 * - Render: https://render.com
 * - Fly.io: https://fly.io
 * - AWS Lambda with SQS
 * - Google Cloud Run
 * 
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 * - UPSTASH_REDIS_REST_URL: Redis REST API URL
 * - UPSTASH_REDIS_REST_TOKEN: Redis authentication token
 * - RESEND_API_KEY: Resend email service API key
 * - POLL_INTERVAL: Queue polling interval in ms (default: 5000)
 */

import { Pool } from 'pg'
import { Redis } from '@upstash/redis'
import { Resend } from 'resend'

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000')
const MAX_RETRIES = 3

// Initialize database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

// Initialize Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY)

interface QueueJob {
  id: number
  contact_id: number
  campaign_id: number
  domain_id: number
  scheduled_at?: string
}

interface Contact {
  id: number
  email: string
  name?: string
}

interface Campaign {
  id: number
  subject: string
  body: string
}

interface Identity {
  id: number
  email: string
  domain_id: number
  daily_limit: number
  sent_today: number
}

/**
 * Main worker loop
 */
async function startWorker() {
  console.log('[Worker] Starting email queue processor...')

  while (true) {
    try {
      // Fetch next job from Redis queue
      const job = await dequeueJob()

      if (!job) {
        // No jobs, wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
        continue
      }

      console.log(`[Worker] Processing job ${job.id}`)

      // Process the job
      const success = await processJob(job)

      if (success) {
        // Mark job as completed in database
        await updateJobStatus(job.id, 'completed')
        console.log(`[Worker] Job ${job.id} completed`)
      } else {
        console.log(`[Worker] Job ${job.id} failed (will retry)`)
      }
    } catch (error) {
      console.error('[Worker] Unexpected error in main loop:', error)
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }
  }
}

/**
 * Dequeue a job from Redis
 */
async function dequeueJob(): Promise<QueueJob | null> {
  try {
    const job = await redis.rpop('email:queue')
    return job ? JSON.parse(job) : null
  } catch (error) {
    console.error('[Worker] Error dequeuing job:', error)
    return null
  }
}

/**
 * Process a single job
 */
async function processJob(job: QueueJob): Promise<boolean> {
  try {
    // Check if scheduled time has arrived
    if (job.scheduled_at) {
      const scheduledTime = new Date(job.scheduled_at).getTime()
      if (scheduledTime > Date.now()) {
        // Not time yet, re-queue the job
        await redis.lpush('email:queue', JSON.stringify(job))
        return true
      }
    }

    // Fetch contact details
    const contact = await getContact(job.contact_id)
    if (!contact) {
      console.log(`[Worker] Contact ${job.contact_id} not found, skipping`)
      return true // Mark as done to prevent infinite retries
    }

    // Fetch campaign details
    const campaign = await getCampaign(job.campaign_id)
    if (!campaign) {
      console.log(`[Worker] Campaign ${job.campaign_id} not found, skipping`)
      return true
    }

    // Select best identity for the domain
    const identity = await selectBestIdentity(job.domain_id)
    if (!identity) {
      console.log(
        `[Worker] No available identity for domain ${job.domain_id}, re-queuing`
      )
      // Re-queue the job to try again later
      await redis.lpush('email:queue', JSON.stringify(job))
      return true
    }

    // Check rate limit and capacity
    const canSend = await checkCanSend(identity.id, job.domain_id)
    if (!canSend) {
      console.log(`[Worker] Rate limit exceeded for identity ${identity.id}`)
      // Re-queue the job
      await redis.lpush('email:queue', JSON.stringify(job))
      return true
    }

    // Send email via Resend
    const result = await sendEmail({
      to: contact.email,
      from: identity.email,
      subject: campaign.subject,
      html: campaign.body,
    })

    if (!result) {
      return false // Retry the job
    }

    // Record successful send
    await recordSend(identity.id, job.domain_id, contact.email)

    // Log event
    await logEvent({
      identity_id: identity.id,
      type: 'sent',
      contact_email: contact.email,
      campaign_id: job.campaign_id,
    })

    return true
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.id}:`, error)
    return false
  }
}

/**
 * Send email via Resend
 */
async function sendEmail({
  to,
  from,
  subject,
  html,
}: {
  to: string
  from: string
  subject: string
  html: string
}): Promise<boolean> {
  try {
    const response = await resend.emails.send({
      from,
      to,
      subject,
      html,
    })

    if (response.error) {
      console.error('[Worker] Resend error:', response.error)
      return false
    }

    console.log(`[Worker] Email sent to ${to}`)
    return true
  } catch (error) {
    console.error('[Worker] Error sending email:', error)
    return false
  }
}

/**
 * Get contact from database
 */
async function getContact(contactId: number): Promise<Contact | null> {
  try {
    const result = await pool.query(
      'SELECT id, email, name FROM contacts WHERE id = $1',
      [contactId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error('[Worker] Error fetching contact:', error)
    return null
  }
}

/**
 * Get campaign from database
 */
async function getCampaign(campaignId: number): Promise<Campaign | null> {
  try {
    const result = await pool.query(
      'SELECT id, subject, body FROM campaigns WHERE id = $1',
      [campaignId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error('[Worker] Error fetching campaign:', error)
    return null
  }
}

/**
 * Select best identity for domain
 */
async function selectBestIdentity(
  domainId: number
): Promise<Identity | null> {
  try {
    const result = await pool.query(
      `SELECT i.* FROM identities i
       WHERE i.domain_id = $1
       AND i.status = 'active'
       AND i.sent_today < i.daily_limit
       ORDER BY i.last_sent_at ASC NULLS FIRST
       LIMIT 1`,
      [domainId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error('[Worker] Error selecting identity:', error)
    return null
  }
}

/**
 * Check if identity can send (rate limit + capacity)
 */
async function checkCanSend(
  identityId: number,
  domainId: number
): Promise<boolean> {
  try {
    // Check token bucket
    const bucket = await redis.get(`bucket:${identityId}`)
    if (!bucket) {
      return true // Allow if no bucket exists (will be created)
    }

    const parsed = JSON.parse(bucket)
    const secondsElapsed = (Date.now() - parsed.last_refill) / 1000
    const refillInterval = 90 // seconds

    const tokensGenerated = Math.floor(secondsElapsed / refillInterval)
    const available = parsed.tokens + tokensGenerated >= 1

    return available
  } catch (error) {
    console.error('[Worker] Error checking rate limit:', error)
    return true // Fail open
  }
}

/**
 * Record successful send
 */
async function recordSend(
  identityId: number,
  domainId: number,
  contactEmail: string
): Promise<void> {
  try {
    // Update database
    await pool.query(
      `UPDATE identities 
       SET sent_today = sent_today + 1, last_sent_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [identityId]
    )

    // Update Redis cache
    await redis.incr(`sent:${identityId}`)
    await redis.incr(`sent:domain:${domainId}`)
    await redis.expire(`sent:${identityId}`, 86400)
    await redis.expire(`sent:domain:${domainId}`, 86400)

    // Consume token
    const bucket = await redis.get(`bucket:${identityId}`)
    if (bucket) {
      const parsed = JSON.parse(bucket)
      const updated = {
        tokens: parsed.tokens - 1,
        last_refill: Date.now(),
      }
      await redis.set(`bucket:${identityId}`, JSON.stringify(updated), {
        ex: 86400,
      })
    }
  } catch (error) {
    console.error('[Worker] Error recording send:', error)
  }
}

/**
 * Log event
 */
async function logEvent({
  identity_id,
  type,
  contact_email,
  campaign_id,
}: {
  identity_id: number
  type: 'sent' | 'bounce' | 'reply'
  contact_email: string
  campaign_id: number
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO events (identity_id, type, contact_email, campaign_id) 
       VALUES ($1, $2, $3, $4)`,
      [identity_id, type, contact_email, campaign_id]
    )
  } catch (error) {
    console.error('[Worker] Error logging event:', error)
  }
}

/**
 * Update job status in database
 */
async function updateJobStatus(
  jobId: number,
  status: 'completed' | 'failed'
): Promise<void> {
  try {
    await pool.query('UPDATE queue SET status = $1 WHERE id = $2', [
      status,
      jobId,
    ])
  } catch (error) {
    console.error('[Worker] Error updating job status:', error)
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('[Worker] Shutting down...')
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start the worker
startWorker().catch((error) => {
  console.error('[Worker] Fatal error:', error)
  process.exit(1)
})
