#!/bin/sh
# Uploads LAS/LAZ files through the API, one after another, and waits until each layer is ready.
# Usage: scripts/upload-layers.sh [-u BASE_URL] FILE.laz [FILE.laz ...]
#   BASE_URL defaults to http://localhost:8080 (Docker Compose); use http://localhost:3001 for
#   `npm run dev`. Files named PNOA_* get the PNOA-LiDAR attribution from the API itself.
# A file that is already loaded (409) is reported and skipped. Exits 1 if any layer fails.
set -eu
BASE="http://localhost:8080"
if [ "${1:-}" = "-u" ]; then
  BASE="$2"
  shift 2
fi
[ $# -gt 0 ] || { echo "Usage: $0 [-u BASE_URL] FILE.laz [FILE.laz ...]" >&2; exit 2; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p" | head -n 1; }
failed=0
for FILE in "$@"; do
  [ -f "$FILE" ] || { echo "$FILE: no existe" >&2; failed=1; continue; }
  NAME=$(basename "$FILE" | sed 's/\.[lL][aA][sSzZ]$//')
  START=$(date +%s)
  RESPONSE=$(curl -sS -w '\n%{http_code}' -F "file=@${FILE}" "${BASE}/api/layers") || {
    echo "$NAME: la subida falló" >&2
    failed=1
    continue
  }
  CODE=$(printf '%s' "$RESPONSE" | tail -n 1)
  BODY=$(printf '%s' "$RESPONSE" | sed '$d')
  case "$CODE" in
    201) ;;
    409) echo "$NAME: ya está cargada ($(field "$BODY" message))"; continue ;;
    *) echo "$NAME: HTTP $CODE $BODY" >&2; failed=1; continue ;;
  esac
  ID=$(field "$BODY" id)
  echo "$NAME: subida como ${ID}"
  while :; do
    LAYER=$(curl -sS --fail "${BASE}/api/layers/${ID}")
    STATUS=$(field "$LAYER" status)
    case "$STATUS" in
      ready)
        echo "$NAME: lista en $(($(date +%s) - START)) s, $(field "$LAYER" point_count) puntos"
        break
        ;;
      failed)
        echo "$NAME: error: $(field "$LAYER" error)" >&2
        failed=1
        break
        ;;
    esac
    sleep 3
  done
done
exit "$failed"
