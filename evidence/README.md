# Evidence (Buyer Proof)

This folder contains committed, buyer-safe proof artifacts and repeatable test/run instructions.

Committed evidence:

- `SCORECARD_100.md`: 100/100 buyer proof scorecard
- `ENTERPRISE_QA_REPORT.md`: enterprise QA and chaos validation summary
- `ENTERPRISE_UX_READINESS.md`: enterprise realtime UX readiness summary

Generated (not committed) evidence is written under:

- `code/output/launch-ready/latest` (one-command launch readiness evidence)
- `code/output/submit-pack/*` (submission/evidence bundle)
- `code/output/data-room/*` (data room folder + ZIP)

## One-Command Proof (Recommended)

```bash
pnpm launch:ready --quick
```

## Stress Proof (Mock-Safe)

```bash
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

## Data Room ZIP

```bash
pnpm generate:data-room
ls -lt code/output/data-room/*.zip | head -n 3
```
