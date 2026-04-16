# Deployment Checklist - Domain Management System

Complete this checklist before launching to production.

## Pre-Deployment

### Database Setup
- [ ] Create PostgreSQL database (Supabase/RDS/self-hosted)
- [ ] Run `scripts/init-db.sql` to create schema
- [ ] Verify all tables and indexes are created
- [ ] Test connection from application
- [ ] Set up automated backups
- [ ] Configure connection pooling (max 20 connections)
- [ ] Set slow query log threshold (1s)

### Redis Setup
- [ ] Create Upstash Redis instance
- [ ] Get REST API URL and token
- [ ] Test connection with `redis-cli`
- [ ] Set TTL policies for daily keys (86400s)
- [ ] Configure backup retention
- [ ] Test failover behavior

### Environment Variables
- [ ] Set DATABASE_URL
- [ ] Set UPSTASH_REDIS_REST_URL
- [ ] Set UPSTASH_REDIS_REST_TOKEN
- [ ] Set CRON_SECRET (random, strong)
- [ ] Set NODE_ENV=production
- [ ] Review all secrets in vault

### Email Service
- [ ] Create Resend account and get API key
- [ ] Verify sending domain
- [ ] Set up SPF, DKIM, DMARC records
- [ ] Configure bounce/complaint webhooks
- [ ] Test sending via API

### API Security
- [ ] Enable HTTPS on all endpoints
- [ ] Add rate limiting on public endpoints
- [ ] Implement CORS policies
- [ ] Add request logging/monitoring
- [ ] Set up DDoS protection (Cloudflare)
- [ ] Enable request signing for webhooks

## Worker Deployment

### Render.com
- [ ] Create new Web Service
- [ ] Connect GitHub repo
- [ ] Set Start Command: `cd worker && npm install && npm start`
- [ ] Set Environment Variables
- [ ] Configure health check endpoint
- [ ] Set auto-deployment on git push
- [ ] Configure resource limits (2GB RAM)
- [ ] Enable logging/monitoring

### Fly.io
- [ ] Install `flyctl`
- [ ] Run `fly launch` in worker directory
- [ ] Configure `fly.toml` with resource limits
- [ ] Set Environment Variables
- [ ] Deploy: `fly deploy`
- [ ] Monitor with `fly logs`
- [ ] Set up health checks

### Local Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY worker/ .
RUN npm install --production
CMD ["npm", "start"]
```

Test:
```bash
docker build -t email-worker .
docker run -e DATABASE_URL=... -e UPSTASH_REDIS_REST_URL=... email-worker
```

## Vercel Deployment

### Main App
- [ ] Connect GitHub repository
- [ ] Configure build settings
- [ ] Set Environment Variables in Vercel dashboard
- [ ] Deploy preview environment
- [ ] Run tests on preview
- [ ] Deploy to production

### Cron Jobs
- [ ] Set up daily reset job
  - Schedule: 0 0 * * * (midnight UTC)
  - Endpoint: POST /api/cron/daily-reset
  - Header: Authorization: Bearer $CRON_SECRET
- [ ] Test cron endpoint manually
- [ ] Monitor cron logs
- [ ] Set up alerts for failed runs

Options for cron:
- **Vercel Cron** (if available in your plan)
- **EasyCron.com** (free, reliable)
- **AWS Lambda + EventBridge**
- **Google Cloud Scheduler**

## Monitoring & Alerts

### Application Monitoring
- [ ] Set up error tracking (Sentry/DataDog)
- [ ] Enable request logging
- [ ] Set up performance monitoring
- [ ] Configure uptime monitoring
- [ ] Create dashboards for key metrics

### Worker Monitoring
- [ ] Monitor queue depth
- [ ] Track processing rate
- [ ] Alert on worker crashes
- [ ] Log all API errors
- [ ] Monitor Resend API limits

### Database Monitoring
- [ ] Set up slow query alerts
- [ ] Monitor connection pool usage
- [ ] Alert on disk space
- [ ] Monitor backup completion
- [ ] Track index performance

### Alert Rules
```
- Queue depth > 10,000 → Page on-call
- Worker downtime > 5min → Page on-call
- Bounce rate > 5% → Email notification
- Resend API errors > 1% → Email notification
- Database errors > 1% → Email notification
```

## Data Validation

### Test Data
- [ ] Create 3+ test domains
- [ ] Add 5+ test identities
- [ ] Enqueue 10+ test jobs
- [ ] Simulate bounce/reply events
- [ ] Verify health score calculation
- [ ] Test rate limiting
- [ ] Verify daily reset logic

### Domain Validation
- [ ] Verify SPF records for test domain
- [ ] Verify DKIM signature
- [ ] Check DMARC alignment
- [ ] Send test email and track delivery
- [ ] Verify bounce webhook integration
- [ ] Verify reply webhook integration

## Performance Testing

### Load Testing
```bash
# Simple load test with Apache Bench
ab -n 1000 -c 10 http://your-app.com/api/domains

# Or use Artillery
artillery load test-load.yml
```

### Targets
- [ ] GET /api/domains: < 200ms (p99)
- [ ] POST /api/queue: < 300ms (p99)
- [ ] Worker processing: < 5s per email
- [ ] Redis operations: < 50ms (p99)
- [ ] Database queries: < 100ms (p99)

### Stress Testing
- [ ] Test with 100 concurrent connections
- [ ] Test with 10k emails in queue
- [ ] Simulate worker crash and recovery
- [ ] Simulate database connection loss
- [ ] Verify graceful degradation

## Security Audit

### Code
- [ ] Run `npm audit` - no critical vulnerabilities
- [ ] Review SQL queries for injection risks
- [ ] Verify Redis key naming doesn't leak data
- [ ] Check secrets not logged anywhere
- [ ] Verify CORS headers properly configured

### Infrastructure
- [ ] All connections use HTTPS/TLS
- [ ] Database not publicly accessible
- [ ] Redis not publicly accessible
- [ ] Worker service behind VPN/firewall
- [ ] API keys rotated every 90 days

### Access Control
- [ ] Implement API key auth for webhooks
- [ ] Verify CRON_SECRET is strong
- [ ] Restrict database user privileges
- [ ] Set up audit logging
- [ ] Configure IP whitelisting if needed

## Launch Checklist

### Final Checks
- [ ] All tests passing
- [ ] No console errors/warnings
- [ ] Logging configured
- [ ] Alerts configured
- [ ] Backups configured
- [ ] Disaster recovery plan documented
- [ ] Runbook created for common issues
- [ ] On-call schedule configured

### Go-Live
- [ ] Schedule deployment (non-peak hours)
- [ ] Brief on-call team
- [ ] Have rollback plan ready
- [ ] Monitor closely first 24 hours
- [ ] Check domain health metrics
- [ ] Verify no error spikes
- [ ] Confirm email delivery working

### Post-Launch
- [ ] Document any issues encountered
- [ ] Gather team feedback
- [ ] Plan improvements
- [ ] Schedule post-mortem if issues
- [ ] Update runbooks based on learnings
- [ ] Plan next optimization sprint

## Common Issues & Solutions

### Database Connection Pooling
```js
// Configure pg pool
const pool = new Pool({
  max: 20,  // max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})
```

### Redis Connection Issues
```js
// Implement retry logic
const redis = new Redis({
  url: REDIS_URL,
  retryStrategy: (times) => Math.min(50 * Math.pow(2, times), 2000)
})
```

### Worker Crashes
```js
// Implement graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...')
  await pool.end()
  process.exit(0)
})
```

### High Bounce Rate
1. Check domain warm-up (start with 50/day)
2. Verify SPF/DKIM/DMARC alignment
3. Monitor reply rate (should be > 5%)
4. Review email content for spam triggers
5. Consider IP reputation (SendGrid, etc)

## Maintenance

### Daily
- [ ] Monitor queue depth
- [ ] Check for errors in logs
- [ ] Verify cron job ran

### Weekly
- [ ] Review domain health metrics
- [ ] Check worker uptime
- [ ] Audit API error rates
- [ ] Review slow queries

### Monthly
- [ ] Rotate API keys
- [ ] Update dependencies
- [ ] Review storage usage
- [ ] Plan next sprint

### Quarterly
- [ ] Full security audit
- [ ] Load testing
- [ ] Disaster recovery drill
- [ ] Performance optimization

## Contacts & Escalation

- **Database Admin**: [Contact]
- **Infrastructure**: [Contact]
- **Email Deliverability**: [Contact]
- **On-Call Engineer**: [Contact]

## References

- [Domain Management README](./DOMAIN_RATE_CONTROL_README.md)
- [Quick Start Guide](./DOMAIN_QUICK_START.md)
- [Architecture Documentation](./DOMAIN_RATE_CONTROL_README.md#architecture-overview)
- Worker deployment: See `worker/package.json`
