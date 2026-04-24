# APIs

## API Gateway

Runs in `apps/api-gateway` and exposes product APIs (contacts, campaigns, queue, etc).

## Validator API

Runs in `services/validator-engine`:

- `POST /validate`
- `POST /bulk-validate`

This API enqueues validation jobs and returns verdict + score when available.

## Optimizer

Read-only endpoints (safe by default):

- `GET /api/optimizer/state`
- `GET /api/optimizer/domain/:id`

Autonomous scheduler worker:

- `pnpm worker:optimizer` (requires `OPTIMIZER_ENABLED=true`)

## Tool API (external integrations)

Runs in `services/tool-api`:

- `POST /tool/validate`
- `POST /tool/send`
- `GET /tool/status`
- `GET /tool/domain-health?domainId=<id>`

Auth: provide `x-api-key` (or `Authorization: Bearer <key>`). Keys are configured via `TOOL_API_KEYS_JSON`.
