#!/usr/bin/env sh
set -eu

: "${LOG_ARCHIVE_S3_URI:?Set LOG_ARCHIVE_S3_URI, for example s3://xavira-orbit-logs/prod}"

SOURCE_DIR="${LOG_SOURCE_DIR:-/var/lib/docker/containers}"
RETENTION_DAYS="${LOG_ARCHIVE_AFTER_DAYS:-30}"
INTERVAL_SECONDS="${LOG_ARCHIVE_INTERVAL_SECONDS:-86400}"
STORAGE_CLASS="${LOG_ARCHIVE_STORAGE_CLASS:-DEEP_ARCHIVE}"

archive_once() {
  find "$SOURCE_DIR" -type f \( -name '*-json.log' -o -name '*-json.log.*' \) -mtime +"$RETENTION_DAYS" -print | while IFS= read -r file; do
    rel="$(echo "$file" | sed "s#^$SOURCE_DIR/##")"
    safe="$(echo "$rel" | tr '/:' '__')"
    tmp="/tmp/${safe}.gz"
    gzip -c "$file" > "$tmp"
    aws s3 cp "$tmp" "${LOG_ARCHIVE_S3_URI%/}/$rel.gz" --storage-class "$STORAGE_CLASS"
    rm -f "$tmp"
  done
}

while true; do
  archive_once
  sleep "$INTERVAL_SECONDS"
done
