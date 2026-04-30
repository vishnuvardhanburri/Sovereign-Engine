#!/usr/bin/env sh
set -eu

PROJECT="${COMPOSE_PROJECT_NAME:-xavira-orbit}"
COMPOSE_FILE="${COMPOSE_FILE:-/workspace/docker-compose.prod.yml}"
SERVICE="${AUTOSCALE_SERVICE:-sender-worker}"
MIN_REPLICAS="${SENDER_MIN_REPLICAS:-2}"
MAX_REPLICAS="${SENDER_MAX_REPLICAS:-24}"
CPU_HIGH="${AUTOSCALE_CPU_HIGH:-70}"
CPU_LOW="${AUTOSCALE_CPU_LOW:-25}"
MEM_HIGH="${AUTOSCALE_MEM_HIGH:-80}"
COOLDOWN_SECONDS="${AUTOSCALE_COOLDOWN_SECONDS:-120}"
INTERVAL_SECONDS="${AUTOSCALE_INTERVAL_SECONDS:-30}"

to_int() {
  printf '%s' "$1" | sed 's/%//g' | awk '{printf "%d", $1}'
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

scale_to() {
  desired="$1"
  echo "[autoscale] scaling $SERVICE to $desired replicas"
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-build --scale "$SERVICE=$desired" "$SERVICE"
}

while true; do
  replicas="$(current_replicas)"
  set -- $(stats_average)
  avg_cpu="$(to_int "$1")"
  avg_mem="$(to_int "$2")"
  desired="$replicas"

  if [ "$replicas" -lt "$MIN_REPLICAS" ]; then
    desired="$MIN_REPLICAS"
  elif [ "$avg_cpu" -ge "$CPU_HIGH" ] || [ "$avg_mem" -ge "$MEM_HIGH" ]; then
    desired=$((replicas + 1))
  elif [ "$avg_cpu" -le "$CPU_LOW" ] && [ "$replicas" -gt "$MIN_REPLICAS" ]; then
    desired=$((replicas - 1))
  fi

  if [ "$desired" -gt "$MAX_REPLICAS" ]; then desired="$MAX_REPLICAS"; fi
  if [ "$desired" -lt "$MIN_REPLICAS" ]; then desired="$MIN_REPLICAS"; fi

  echo "[autoscale] replicas=$replicas desired=$desired avg_cpu=${avg_cpu}% avg_mem=${avg_mem}%"
  if [ "$desired" != "$replicas" ]; then
    scale_to "$desired"
    sleep "$COOLDOWN_SECONDS"
  else
    sleep "$INTERVAL_SECONDS"
  fi
done
