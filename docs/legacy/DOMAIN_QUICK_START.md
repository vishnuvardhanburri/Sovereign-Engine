# Domain Management & Rate Control - Quick Start Guide

Get up and running with the domain management and rate control system in 5 minutes.

## Prerequisites

- PostgreSQL database (or Supabase)
- Upstash Redis account
- Resend API key (for email sending)
- Node.js 18+

## Step 1: Set Environment Variables

Create a `.env.local` file in your project root:

```env
# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/cold_email

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-auth-token

# Cron job secret (random string)
CRON_SECRET=your-super-secret-cron-token

# Optional
NODE_ENV=development
```

## Step 2: Initialize the Database

Run the database schema:

```bash
psql $DATABASE_URL < scripts/init-db.sql
```

Or if using Supabase:
1. Go to SQL Editor in Supabase dashboard
2. Create a new query
3. Copy contents of `scripts/init-db.sql`
4. Run the query

## Step 3: Add Domains via API

Create your first domain:

```bash
curl -X POST http://localhost:3000/api/domains \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "mail.example.com",
    "daily_limit": 50
  }'
```

Response:
```json
{
  "id": 1,
  "domain": "mail.example.com",
  "status": "active",
  "daily_limit": 50,
  "sent_today": 0,
  "health_score": 100,
  "bounce_rate": 0,
  "reply_rate": 0,
  "created_at": "2024-01-15T10:00:00Z"
}
```

## Step 4: Add Email Identities

Add an email address for the domain:

```bash
curl -X POST http://localhost:3000/api/identities \
  -H "Content-Type: application/json" \
  -d '{
    "domain_id": 1,
    "email": "sender@mail.example.com",
    "daily_limit": 50
  }'
```

## Step 5: Enqueue Jobs

Add emails to the send queue:

```bash
curl -X POST http://localhost:3000/api/queue \
  -H "Content-Type: application/json" \
  -d '{
    "contact_id": 123,
    "campaign_id": 456,
    "domain_id": 1,
    "scheduled_at": "2024-01-15T12:00:00Z"
  }'
```

## Step 6: Deploy Worker Service (Optional)

To actually send emails, deploy the worker service to Render or Fly.io:

### Render.com Deployment
1. Create new Web Service
2. Connect your GitHub repo
3. Set Start Command: `cd worker && npm install && npm start`
4. Add Environment Variables (DATABASE_URL, UPSTASH_*, RESEND_API_KEY)
5. Deploy

### Local Development
```bash
cd worker
npm install
npm start
```

## Step 7: Set Up Daily Cron Job

Schedule the daily reset job to run at midnight UTC. Use a service like:
- **EasyCron.com** (free)
- **Vercel Cron** (if on Vercel)
- **AWS EventBridge**

Endpoint: `POST /api/cron/daily-reset`
Header: `Authorization: Bearer YOUR_CRON_SECRET`
Frequency: Daily at 00:00 UTC

## Step 8: Access the UI

Navigate to the Domains page in your app:

1. Log in (use demo@example.com / password)
2. Click "Domains" in the sidebar
3. View your domains and identities
4. Add more domains or identities
5. Monitor health scores and daily usage

## API Endpoints Reference

### Domains
- `GET /api/domains` - List all domains
- `POST /api/domains` - Create domain
- `POST /api/domains/:id/pause` - Pause domain
- `POST /api/domains/:id/resume` - Resume domain

### Identities
- `GET /api/identities?domain_id=1` - List identities
- `POST /api/identities` - Add identity

### Queue
- `POST /api/queue` - Enqueue job
- `GET /api/queue` - List pending jobs
- `GET /api/queue?action=peek&count=10` - Peek at queue

### Events
- `POST /api/events` - Log event (bounce, reply, etc)
- `GET /api/events?identity_id=1&type=bounce` - Query events

### Health
- `GET /api/health?domain_id=1` - Get health metrics
- `POST /api/health` - Recalculate health score

### Cron
- `POST /api/cron/daily-reset` - Daily reset (requires auth)

## Testing

Run integration tests:

```bash
npx ts-node lib/integration-tests.ts
```

This validates:
- Domain quota enforcement
- Rate limiting with jitter
- Health-based identity selection
- Bounce/reply tracking
- Auto-pause on high bounce rates

## Monitoring

Key metrics to track:

1. **Domain Health Score** - Should be 80+
2. **Bounce Rate** - Target < 3%
3. **Reply Rate** - Target > 5%
4. **Queue Depth** - Should be < 1000
5. **Worker Uptime** - Should be > 99%

Check these on the Domains page or via API.

## Troubleshooting

### Database Connection Error
```
error: connect ECONNREFUSED 127.0.0.1:5432
```
- Verify PostgreSQL is running
- Check DATABASE_URL format
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### Redis Connection Error
```
error: Request failed with status 401
```
- Verify UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
- Check tokens haven't expired
- Test in Upstash console

### No Email Responses
- Verify worker service is running
- Check RESEND_API_KEY is valid
- Review worker logs for errors
- Ensure domain has valid SPF/DKIM/DMARC

### High Bounce Rate
- Check list quality (no honeypots, role accounts)
- Verify domain warm-up (start with low limits)
- Review email content (triggers spam filters)
- Space out sends more (increase refill interval)

## Next Steps

1. Integrate with your campaigns
2. Set up webhook handlers for bounces/replies
3. Configure email templates
4. Run warmup sequence
5. Monitor health metrics daily

## More Details

See `DOMAIN_RATE_CONTROL_README.md` for:
- Architecture deep dive
- Database schema details
- Rate limiting algorithm
- Health scoring logic
- Worker deployment options
- Security best practices
