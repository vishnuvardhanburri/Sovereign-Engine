# Sovereign Mobile Console

The mobile console is a lightweight React Native shell for alerts and approvals.

Mobile scope:

- Domain health alerts.
- Emergency pause controls.
- Queue spike notifications.
- Worker outage alerts.
- Reputation degradation warnings.
- Executive KPI dashboard.
- Lightweight operational approvals.

Mobile apps never process queues, send mail, or store SMTP credentials. All state-changing actions are signed on-device and verified by the server before the backend writes Postgres or Redis state.
