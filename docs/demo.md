# Demo

This demo flow is designed to show proof, safety, and explainability in minutes.

## 1) Live System Health

**Endpoint**

`GET /api/system/health`

**Example**

```bash
curl -s "http://localhost:3000/api/system/health" | jq
```

**What it shows**

- send rate (per min/hour)
- bounce/reply rates (24h/7d)
- queue lag
- domain health summary
- reliability metrics (idempotency hits, duplicate prevention, retries, drift signals)

**Example output (redacted)**

```json
{
  "ok": true,
  "clientId": 1,
  "time": "2026-04-24T10:12:18.014Z",
  "baseUrl": "http://localhost:3000",
  "rates": {
    "send_rate_per_min": 2,
    "send_rate_per_hour": 41,
    "bounce_rate_24h": 0.0122,
    "reply_rate_24h": 0.0341,
    "bounce_rate_7d": 0.0158,
    "reply_rate_7d": 0.0287
  },
  "queue": {
    "queue_lag_ms": 42000,
    "oldest_scheduled_at": "2026-04-24T10:13:00.000Z"
  },
  "domains": {
    "total": 2,
    "paused": 0,
    "avg_health_score": 86.25
  }
}
```

## 2) Campaign Demo View (Human-readable)

**Endpoint**

`GET /api/demo/campaign/:id`

**Example**

```bash
curl -s "http://localhost:3000/api/demo/campaign/123" | jq
```

**What it shows**

- emails sent vs deferred vs dropped
- domain protection actions
- top performing hours (reply-driven)
- A/B lift summary when available

**Example output (redacted)**

```json
{
  "ok": true,
  "campaignId": 123,
  "name": "Outbound Test",
  "kpis": {
    "sent": 318,
    "deferred": 57,
    "dropped": 9,
    "bestHour": 11,
    "bestHourReplyRate": 0.043,
    "ab": {
      "baseline": { "sent": 152, "replies": 4, "bounces": 2, "replyRate": 0.0263 },
      "treatment": { "sent": 166, "replies": 7, "bounces": 1, "replyRate": 0.0422 },
      "lift": 0.604
    }
  },
  "summary": [
    "Outbound Test: 318 sent, 57 deferred, 9 dropped.",
    "Top performing hour (7d): 11:00 with reply rate 4.3%.",
    "A/B reply lift: 60.4% (treatment 4.2% vs baseline 2.6%).",
    "Domain protection actions (last 20):"
  ]
}
```

## 3) Proof Report (Baseline vs Treatment)

**Endpoint**

`GET /api/report/campaign/:id`

**Example**

```bash
curl -s "http://localhost:3000/api/report/campaign/123" | jq
```

**What it shows**

- baseline vs treatment performance
- reply lift %
- bounce reduction %
- experiment maturity gating (insufficient data vs statistically meaningful)

**Example output (redacted)**

```json
{
  "ok": true,
  "campaignId": 123,
  "experiment": {
    "status": "mature",
    "min_sends_per_group": 200,
    "min_replies_total": 20
  },
  "baseline": {
    "sends": 420,
    "replies": 11,
    "bounces": 8,
    "reply_rate": 0.0262,
    "bounce_rate": 0.0190
  },
  "treatment": {
    "sends": 438,
    "replies": 18,
    "bounces": 5,
    "reply_rate": 0.0411,
    "bounce_rate": 0.0114
  },
  "delta": {
    "reply_lift": 0.568,
    "bounce_reduction": 0.402
  }
}
```
