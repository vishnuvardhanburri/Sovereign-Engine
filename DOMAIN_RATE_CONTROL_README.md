# Domain Management & Rate Control System

Production-grade domain management and rate control system for cold email automation. Supports 10k+ emails/day with per-domain and per-identity rate limiting.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Next.js API Layer (Vercel)                                   │
│ ├─ Domain CRUD endpoints (/api/domains/*)                   │
│ ├─ Identity management (/api/identities/*)                  │
│ ├─ Queue management (/api/queue/*)                          │
│ ├─ Event logging (/api/events/*)                            │
│ ├─ Health calculation (/api/health/*)                       │
│ └─ Cron jobs (/api/cron/daily-reset)                        │
└─────────────────────────────────────────────────────────────┘
         ↓                    ↓                    ↓
    PostgreSQL         Upstash Redis         Next.js UI
    (Domains,         (Queue, Rate           (React)
     Identities,      Limits, Cache)
     Events)
         ↑
┌─────────────────────────────────────────────────────────────┐
│ External Worker Service (Render/Fly.io)                      │
│ ├─ Pull jobs from Redis queue                               │
│ ├─ Select best identity (health-based)                      │
│ ├─ Check rate limits & capacity                             │
│ ├─ Send via Resend API                                      │
│ ├─ Record events & update counters                          │
│ └─ Webhook handlers for bounces/replies                     │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Domains Table
```sql
id (BIGINT PRIMARY KEY)
domain (VARCHAR UNIQUE) - Domain name (e.g., email.example.com)
status (VARCHAR) - 'active', 'paused', 'warming'
warmup_stage (INT) - Warmup progression (0-5)
daily_limit (INT) - Emails per day (50-500)
sent_today (INT) - Counter (reset daily)
health_score (FLOAT) - 0-100 based on bounce/reply rates
bounce_rate (FLOAT) - % bounces
reply_rate (FLOAT) - % replies
last_reset_at (TIMESTAMP) - Last counter reset
created_at, updated_at (TIMESTAMP)
```

### Identities Table
```sql
id (BIGINT PRIMARY KEY)
domain_id (BIGINT FOREIGN KEY) - Parent domain
email (VARCHAR) - Email address (unique per domain)
daily_limit (INT) - Per-email limit
sent_today (INT) - Counter (reset daily)
last_sent_at (TIMESTAMP) - For round-robin selection
status (VARCHAR) - 'active', 'paused', 'inactive'
created_at, updated_at (TIMESTAMP)
```

### Events Table
```sql
id (BIGINT PRIMARY KEY)
identity_id (BIGINT FOREIGN KEY) - Which identity sent it
type (VARCHAR) - 'sent', 'bounce', 'reply', 'complaint'
contact_email (VARCHAR) - Recipient
campaign_id (BIGINT) - Link to campaign
metadata (JSONB) - Extra data
created_at (TIMESTAMP)
```

### Queue Table
```sql
id (BIGINT PRIMARY KEY)
contact_id (BIGINT)
campaign_id (BIGINT)
domain_id (BIGINT)
scheduled_at (TIMESTAMP) - For delayed sends
status (VARCHAR) - 'pending', 'processing', 'completed', 'failed'
attempt_count (INT)
error_message (TEXT)
created_at, updated_at (TIMESTAMP)
```

## API Endpoints

### Domains

**GET /api/domains**
- List all domains with health metrics
- Response: `Domain[]` with `identity_count`, `today_sent`, `capacity_remaining`

**POST /api/domains**
- Create new domain
- Body: `{ domain: string, daily_limit?: number }`
- Returns: `Domain`

**POST /api/domains/:id/pause**
- Pause domain (stop all sends)

**POST /api/domains/:id/resume**
- Resume paused domain

### Identities

**GET /api/identities?domain_id=X**
- List identities for domain

**POST /api/identities**
- Create identity
- Body: `{ domain_id: number, email: string, daily_limit?: number }`

### Queue

**POST /api/queue**
- Enqueue job for sending
- Body: `{ contact_id, campaign_id, domain_id, scheduled_at? }`

**GET /api/queue?action=peek&count=10**
- Peek at queue without consuming

### Events

**POST /api/events**
- Log event (bounce, reply, etc)
- Body: `{ identity_id, type, contact_email, campaign_id?, metadata? }`

**GET /api/events?identity_id=X&type=bounce&hours=24**
- Query events with filters

### Health

**GET /api/health?domain_id=X**
- Get health metrics for domain

**POST /api/health**
- Recalculate health score
- Body: `{ domain_id: number }`

## Rate Limiting

### Token Bucket Algorithm
Each identity has a token bucket that refills at a configured interval (default: 60-120s with jitter).

```
Key: bucket:{identity_id}
Value: {
  tokens: float (0-1),
  last_refill: timestamp
}

On send:
1. Check time elapsed since last refill
2. Generate new tokens (refill_interval determines rate)
3. If tokens >= 1: consume 1 token, allow send
4. Else: reject with backoff
```

### Jitter Implementation
To avoid thundering herd and ISP detection:
- Refill interval: 60-120 seconds (randomized per identity)
- Adds natural delays between consecutive sends
- Prevents pattern detection by email providers

### Capacity Checks
1. **Domain daily limit**: `sent_today >= daily_limit` → reject
2. **Identity daily limit**: `identity.sent_today >= identity.daily_limit` → reject
3. **Rate limit**: `tokens < 1` → backoff
4. **Domain health**: `bounce_rate > 5%` → pause (auto-resume when recovered)

## Health Scoring

Health score is calculated based on last 7 days of events:

```
Base: 100
- Bounce rate penalty: max -30 points
  - If > 5%: automatic domain pause
  - If < 2%: +5 reward
  
- Reply rate bonus: max +20 points
  - If > 10%: +20 points
  - If < 2%: -10 penalty

Final: clamp(0, 100)
```

## Daily Reset & Scaling

### Daily Reset (Midnight UTC)
Via `/api/cron/daily-reset` (call once per day):
1. Reset `sent_today = 0` for all identities/domains
2. Recalculate health scores
3. Scale limits based on health

### Limit Scaling
- Health >= 90: scale up by 10%, max 500
- Health < 80: scale down by 5%, min 50
- Warmup domains: start at 50, scale to 400-500

## Redis Cache Strategy

**Keys:**
- `email:queue` - List of pending jobs
- `bucket:{identity_id}` - Token bucket state (24h TTL)
- `sent:{identity_id}` - Daily send count (24h TTL)
- `sent:domain:{domain_id}` - Domain daily total (24h TTL)

**Expiry:** All daily counters expire at midnight UTC automatically

## Worker Service Deployment

### Option 1: Render.com
```bash
git clone <your-repo>
cd worker/
npm install
npm start
```
Set environment variables in Render dashboard:
- DATABASE_URL
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- RESEND_API_KEY
- POLL_INTERVAL (default: 5000)

### Option 2: Fly.io
```bash
fly launch
fly deploy
```

### Option 3: AWS Lambda
Use AWS Lambda with SQS or EventBridge trigger

### Environment Variables
```env
DATABASE_URL=postgresql://user:pass@host/db
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
RESEND_API_KEY=...
POLL_INTERVAL=5000
```

## Integration with Existing System

### Adding to Campaigns
```typescript
// Send campaign
async function sendCampaign(campaignId: number) {
  const contacts = await getContacts(campaignId)
  const domain = await selectDomain(campaignId) // or let worker choose
  
  for (const contact of contacts) {
    await fetch('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        contact_id: contact.id,
        campaign_id: campaignId,
        domain_id: domain.id,
        scheduled_at: calculateDelay(contact.index)
      })
    })
  }
}
```

### Webhook Handlers
Worker service should subscribe to email provider webhooks:

```typescript
// POST /api/webhooks/resend
function handleResendWebhook(event) {
  if (event.type === 'email.bounced') {
    await fetch('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        identity_id: findIdentityByEmail(event.email_from),
        type: 'bounce',
        contact_email: event.email_to,
        campaign_id: event.metadata.campaign_id,
        metadata: event
      })
    })
  }
}
```

## Monitoring & Alerts

### Key Metrics
- Daily sends per domain
- Bounce rate per domain
- Reply rate per domain
- Queue length
- Worker processing rate
- Rate limit hits

### Alert Thresholds
- Domain bounce rate > 5%: auto-pause
- Queue depth > 10k: notify ops
- Worker downtime > 5min: alert
- Resend API errors > 1%: escalate

## Testing

Run integration tests:
```bash
npx ts-node lib/integration-tests.ts
```

Tests verify:
- Domain quota enforcement
- Rate limiting with jitter
- Health-based identity selection
- Bounce/reply tracking
- Automatic domain pausing
- Redis cache synchronization

## Cost Estimation (10k emails/day)

- **PostgreSQL**: Supabase ~$10/mo for this workload
- **Redis**: Upstash ~$20/mo (includes REST API)
- **Worker**: Render $7/mo hobby tier or Fly $5/mo
- **Email API**: Resend $0.001/email = ~$10/mo
- **Total**: ~$50/month

## Security Considerations

1. **Rate Limiting**: Built-in per-identity + jitter prevents sender reputation damage
2. **Domain Verification**: All domains must be verified (SPF/DKIM/DMARC)
3. **Bounce Management**: Auto-pause on high bounce rates
4. **Suppression List**: Check before sending (integrate with provider)
5. **IP Warming**: Gradual scale-up via health scoring
6. **Auth**: Use API keys + signature verification for webhooks

## Troubleshooting

### High Bounce Rate
- Check domain SPF/DKIM/DMARC setup
- Verify list quality (no role accounts, honeypots)
- Lower daily limit to increase deliverability
- Space out sends more (increase refill interval)

### Queue Backlog
- Check worker service is running
- Verify Redis connectivity
- Review Resend API limits
- Scale worker concurrency

### Rate Limiting Too Aggressive
- Adjust `refillInterval` in `rate-limiter.ts`
- Increase domain `daily_limit`
- Reduce jitter (currently 60-120s)

## Future Enhancements

1. **ML Health Scoring**: Predict bounce rate from content
2. **A/B Testing**: Test multiple subjects/bodies per campaign
3. **IP Rotation**: Multiple IPs per domain
4. **Warm-up Automation**: Auto-progression through warmup stages
5. **Webhook Retry**: Retry logic for bounce/reply processing
6. **Detailed Analytics**: Charts for health trends, engagement
7. **List Validation**: SMTP/validation checks before sending
8. **Personalization**: Variable substitution in email body
