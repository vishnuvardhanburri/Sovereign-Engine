# Request Flow

```text
Lead
 → Validator API
 → Decision Engine
 → Send Queue
 → Sender Worker
 → SMTP Provider
 → Tracking Engine
 → Reputation Engine
```

## Notes

- Validation results are persisted and cached.
- Unknown verdicts defer instead of sending.
- Risky / catch-all traffic is routed to stricter lanes.

