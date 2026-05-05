# Sovereign Engine Docs

## Core

- `architecture.md`: System boundaries and repo layout
- `OPERATING_GUIDE.md`: Production operating guide (one-command start + ramp + scaling proof)
- `demo.md`: buyer demo video, proof flow, and acquisition walkthrough
- `demo.html`: clean video page for GitHub Pages-style viewing
- `compliance/README.md`: SOC2-oriented compliance mapping (not a certification claim)
- `threat-model/README.md`: Threat model summary for due diligence
- `governance/`: license, security policy, and contribution notes
- `acquisition/HOMEPAGE_COPY.md`: revenue-protection homepage and founder/CTO narrative
- `acquisition/ACQUIRE_LISTING_COPY.md`: Acquire.com listing copy
- `acquisition/FAQ.md`: buyer FAQ with safe claim boundaries
- `acquisition/BUYER_REPLY_SYSTEM.md`: initial reply, data-room reply, negotiation reply, and close scripts
- `acquisition/PRICE_STRATEGY.md`: listing range, target close range, and negotiation anchors
- `acquisition/QUEUE_SCALING_PROOF.md`: queue system and 10,000 event proof narrative
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
- `/trust`: Enterprise trust center for safe claims, production-gate boundaries, and buyer-required inputs
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
- `/api/trust/summary?domain=example.com`: machine-readable trust certificate and safe buyer claims
- `/demo/metrics`: synthetic 10,000-event proof metrics for acquisition demos
- `/api/v1/license/validate`: demo license validation endpoint for monetization diligence
- `/api/v1/api-keys`: demo API-key issue/list endpoint
- `/api/demo/recording/prepare`: one-click safe recording preparation

## Local QA Commands

- `pnpm deploy:production`: starts services and verifies health metrics
- `pnpm demo:investor`: opens reputation dashboard, live metrics, and worker-scaling proof
- `pnpm generate:data-room`: exports acquisition data room under `code/output/data-room`
- `pnpm launch:ready`: one-command launch/submission readiness check with production Docker stack and evidence logs
- `pnpm launch:stop`: stops the launched production Docker stack
- `pnpm launch:ready --with-browser`: same flow with browser QA screenshots
- `pnpm launch:ready --with-build`: same flow with an additional local production build
- `pnpm launch:ready --with-typecheck`: same flow with an additional local TypeScript pass
- `pnpm doctor:demo`: checks Docker, Postgres, Redis, env, schema, demo user, key pages, PDF/ZIP, and worker heartbeat
- `pnpm qa:demo`: browser QA with screenshots under `code/output/playwright/demo-qa`
- `pnpm copy:check`: guards buyer-facing surfaces from risky or misleading acquisition language
- `pnpm submit:pack`: exports final evidence under `code/output/submit-pack`

## Legacy (historical)

The `legacy/` folder contains earlier internal notes and guides that are still useful as reference, but are not the canonical architecture docs.
