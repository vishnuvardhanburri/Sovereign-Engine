#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() {
  printf "\033[1;34m[setup]\033[0m %s\n" "$*"
}

warn() {
  printf "\033[1;33m[setup]\033[0m %s\n" "$*"
}

fail() {
  printf "\033[1;31m[setup]\033[0m %s\n" "$*" >&2
  exit 1
}

random_hex() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null \
    || openssl rand -hex 32
}

command -v node >/dev/null 2>&1 || fail "Node.js 22+ is required. Install Node, then run ./setup.sh again."
command -v docker >/dev/null 2>&1 || warn "Docker not found. setup.sh will still install dependencies, but Postgres/Redis must already be running."

if ! command -v pnpm >/dev/null 2>&1; then
  info "Enabling pnpm via Corepack"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9.0.0 --activate
  else
    npm install -g corepack
    corepack enable
    corepack prepare pnpm@9.0.0 --activate
  fi
fi

if [ ! -f .env ]; then
  info "Creating .env with safe local defaults"
  AUTH_SECRET_VALUE="$(random_hex)"
  CRON_SECRET_VALUE="$(random_hex)"
  KILL_SWITCH_VALUE="$(random_hex)"
  cat > .env <<EOF
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/xavira_orbit?sslmode=disable
REDIS_URL=redis://127.0.0.1:6379
CONTAINER_DATABASE_URL=postgresql://postgres:password@postgres:5432/xavira_orbit?sslmode=disable
CONTAINER_REDIS_URL=redis://redis:6379

APP_DOMAIN=localhost:3000
APP_PROTOCOL=http
DEFAULT_CLIENT_ID=1
XV_REGION=local

AUTH_SECRET=${AUTH_SECRET_VALUE}
CRON_SECRET=${CRON_SECRET_VALUE}
SECURITY_KILL_SWITCH_TOKEN=${KILL_SWITCH_VALUE}

# Safe demo mode. Set MOCK_SMTP=false and fill real SMTP only after DNS/authentication is ready.
MOCK_SMTP=true
MOCK_SMTP_FASTLANE=false
SMTP_HOST=mock.local
SMTP_PORT=587
SMTP_USER=mock@localhost
SMTP_PASS=mock
SMTP_SECURE=false
ZEROBOUNCE_API_KEY=mock

SEND_ALLOW_UNKNOWN_VALIDATION=true
GLOBAL_SENDS_PER_MINUTE=120
GLOBAL_SHAPER_RATE_PER_SEC=2
GLOBAL_SHAPER_BURST=10
WORKER_HEARTBEAT_INTERVAL_MS=15000
ADAPTIVE_REDIS_PEERS=
REPUTATION_PUBLIC_API_KEY=
PUBLIC_REPUTATION_FREE_DAILY_LIMIT=10
PUBLIC_REPUTATION_PRO_DAILY_LIMIT=1000
PUBLIC_REPUTATION_ENTERPRISE_DAILY_LIMIT=100000
PUBLIC_REPUTATION_BLACKLIST_CACHE_SEC=21600
INVESTOR_LEAD_VALUE_USD=0.5
COST_PER_SEND=0.002

# Local-only content mutation. Disabled by default.
CONTENT_MUTATION_ENABLED=false
CONTENT_MUTATION_ENDPOINT=http://127.0.0.1:11434/api/generate
CONTENT_MUTATION_MODEL=llama3:8b
CONTENT_MUTATION_POOL_SIZE=500
CONTENT_MUTATION_FILL_PER_LOCK=500
CONTENT_MUTATION_TIMEOUT_MS=12000
CONTENT_MUTATION_POOL_TTL_SEC=86400
EOF
else
  info ".env already exists; keeping your current secrets and settings"
fi

if command -v docker >/dev/null 2>&1; then
  info "Starting local Postgres + Redis"
  docker compose up -d postgres redis
fi

info "Installing workspace dependencies"
pnpm install

info "Applying database schema"
pnpm db:init

SETUP_USER_EMAIL="${SETUP_USER_EMAIL:-demo@xavira.local}"
SETUP_USER_PASSWORD="${SETUP_USER_PASSWORD:-Demo1234!}"
info "Creating demo user ${SETUP_USER_EMAIL}"
pnpm user:create "$SETUP_USER_EMAIL" "$SETUP_USER_PASSWORD"

cat <<EOF

Xavira Orbit is ready.

Local app:
  pnpm dev -p 3000

Workers:
  pnpm worker:reputation
  pnpm worker:sender

Production Compose:
  docker compose -f docker-compose.prod.yml up -d --build --scale sender-worker=2

Final production handoff:
  cp configs/env/.env.production.example .env
  pnpm prod:check
  pnpm prod:check:real

Optional local content AI:
  docker compose -f docker-compose.prod.yml --profile content-ai up -d ollama ollama-pull
  CONTENT_MUTATION_ENABLED=true CONTENT_MUTATION_ENDPOINT=http://ollama:11434/api/generate docker compose -f docker-compose.prod.yml up -d --scale sender-worker=2

Scale proof without real email:
  MOCK_SMTP=true MOCK_SMTP_FASTLANE=true SENDER_WORKER_CONCURRENCY=50 pnpm worker:sender
  STRESS_COUNT=500 STRESS_TIMEOUT_MS=60000 pnpm stress:test
  # Run STRESS_COUNT=10000 on the final VPS/cloud box as the buyer-facing capacity proof.

Login:
  ${SETUP_USER_EMAIL}
  ${SETUP_USER_PASSWORD}
EOF
