#!/bin/sh
set -eu

enabled_flag() {
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '"'\'' ')"
  case "$value" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

mask_presence() {
  if [ -n "${1:-}" ]; then
    printf 'set'
  else
    printf 'missing'
  fi
}

int_between() {
  value="${1:-}"
  fallback="${2:-1}"
  min="${3:-1}"
  max="${4:-8}"
  case "$value" in
    ''|*[!0-9]*) value="$fallback" ;;
  esac
  if [ "$value" -lt "$min" ]; then
    value="$min"
  fi
  if [ "$value" -gt "$max" ]; then
    value="$max"
  fi
  printf '%s' "$value"
}

echo "[render-start] booting Sovereign Engine"
echo "[render-start] flags WEB_EMBED_SENDER_WORKER=${WEB_EMBED_SENDER_WORKER:-unset} WEB_EMBED_REPUTATION_WORKER=${WEB_EMBED_REPUTATION_WORKER:-unset} MOCK_SMTP=${MOCK_SMTP:-unset} EMAIL_PROVIDER=${EMAIL_PROVIDER:-smtp}"
echo "[render-start] secrets DATABASE_URL=$(mask_presence "${DATABASE_URL:-}") REDIS_URL=$(mask_presence "${REDIS_URL:-}") SMTP_HOST=$(mask_presence "${SMTP_HOST:-}") SMTP_ACCOUNTS=$(mask_presence "${SMTP_ACCOUNTS:-}")"

node scripts/sync-env.mjs
pnpm db:init

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  pnpm user:create "$BOOTSTRAP_ADMIN_EMAIL" "$BOOTSTRAP_ADMIN_PASSWORD"
fi

pnpm --dir apps/api-gateway exec tsx scripts/bootstrap-sending-domain.ts

if enabled_flag "${WEB_EMBED_REPUTATION_WORKER:-}"; then
  echo "[render-start] starting embedded reputation-worker"
  pnpm -C workers/reputation-worker start &
else
  echo "[render-start] embedded reputation-worker disabled"
fi

if enabled_flag "${WEB_EMBED_SENDER_WORKER:-}"; then
  sender_replicas="$(int_between "${WEB_EMBED_SENDER_WORKER_REPLICAS:-${SENDER_REPLICAS:-}}" 2 1 8)"
  worker_pg_pool_max="$(int_between "${SENDER_WORKER_PG_POOL_MAX:-${PG_POOL_MAX:-}}" 2 1 10)"
  echo "[render-start] starting embedded sender-worker replicas=${sender_replicas} concurrency=${SENDER_WORKER_CONCURRENCY:-10} worker_pg_pool_max=${worker_pg_pool_max}"
  i=1
  while [ "$i" -le "$sender_replicas" ]; do
    WORKER_ID="${RENDER_SERVICE_ID:-render}:${HOSTNAME:-host}:sender-${i}:$$" \
      PG_POOL_MAX="$worker_pg_pool_max" \
      pnpm -C workers/sender-worker start &
    i=$((i + 1))
  done
else
  echo "[render-start] embedded sender-worker disabled"
fi

echo "[render-start] starting api-gateway on port ${PORT:-3000}"
exec pnpm -C apps/api-gateway start -p "${PORT:-3000}"
