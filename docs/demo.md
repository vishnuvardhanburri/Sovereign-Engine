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

