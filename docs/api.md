# APIs

## API Gateway

Runs in `apps/api-gateway` and exposes product APIs (contacts, campaigns, queue, etc).

## Validator API

Runs in `services/validator-engine`:

- `POST /validate`
- `POST /bulk-validate`

This API enqueues validation jobs and returns verdict + score when available.

