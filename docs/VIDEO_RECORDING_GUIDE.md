# Sovereign Engine Video Recording Guide

This guide replaces any legacy recording flow that used the old product name.

## Prepare The Demo

```bash
pnpm demo:buyer
```

Open these tabs:

```text
http://localhost:3400/login
http://localhost:3400/reputation
http://localhost:3400/reputation?investor=1
http://localhost:3400/api/health/stats?client_id=1
```

## Record Four Clips

Save the clips under `output/video-clips/` with these exact base names:

```text
01-command-center-login-reputation.mp4
02-health-oracle-live-stats.mp4
03-10k-stress-proof-terminal.mp4
04-roi-handoff-summary.mp4
```

Optional screenshots can use the same names with `.png`.

If you want a fast generated clip pack before recording your own Loom/OBS
voiceover, run:

```bash
pnpm demo:clips
```

This renders fresh Sovereign Engine branded screenshots and short MP4/WebM
clips locally. It uses `.demo/clipgen-venv` for generation dependencies so the
global Python install stays clean.

## Terminal Clip Command

Run this when recording the stress proof clip:

```bash
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

If the recording machine is small:

```bash
STRESS_COUNT=1000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

## Package Fresh Clips

After recording fresh Sovereign Engine clips:

```bash
pnpm demo:package
```

Output:

```text
output/video-clips/sovereign-engine-demo-clips.zip
output/video-clips/SOVEREIGN_ENGINE_VIDEO_MANIFEST.md
```

The packager excludes files with legacy brand names in their filenames and refuses to create the bundle if the recommended MP4 clips are missing.
