# Enterprise QA Report

Generated: 2026-05-11

Scope: local macOS validation against the Docker production stack at `http://127.0.0.1:3400`.

## Executive Result

- Acquisition demo readiness: GO
- Mock-safe due diligence readiness: GO
- Real production go-live: CONDITIONAL GO after long-duration and physical-device labs
- Production readiness score from executed local gates: 100/100
- Reliability confidence from executed local gates: 100/100

## Validated Layers

- API gateway build and TypeScript validation.
- Next.js production build.
- Docker production compose config.
- Postgres schema, demo user, and reputation tables.
- Redis health and queue health.
- Sender worker heartbeat and concurrency reporting.
- Web dashboard routes.
- Browser QA screenshots.
- Shared platform SDK.
- WebSocket realtime gateway syntax and security transport guard.
- Tauri desktop shell scaffold.
- React Native mobile shell scaffold.
- Buyer-safe copy and brand gates.
- Public Reputation API missing-key rejection.
- Redis restart chaos recovery.

## Key Evidence

- `pnpm launch:ready --quick`: PASS.
- `pnpm doctor:demo --json --compose-file=docker-compose.prod.yml`: 31 passed, 0 failed.
- `pnpm qa:demo`: PASS, screenshots written to `code/output/playwright/demo-qa`.
- `pnpm qa:enterprise -- --chaos`: 27 passed, 0 failed.
- `NEXT_TELEMETRY_DISABLED=1 pnpm build`: PASS.
- `STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:prod`: 10,000 mock sends, 0 failed.

## Stress Proof

Latest production-stack mock proof:

- Count: 10,000.
- Failures: 0.
- Setup elapsed: 1.547s.
- Processing elapsed: 47.639s.
- Total elapsed: 49.186s.
- Throughput: 203.31/sec.
- Active sender workers: 2.
- Total sender concurrency: 100.

Previous corrected-port proof:

- Count: 10,000.
- Failures: 0.
- Total elapsed: 38.948s.
- Throughput: 256.75/sec.

## Findings Fixed During QA

- Doctor false negative: `doctor:demo` previously checked the default compose stack after the production stack was launched. Fixed with `--compose-file` and `DOCTOR_COMPOSE_FILE` support.
- WebSocket token exposure risk: realtime SDK previously transported access tokens in URL query params. Fixed by moving token transport to a WebSocket subprotocol.
- Stress command runbook gap: `pnpm stress:test` assumes host ports. Added `pnpm stress:prod`, which discovers production Docker ports before running the stress proof.

## Remaining Boundaries

These were not executed locally and must be completed before claiming full enterprise production certification:

- 24h sustained load.
- 72h memory leak detection.
- Windows installer execution.
- Linux native package execution.
- Android physical-device battery and notification validation.
- iOS TestFlight/certificate-pinning validation.
- macOS notarization with production Developer ID.
- Real SMTP/ESP go-live using buyer-owned credentials, DNS, consent data, suppression policy, and provider limits.

## Go / No-Go

GO for Acquire.com demo, buyer walkthrough, mock-safe due diligence, and controlled technical review.

NO-GO for claiming fully validated live enterprise production until the remaining long-duration, native-device, signing, and real-provider validation labs are completed.
