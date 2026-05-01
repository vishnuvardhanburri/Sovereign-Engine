# Sovereign Engine Docs

## Core

- `architecture.md`: System boundaries and repo layout
- `flow.md`: Request and processing flow
- `api.md`: API overview (gateway + validator)
- `BUYER_DEMO_GUIDE.md`: Five-minute mock-safe buyer demo flow
- `TECHNICAL_PROOF_CHECKLIST.md`: Build, proof, and due-diligence checks
- `VIDEO_RECORDING_GUIDE.md`: Clip names, recording flow, and packaging
- `PRODUCTION_SUBMISSION_CHECKLIST.md`: Final handoff checklist

## Buyer-Facing Dashboard Routes

- `/dashboard`: Buyer Demo Kit, readiness score, due-diligence PDF export, and Worker Live Map
- `/setup`: Production readiness and DNS verification center
- `/proof`: Recording-ready proof board for health, workers, readiness, scale commands, and diligence downloads
- `/limits`: Known limits and production-gate explanation for serious buyers
- `/activity`: System activity replay across reputation, delivery, and audit events
- `/raas`: Reputation-as-a-Service developer console
- `/demo-import`: Safe sample CSV import flow
- `/handoff`: Buyer handoff and deployment command center with data-room downloads

## Proof Endpoints

- `/api/health/stats`: DB/Redis latency, queue depth, worker heartbeats, delivery latency, and resource trends
- `/api/setup/readiness?domain=example.com`: production readiness JSON with suggested DNS records
- `/api/setup/report?domain=example.com`: printable readiness report
- `/api/due-diligence/report?domain=example.com`: downloadable buyer due-diligence PDF
- `/api/handoff/data-room?domain=example.com`: downloadable buyer data-room ZIP
- `/api/production/gate?domain=example.com`: demo-ready versus production-ready gate status
- `/api/demo/recording/prepare`: one-click safe recording preparation

## Local QA Commands

- `pnpm doctor:demo`: checks Docker, Postgres, Redis, env, schema, demo user, key pages, PDF/ZIP, and worker heartbeat
- `pnpm qa:demo`: browser QA with screenshots under `output/playwright/demo-qa`
- `pnpm submit:pack`: exports final evidence under `output/submit-pack`

## Legacy (historical)

The `legacy/` folder contains earlier internal notes and guides that are still useful as reference, but are not the canonical architecture docs.
