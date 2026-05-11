# Sovereign Desktop Console

The desktop console is a Tauri operational shell for macOS, Windows, and Linux.

It is intentionally control-plane only:

- Reads reputation state through the API gateway.
- Streams WebSocket events from the realtime gateway.
- Sends signed pause/resume/approval requests to the API gateway.
- Stores encrypted local session state in the native secure store once packaging dependencies are installed.
- Never embeds Redis, BullMQ, SMTP, sender-worker, or queue orchestration logic.

Release targets are defined in `src-tauri/tauri.conf.json`.
