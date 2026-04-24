# Autonomous Infrastructure - Quick Start Guide

## What You've Built

A complete **autonomous email sending infrastructure** that:

✅ **Scales automatically** - Provisions new domains/inboxes when needed  
✅ **Monitors health** - Tracks bounce rates, spam rates, deliverability  
✅ **Distributes intelligently** - Routes emails to healthiest inboxes  
✅ **Handles failures** - Automatic failover without losing emails  
✅ **Self-heals** - Detects and fixes common issues automatically  
✅ **Learns continuously** - Analyzes patterns and optimizes performance  

## Key Metrics

For **50,000 emails/day**:
- Need **250 healthy domains** (if 200 emails/domain/day)
- Need **1,000 inboxes** (4 per domain × 50 emails per inbox)
- Expect **95%+ deliverability** with proper health monitoring
- Auto-scale triggers when capacity < target volume

## Core Systems (7 Integrated Subsystems)

| System | Purpose | Auto-Triggers |
|--------|---------|---------------|
| **Capacity Engine** | Calculate capacity needs | Checks if current < target |
| **Auto-Scaling** | Provision domains/inboxes | When capacity gap detected |
| **Domain Health** | Monitor bounce/spam rates | Every 5 minutes (health check) |
| **Distribution Engine** | Route emails optimally | Every send operation |
| **Failover System** | Handle failures | On send failure |
| **Self-Healing** | Fix common issues | Every 5 minutes (health check) |
| **Learning System** | Optimize performance | Every 1 hour |

## Architecture

```
┌─────────────────────────────────────┐
│  Coordinator (Main Entry Point)     │
│  coordinator.send(request)          │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────┬─────────┬──────────┐  │
│  │Capacity │Auto-    │Domain    │  │
│  │Engine   │Scaling  │Health    │  │
│  └─────────┴─────────┴──────────┘  │
│                                     │
│  ┌─────────┬─────────┬──────────┐  │
│  │Distrib. │Failover │Self-     │  │
│  │Engine   │System   │Healing   │  │
│  └─────────┴─────────┴──────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Learning System (Optimize)   │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Database & Infrastructure    │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Quick Integration

### 1. Use in Queue Worker
```typescript
import { coordinator } from '@/lib/infrastructure'

// Send email (handles everything automatically)
const result = await coordinator.send({
  campaignId: 'camp123',
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Welcome!</p>',
  text: 'Welcome!',
})

if (result.success) {
  console.log(`Sent via ${result.inboxUsed}`)
}
```

### 2. Check Status
```typescript
const state = await coordinator.getState()
console.log(state.capacityUtilization)  // Current %
console.log(state.healthyDomains)       // Healthy domain count
console.log(state.systemHealth.issues)  // Any issues detected
```

### 3. Emergency Control
```typescript
// Pause sending
await coordinator.pause('High bounce rate')

// Resume sending
await coordinator.resume()
```

## Background Tasks (Automatic)

| Task | Interval | Does |
|------|----------|------|
| Health Check | 5 minutes | Detects issues, runs healing |
| Auto-Resume | 5 minutes | Resumes paused domains after cool-off |
| Inbox Recovery | 5 minutes | Recovers temporarily unavailable inboxes |
| Optimization | 1 hour | Analyzes patterns, applies improvements |
| Auto-Scale | On-demand | Provisions domains when needed |

## Files Created

```
lib/infrastructure/
├── index.ts                      # Export all systems
├── coordinator.ts                # Main orchestrator
├── capacity-engine.ts            # Calculate capacity
├── auto-scaling.ts               # Provision domains
├── domain-health.ts              # Monitor reputation
├── distribution-engine.ts        # Route emails
├── failover-system.ts            # Handle failures
├── self-healing.ts               # Auto-fix issues
├── learning-system.ts            # Continuous optimization
├── README.md                      # Full documentation
├── INTEGRATION_GUIDE.ts           # How to use it
├── IMPLEMENTATION_CHECKLIST.md    # Step-by-step setup
└── QUICK_START.md                # This file
```

## Key Concepts

### Capacity Formula
```
Capacity = (healthy_domains × inboxes_per_domain × max_per_inbox)
         = healthy_domains × 4 × 50
         = healthy_domains × 200
```

Example: 10 healthy domains = 2,000 emails/day capacity

### Health Score
```
Score = 100
      - min(bounce_rate × 1000, 40)   // Max -40
      - min(spam_rate × 1000, 25)     // Max -25
      - min(volume / 10000, 10)       // Max -10
```

### Distribution Strategies
- **Health Priority** (recommended): Prioritize healthiest domains, least loaded inboxes
- **Least Loaded**: Select inbox with fewest emails sent today
- **Round Robin**: Cycle through inboxes
- **Random**: Random selection

### Failover Process
1. Inbox fails
2. Marked "temporarily_unavailable" (30 min cool-off)
3. Find healthy fallback
4. Switch to fallback
5. Auto-recover after cool-off

## Monitoring Checklist

### Daily
- [ ] Check capacity utilization
- [ ] Verify domain bounce rates
- [ ] Check any paused domains
- [ ] Review failures vs successes

### Weekly
- [ ] Analyze distribution effectiveness
- [ ] Check optimization recommendations
- [ ] Review healings that were applied
- [ ] Verify warmup schedules

### Monthly
- [ ] Review strategy performance
- [ ] Analyze cost per delivery
- [ ] Plan domain additions
- [ ] Review trend analysis

## Alert Triggers

| Alert Level | Condition | Action |
|-------------|-----------|--------|
| **CRITICAL** | Capacity > 90% | Scale immediately |
| **CRITICAL** | System degraded | Check health, apply healing |
| **CRITICAL** | Bounce > 5% | Pause domain, cool-off 24h |
| **CRITICAL** | Spam > 2% | Pause domain, cool-off 24h |
| **WARNING** | Capacity > 75% | Plan scaling |
| **WARNING** | Approaching limits | Monitor closely |
| **INFO** | Optimization applied | Log change |

## Performance Expectations

- **Inbox selection**: < 50ms
- **Send operation**: < 200ms
- **Failover success**: 99%+
- **Healing success**: 95%+
- **Recovery time**: 30 min inbox, 24h domain

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Capacity not increasing | Failed provisioning | Check API, verify domains are 'active' |
| High bounce rate | Poor list quality | Check send practices, extend warmup |
| Emails stuck | System paused | Check `coordinator.isPaused`, resume |
| Too many failovers | Unhealthy domains | Cool-off, improve domain care |
| Slow processing | Overloaded | Check capacity, auto-scale |

## Next Steps

1. **Initialize**: Import coordinator (auto-initialized)
2. **Integrate**: Call `coordinator.send()` in queue worker
3. **Monitor**: Create dashboard with `getState()` and `getReport()`
4. **Configure**: Adjust capacity limits, health thresholds
5. **Test**: Simulate failures, verify failover works
6. **Deploy**: Push to production with monitoring

## API Reference (Main Functions)

```typescript
// Send email (automatic routing, failover, scaling)
coordinator.send(request): Promise<SendResult>

// Get infrastructure status
coordinator.getState(): Promise<InfrastructureState>

// Get distribution details
coordinator.getReport(): Promise<DistributionReport>

// Emergency controls
coordinator.pause(reason): Promise<void>
coordinator.resume(): Promise<void>

// Capacity analysis
calculateCapacity(target): Promise<CapacityMetrics>
getCapacityUtilization(): Promise<number>

// Domain health
calculateDomainHealth(domainId): Promise<DomainHealth>
getAllDomainsHealth(): Promise<DomainHealth[]>

// Auto-operations (run automatically)
autoScaleIfNeeded(): Promise<AutoScaleResult[]>
autoResumeDomains(): Promise<string[]>
autoRecoverInboxes(): Promise<string[]>
runSystemHealthCheck(): Promise<HealthStatus>
autoHeal(): Promise<HealingAction[]>
learnAndOptimize(): Promise<OptimizationResult>
```

## Database Tables

- `domains` - Domain information (bounce rate, spam rate, status)
- `identities` - Email inboxes (one per domain, max 4 per domain)
- `events` - Email events (sent, bounce, spam, delivered, etc)
- `infrastructure_events` - System events (auto-scale, health checks, healing)

## Configuration Defaults

```typescript
// Per-inbox limit
MAX_EMAILS_PER_INBOX = 50 / day

// Per-domain limit (4 inboxes × 50 = 200 per day)
INBOXES_PER_DOMAIN = 4

// Health thresholds
MAX_BOUNCE_RATE = 0.05 (5%)
MAX_SPAM_RATE = 0.02 (2%)

// Cool-off periods
DOMAIN_PAUSE_DURATION = 24 hours
INBOX_UNAVAILABLE_DURATION = 30 minutes

// Check intervals
HEALTH_CHECK = 5 minutes
OPTIMIZATION = 1 hour
```

## Support

- 📖 Full docs: [README.md](./README.md)
- 🔧 Integration: [INTEGRATION_GUIDE.ts](./INTEGRATION_GUIDE.ts)
- ✅ Setup: [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md)
- 📝 Exports: [index.ts](./index.ts)

## Summary

You now have a **production-ready autonomous email infrastructure** that:

1. **Automatically scales** to meet demand
2. **Maintains reputation** with health monitoring
3. **Optimizes delivery** through intelligent distribution
4. **Recovers from failures** automatically
5. **Improves continuously** through learning

Simply call `coordinator.send()` and let the system handle the rest.

---

*Built with TypeScript, PostgreSQL, and autonomous optimization*
