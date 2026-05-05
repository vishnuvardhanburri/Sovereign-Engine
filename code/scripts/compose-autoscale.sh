#!/usr/bin/env sh
set -eu

PROJECT="${COMPOSE_PROJECT_NAME:-sovereign-engine}"
COMPOSE_FILE="${COMPOSE_FILE:-/workspace/docker-compose.prod.yml}"
SERVICE="${AUTOSCALE_SERVICE:-sender-worker}"
MIN_REPLICAS="${SENDER_MIN_REPLICAS:-2}"
MAX_REPLICAS="${SENDER_MAX_REPLICAS:-24}"
CPU_HIGH="${AUTOSCALE_CPU_HIGH:-70}"
CPU_LOW="${AUTOSCALE_CPU_LOW:-25}"
MEM_HIGH="${AUTOSCALE_MEM_HIGH:-80}"
COOLDOWN_SECONDS="${AUTOSCALE_COOLDOWN_SECONDS:-120}"
INTERVAL_SECONDS="${AUTOSCALE_INTERVAL_SECONDS:-30}"
HEALTH_URL="${AUTOSCALE_HEALTH_URL:-http://api-gateway:3000/api/health/stats?client_id=1}"
TARGET_WAITING_PER_REPLICA="${AUTOSCALE_TARGET_WAITING_PER_REPLICA:-500}"
QUEUE_HIGH="${AUTOSCALE_QUEUE_HIGH:-1000}"
QUEUE_LOW="${AUTOSCALE_QUEUE_LOW:-25}"
SCALE_DOWN_IDLE_WINDOWS="${AUTOSCALE_SCALE_DOWN_IDLE_WINDOWS:-4}"
DRY_RUN="${AUTOSCALE_DRY_RUN:-false}"

idle_windows=0

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

json_log() {
  level="$1"
  message="$2"
  shift 2
  printf '{"ts":"%s","level":"%s","component":"sender-autoscaler","message":"%s"' "$(now_utc)" "$level" "$message"
  while [ "$#" -gt 1 ]; do
    key="$1"
    value="$2"
    shift 2
    case "$value" in
      ''|*[!0-9.]*)
        escaped="$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        printf ',"%s":"%s"' "$key" "$escaped"
        ;;
      *)
        printf ',"%s":%s' "$key" "$value"
        ;;
    esac
  done
  printf '}\n'
}

to_int() {
  printf '%s' "${1:-0}" | sed 's/%//g' | awk '{ if ($1 == "") print 0; else printf "%d", $1 }'
}

ceil_div() {
  numerator="$(to_int "$1")"
  denominator="$(to_int "$2")"
  if [ "$denominator" -le 0 ]; then
    echo 0
    return
  fi
  echo $(((numerator + denominator - 1) / denominator))
}

max_int() {
  if [ "$1" -ge "$2" ]; then echo "$1"; else echo "$2"; fi
}

current_replicas() {
  docker ps \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$SERVICE" \
    --format '{{.ID}}' | wc -l | tr -d ' '
}

stats_average() {
  ids="$(docker ps \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$SERVICE" \
    --format '{{.ID}}')"
  if [ -z "$ids" ]; then
    echo "0 0"
    return
  fi

  docker stats --no-stream --format '{{.CPUPerc}} {{.MemPerc}}' $ids | awk '
    { gsub("%","",$1); gsub("%","",$2); cpu += $1; mem += $2; n += 1 }
    END {
      if (n == 0) print "0 0";
      else printf "%d %d\n", cpu / n, mem / n;
    }'
}

health_snapshot() {
  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    echo "0 0 0 0 0"
    return
  fi

  body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  if [ -z "$body" ]; then
    echo "0 0 0 0 0"
    return
  fi

  printf '%s' "$body" | jq -r '
    [
      (if .ok == true then 1 else 0 end),
      ((.bullmq.waiting // 0) + (.bullmq.delayed // 0) + (.db_queue.waiting // 0) + (.db_queue.retry // 0)),
      ((.bullmq.active // 0) + (.db_queue.active // 0)),
      ((.bullmq.failed // 0) + (.db_queue.failed // 0)),
      (.workers.sender.active // 0)
    ] | @tsv
  ' 2>/dev/null || echo "0 0 0 0 0"
}

scale_to() {
  desired="$1"
  reason="$2"
  if [ "$DRY_RUN" = "true" ]; then
    json_log info "dry_run_scale" service "$SERVICE" desired "$desired" reason "$reason"
    return
  fi

  json_log info "scale" service "$SERVICE" desired "$desired" reason "$reason"
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-build --scale "$SERVICE=$desired" "$SERVICE"
}

while true; do
  replicas="$(current_replicas)"
  set -- $(stats_average)
  avg_cpu="$(to_int "$1")"
  avg_mem="$(to_int "$2")"
  set -- $(health_snapshot)
  health_ok="$(to_int "$1")"
  backlog="$(to_int "$2")"
  active_jobs="$(to_int "$3")"
  failed_jobs="$(to_int "$4")"
  live_workers="$(to_int "$5")"
  desired="$replicas"
  reason="steady"

  if [ "$replicas" -lt "$MIN_REPLICAS" ]; then
    desired="$MIN_REPLICAS"
    reason="below_min_replicas"
  elif [ "$avg_mem" -ge "$MEM_HIGH" ]; then
    desired=$((replicas + 1))
    reason="memory_guardrail"
  elif [ "$avg_cpu" -ge "$CPU_HIGH" ]; then
    desired=$((replicas + 1))
    reason="cpu_guardrail"
  elif [ "$health_ok" -eq 1 ] && { [ "$backlog" -ge "$QUEUE_HIGH" ] || [ "$(ceil_div "$backlog" "$TARGET_WAITING_PER_REPLICA")" -gt "$replicas" ]; }; then
    queue_desired="$(ceil_div "$backlog" "$TARGET_WAITING_PER_REPLICA")"
    desired="$(max_int "$((replicas + 1))" "$queue_desired")"
    reason="queue_backlog"
  elif [ "$health_ok" -eq 1 ] && [ "$backlog" -le "$QUEUE_LOW" ] && [ "$active_jobs" -eq 0 ] && [ "$avg_cpu" -le "$CPU_LOW" ] && [ "$replicas" -gt "$MIN_REPLICAS" ]; then
    idle_windows=$((idle_windows + 1))
    if [ "$idle_windows" -ge "$SCALE_DOWN_IDLE_WINDOWS" ]; then
      desired=$((replicas - 1))
      reason="sustained_idle"
      idle_windows=0
    fi
  else
    idle_windows=0
  fi

  if [ "$desired" -gt "$MAX_REPLICAS" ]; then desired="$MAX_REPLICAS"; fi
  if [ "$desired" -lt "$MIN_REPLICAS" ]; then desired="$MIN_REPLICAS"; fi

  json_log info "decision" \
    replicas "$replicas" \
    desired "$desired" \
    avg_cpu "$avg_cpu" \
    avg_mem "$avg_mem" \
    health_ok "$health_ok" \
    backlog "$backlog" \
    active_jobs "$active_jobs" \
    failed_jobs "$failed_jobs" \
    live_workers "$live_workers" \
    idle_windows "$idle_windows" \
    reason "$reason"

  if [ "$desired" != "$replicas" ]; then
    scale_to "$desired" "$reason"
    sleep "$COOLDOWN_SECONDS"
  else
    sleep "$INTERVAL_SECONDS"
  fi
done
