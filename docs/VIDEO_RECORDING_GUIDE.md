# Sovereign Engine Video Recording Guide

This guide replaces any legacy recording flow that used the old product name.

## Clean Start Proof (5 seconds)

Before you start the demo, record this in the terminal:

```bash
docker ps
```

The goal is simple: show the buyer the infra is not “already running” before you begin.

## Prepare The Demo

```bash
pnpm demo:buyer
```

Open these tabs (recommended order for buyer psychology):

```text
http://localhost:3400/login
http://localhost:3400/dashboard
http://localhost:3400/proof
http://localhost:3400/reputation
http://localhost:3400/reputation?investor=1
http://localhost:3400/api/health/stats?client_id=1
```

## Record Four Clips

Save the clips under `code/output/video-clips/` with these exact base names:

```text
01-login-dashboard-hook.mp4
02-proof-board-health-credibility.mp4
03-10k-stress-proof-system-reacting.mp4
04-data-room-zip-close.mp4
```

Optional screenshots can use the same names with `.png`.

Final combined export name:

```text
sovereign_engine_enterprise_acquisition_demo.mp4
```

If you want a fast generated clip pack before recording your own Loom/OBS
voiceover, run:

```bash
pnpm demo:clips
```

This renders fresh Sovereign Engine branded screenshots and short MP4/WebM
clips locally. It uses `.demo/clipgen-venv` for generation dependencies so the
global Python install stays clean.

## One Line To Say (Buyer-Safe)

Say this once early in the demo (dashboard or proof board):

```text
This is mock-safe validation, but the architecture is designed for production-scale deployment on real infrastructure.
```

## Terminal Clip Command

Run this when recording the stress proof clip:

```bash
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

If the recording machine is small:

```bash
STRESS_COUNT=1000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

## Stress Clip “Money Moment” (Show The System Reacting)

While the stress command is running in the terminal, switch to:

- `/proof`: zoom into queue depth + worker heartbeat tiles (shows the system working, not just a CLI loop).
- `/reputation?investor=1`: show the lane grid + brain feed + ramp visuals updating.

## Package Fresh Clips

After recording fresh Sovereign Engine clips:

```bash
pnpm demo:package
```

Output:

```text
code/output/video-clips/sovereign-engine-demo-clips.zip
code/output/video-clips/SOVEREIGN_ENGINE_VIDEO_MANIFEST.md
```

The packager excludes files with legacy brand names in their filenames and refuses to create the bundle if the recommended MP4 clips are missing.

## Data Room Close (Trust + Closure)

When you show the ZIP, say:

```text
This includes full architecture, deployment, and due diligence artifacts—so buyers can evaluate without back-and-forth.
```

And show the newest ZIP in terminal:

```bash
ls -lt code/output/data-room/*.zip | head -n 3
```
