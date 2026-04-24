# Infrastructure System Integration Guide

Complete guide for integrating and using the autonomous infrastructure system components.

## System Components

### 1. Core Infrastructure Coordinator
**File:** `lib/infrastructure.ts`

Manages the autonomous email sending infrastructure with:
- Domain provisioning and management
- Capacity scaling and optimization
- Health monitoring and auto-healing
- Load balancing and distribution strategies

**Key Methods:**
- `getState()` - Get current infrastructure state
- `pause(reason)` / `resume()` - Control sending
- `optimize()` - Run optimization pass
- `heal()` - Auto-fix detected issues
- `scale(targetCapacity, maxDomains)` - Scale infrastructure

### 2. Monitoring & Alerting
**File:** `lib/infrastructure-monitoring.ts`

Background monitoring service that:
- Continuously monitors infrastructure health
- Detects critical conditions
- Triggers alerts based on thresholds
- Maintains alert history

**Configuration:** `.env.infrastructure`

**Key Functions:**
- `startMonitoring(config)` - Start background monitoring
- `getAlerts(severity, limit)` - Retrieve alerts
- `getCriticalAlerts(minutesBack)` - Get critical alerts
- `getAlertSummary()` - Alert statistics
- `resolveAlert(alertId)` - Mark alert as resolved

### 3. Analytics & Insights
**File:** `lib/infrastructure-analytics.ts`

Generates insights from collected metrics:
- Per-domain performance analysis
- Capacity planning recommendations
- Performance pattern detection
- Health scoring and classification

**Key Functions:**
- `getMetricsSnapshot()` - Current metrics
- `getDomainAnalytics()` - Per-domain metrics
- `generateRecommendations()` - Smart suggestions
- `analyzePerformancePatterns()` - Load patterns
- `generateReport()` - Full analytics report

## API Endpoints

### Infrastructure Health
**GET** `/api/infrastructure/health`

Returns real-time health status:
```json
{
  "status": "running",
  "system": {
    "healthy": true,
    "capacityUtilization": 65,
    "issues": []
  },
  "metrics": {
    "domains": 5,
    "healthyDomains": 5,
    "emailsSent24h": 2500,
    "uptime": 99.5
  }
}
```

### Analytics & Insights
**GET** `/api/infrastructure/analytics?format=json|report&limit=50`

Returns detailed analytics:
```json
{
  "metrics": { ... },
  "domains": [ ... ],
  "performance": { ... },
  "recommendations": [ ... ]
}
```

**Formats:**
- `format=json` - JSON response (default)
- `format=report` - Text report for export

### Alerts Management
**GET** `/api/infrastructure/alerts?severity=critical|warning|info&limit=50&hoursBack=24`

Returns alerts matching filters:
```json
{
  "summary": { "total": 10, "critical": 2, ... },
  "alerts": [ ... ]
}
```

**POST** `/api/infrastructure/alerts/:id/resolve`

Mark alert as resolved.

**POST** `/api/infrastructure/alerts/cleanup`

Clear old alerts (send `X-Days-Old` header).

### Infrastructure Control
**GET** `/api/infrastructure/control`

Get current state:
```json
{
  "isPaused": false,
  "currentCapacity": 10000,
  "targetCapacity": 15000,
  "capacityUtilization": 65,
  "systemHealth": { ... }
}
```

**POST** `/api/infrastructure/control`

Execute control actions:
```json
{
  "action": "pause|resume|optimize|heal|scale",
  "options": {
    "reason": "string (for pause)",
    "targetCapacity": "number (for scale)",
    "maxDomains": "number (for scale)"
  }
}
```

## Configuration

**File:** `.env.infrastructure`

Key settings:
- `INFRASTRUCTURE_MAX_EMAILS_PER_INBOX=50` - Daily limit per inbox
- `INFRASTRUCTURE_INBOXES_PER_DOMAIN=4` - Inboxes to create per domain
- `INFRASTRUCTURE_TARGET_DAILY_VOLUME=50000` - Scaling trigger point
- `INFRASTRUCTURE_MAX_BOUNCE_RATE=0.05` - Critical bounce threshold
- `INFRASTRUCTURE_MAX_SPAM_RATE=0.02` - Critical spam threshold
- `INFRASTRUCTURE_AUTO_SCALING_ENABLED=true` - Enable auto-scaling
- `INFRASTRUCTURE_AUTO_HEALING_ENABLED=true` - Enable auto-healing
- `INFRASTRUCTURE_MONITORING_ENABLED=true` - Enable monitoring
- `INFRASTRUCTURE_ALERT_CAPACITY_CRITICAL=90` - Alert threshold (%)

## Usage Examples

### Check Infrastructure Health
```typescript
import { coordinator } from '@/lib/infrastructure'

const state = await coordinator.getState()
console.log(`Capacity: ${state.capacityUtilization}%`)
console.log(`Healthy: ${state.systemHealth.isHealthy}`)
```

### Get Metrics
```typescript
import { getMetricsSnapshot } from '@/lib/infrastructure-analytics'

const metrics = await getMetricsSnapshot()
console.log(`24h Volume: ${metrics.emailsSent24h}`)
console.log(`Uptime: ${metrics.uptime}%`)
```

### Get Recommendations
```typescript
import { generateRecommendations } from '@/lib/infrastructure-analytics'

const recs = await generateRecommendations()
recs.forEach(r => {
  console.log(`[${r.priority}] ${r.title}`)
  console.log(`  Action: ${r.action}`)
})
```

### Monitor Alerts
```typescript
import { getCriticalAlerts } from '@/lib/infrastructure-monitoring'

const critical = getCriticalAlerts(60) // Last 60 minutes
console.log(`Critical alerts: ${critical.length}`)
```

### Manual Control
```typescript
// Pause sending
await coordinator.pause('Manual intervention required')

// Resume sending
await coordinator.resume()

// Run optimization
const changes = await coordinator.optimize()

// Auto-heal issues
const actions = await coordinator.heal()

// Scale capacity
const scaling = await coordinator.scale(20000, 5) // 20k capacity, max 5 domains
```

## Monitoring Dashboard

The system includes a React dashboard component for real-time monitoring:

```tsx
import { InfrastructureDashboard } from '@/components/infrastructure-dashboard'

export default function Page() {
  return <InfrastructureDashboard />
}
```

**Features:**
- Real-time system status
- Capacity utilization graph
- Per-domain health metrics
- Alert summary and critical alerts
- Performance recommendations
- Auto-refresh (30-second intervals)
- Control buttons (pause/resume, optimize)

## Auto-Healing System

The infrastructure automatically detects and fixes issues:

1. **Orphan Cleanup** - Removes unused email addresses
2. **Inbox Rebalancing** - Distributes load evenly
3. **Rate Limit Throttling** - Reduces send rate when limited
4. **Domain Rotation** - Switches to healthier domains
5. **Capacity Scaling** - Provisions new domains when needed

All auto-healing actions are:
- Logged for audit trail
- Configurable per operation
- Alertable if failures occur
- Reversible where applicable

## Performance Considerations

### Monitoring Overhead
- Health checks: 5 minutes (configurable)
- Detailed analysis: 1 hour (configurable)
- Alert cleanup: Daily
- Minimal database impact

### Scaling Performance
- Automatic as capacity approaches 75%
- Can be triggered manually
- Respects domain limits to prevent overload
- Includes safety buffers

### Database Requirements
- Tracks events and metrics
- 30-day retention policy
- Indexes on domain_id, created_at
- Automatic old event cleanup

## Alerting Integration

### Alert Channels
Configure in `.env.infrastructure`:

```
INFRASTRUCTURE_ALERT_EMAIL=ops@example.com
INFRASTRUCTURE_SLACK_WEBHOOK_URL=https://...
INFRASTRUCTURE_PAGERDUTY_KEY=...
INFRASTRUCTURE_DATADOG_API_KEY=...
```

### Alert Types
- **Critical**: Immediate response required (capacity critical, all domains down)
- **Warning**: Monitor closely (capacity high, bounce rate elevated)
- **Info**: FYI (inboxes cooling, metrics snapshot)

### Alert Thresholds (Configurable)
- Capacity critical: 90%
- Capacity warning: 75%
- Bounce rate critical: 5%
- Spam rate critical: 2%
- Failures per hour: 10+

## Troubleshooting

### High Capacity Utilization
1. Check `getDomainAnalytics()` for unbalanced domains
2. Review `analyzePerformancePatterns()` for peak hours
3. Run `coordinator.scale()` to add capacity
4. Check `generateRecommendations()` for specific actions

### Low Delivery Rate
1. Check domain bounce/spam rates
2. Review `getAlerts()` for health issues
3. Check DNS/SPF/DKIM configuration
4. Review inbox warmup schedule for new domains

### Infrastructure Paused
1. Check pause reason in logs
2. Review critical alerts
3. Fix underlying issues
4. Run `coordinator.resume()` when ready

## Next Steps

1. **Deploy** - Add configuration to production environment
2. **Monitor** - Set up alert notifications
3. **Tune** - Adjust thresholds based on your patterns
4. **Integrate** - Connect to your alerting/logging platform
5. **Automate** - Use control API for advanced workflows

## API Clients

### JavaScript/TypeScript
```typescript
const health = await fetch('/api/infrastructure/health').then(r => r.json())
```

### cURL
```bash
curl http://localhost:3000/api/infrastructure/health
curl -X POST http://localhost:3000/api/infrastructure/control \
  -H "Content-Type: application/json" \
  -d '{"action":"optimize"}'
```

### Python
```python
import requests
response = requests.get('http://localhost:3000/api/infrastructure/health')
data = response.json()
```

## Support & Debugging

Enable debug logging:
```env
INFRASTRUCTURE_DEBUG=true
```

Export alerts for analysis:
```typescript
import { exportAlerts } from '@/lib/infrastructure-monitoring'
await exportAlerts('alerts-2024-01-15.json')
```

Generate comprehensive report:
```typescript
import { generateReport } from '@/lib/infrastructure-analytics'
const report = await generateReport()
console.log(report)
```
