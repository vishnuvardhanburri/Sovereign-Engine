# Cross-Platform Security Hardening Checklist

## Shared Controls

- Device-bound session tracking with `device_id`, `platform`, app version, and session id.
- Short-lived access tokens with refresh-token rotation.
- Signed operational actions with nonce and UTC timestamp.
- Server-side action verification before any Redis or Postgres mutation.
- Tenant-scoped RBAC on every API route.
- Tamper-evident audit chain for privileged actions.
- No SMTP credentials, queue secrets, or worker credentials in desktop/mobile bundles.

## Realtime

- Require TLS in deployed environments.
- Require a realtime access token or gateway session binding.
- Treat WebSocket events as advisory and reconcile through REST.
- Reject unknown client ids, platforms, stale sessions, and malformed frames.
- Publish backend events through a server-only secret.

## Tauri Desktop

- Restrict IPC commands to safe UI operations.
- Disable shell/file-system permissions unless explicitly required.
- Set a strict content security policy.
- Store local tokens only in OS-backed secure storage.
- Code sign macOS and Windows packages.
- Notarize macOS artifacts before distribution.

## Mobile

- Use encrypted keychain/keystore persistence.
- Enable certificate pinning for production API hosts.
- Lock emergency controls behind biometric or device-auth confirmation.
- Use push notifications for alerts, not secrets.
- Verify app attestation signals where supported.

## Release and Operations

- Native signing keys live in protected CI secrets only.
- Release artifacts must include checksums.
- Rollback path must keep web control plane active even if native release is delayed.
- A compromised device session can be revoked centrally from the API gateway.
- Clients fail closed for privileged controls when offline.
