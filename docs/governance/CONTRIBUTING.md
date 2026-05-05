# Contributing

## Development

1. Install deps
```bash
pnpm install
```

2. Start local infra
```bash
docker compose up -d
```

3. Configure env
```bash
cp .env.example .env
```

4. Init DB + run
```bash
pnpm db:init
pnpm dev -p 3000
```

## Pull Requests

- Keep changes small and scoped.
- No secrets in code, docs, or tests.
- Prefer additive changes with safe fallbacks (behavior unchanged when flags are off).
- Include a short verification note (what you tested).

