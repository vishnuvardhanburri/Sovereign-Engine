# Real Campaign Results

This document is where we publish real-world proof from a live campaign (not synthetic/demo data).

## Campaign Overview

- target: —
- volume (emails sent): —
- duration (days): —

## Results

- reply rate: —
- bounce rate: —
- positive replies: —
- meetings booked: — (optional; requires meeting tracking)

## System Behavior

- emails deferred: —
- domains protected: — actions
- risky sends avoided: —

## Insight

What we expect to see when this system is working as designed:

- the decision layer defers or slows risky sends instead of pushing volume
- bounces are reduced by filtering + safety routing before enqueue
- reply rate improves because the system controls **when and where** emails are sent (time windows + lanes)
- outcomes feed back into future decisions (A/B + outcome signals)

## How to Fill This From Production Data

1. Pick a campaign id.
2. Pull metrics (example SQL):

```sql
-- Replace campaign id (123) and time window as needed.
SELECT
  COUNT(*) FILTER (WHERE event_type = 'sent') AS sent,
  COUNT(*) FILTER (WHERE event_type = 'reply') AS replies,
  COUNT(*) FILTER (WHERE event_type = 'bounce') AS bounces
FROM events
WHERE client_id = 1 AND campaign_id = 123
  AND created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days');
```

3. Export decision + outcomes for proof (CSV/JSON):

- `GET /api/report/export?format=csv&campaignId=123`

