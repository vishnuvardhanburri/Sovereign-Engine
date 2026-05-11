# Cross-Platform Release Pipeline

## Web

- Build and deploy `code/apps/api-gateway`.
- Keep the Next.js dashboard as the primary web control plane.
- Route API, health, reputation, setup, and handoff endpoints through the centralized gateway.

## Desktop

- Package `code/apps/desktop-console` with Tauri.
- macOS: sign with Developer ID, notarize, staple ticket, publish DMG.
- Windows: sign MSI with an EV/OV code-signing certificate.
- Linux: publish `.deb` and AppImage artifacts.

## Mobile

- Package `code/apps/mobile-console` through Expo EAS or native CI lanes.
- Android: generate signed AAB/APK and publish through a controlled track.
- iOS: archive, sign, notarize through Apple tooling, and submit to TestFlight/App Store.

## Shared SDK

- Validate `@sovereign/platform-sdk` before native builds.
- Keep API route names, realtime event names, and action schemas backward compatible.
- Version SDK releases alongside API gateway deploys.

## Release Evidence

Every release should produce:

- Git SHA and build timestamp.
- Platform artifact checksums.
- `pnpm platform:check` output.
- API gateway health snapshot.
- Data-room evidence pack when prepared for diligence.
