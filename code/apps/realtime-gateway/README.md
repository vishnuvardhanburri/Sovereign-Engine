# Sovereign Realtime Gateway

The realtime gateway streams operational events to web, desktop, and mobile consoles. It does not own queueing, sending, or reputation decisions.

Authoritative writes still go through the API gateway. Clients use WebSocket events for speed, then reconcile through REST responses from Postgres-backed routes.

```bash
pnpm -C apps/realtime-gateway dev
```
