# Outcome-Grade Send Gate

Goal: make the outbound engine credible for buyer demos and safer for real revenue work by preventing guessed role inboxes from being auto-approved without delivery evidence.

## Tasks

1. Add failing tests proving `sales@`, `opportunity@`, and Google Maps imported role inboxes require Hunter-valid or exact public email evidence before approval/queueing.
2. Harden the shared prospect research policy so daily cron, manual approval cleanup, and queue blockers use the stricter validation list.
3. Verify with targeted prospect research tests, typecheck/build checks, and live health checks before pushing.

## Why This Matters

Recent Resend results show some guessed role inboxes bounce after being accepted by our approval flow. This patch moves that learning before send time, which protects the domains and makes the product more defensible.
