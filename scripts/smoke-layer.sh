#!/bin/sh
# Uploads the SYNTHETIC LAZ fixture through the running stack and waits until its 3D Tiles are
# served. Usage: scripts/smoke-layer.sh [base URL, default http://localhost:8080]
set -eu
BASE="${1:-http://localhost:8080}"
FILE="$(dirname "$0")/../apps/worker/tests/fixtures/synthetic-laguna-duero.laz"
ATTRIBUTION="Nube%20SINT%C3%89TICA%20de%20prueba%20(no%20son%20datos%20medidos)"
RESPONSE=$(curl -sS --fail-with-body -F "file=@${FILE}" "${BASE}/api/layers?name=Smoke%20sint%C3%A9tico&attribution=${ATTRIBUTION}")
ID=$(printf '%s' "$RESPONSE" | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -n 1)
echo "Layer ${ID} queued"
i=0
while [ $i -lt 90 ]; do
  LAYER=$(curl -sS --fail "${BASE}/api/layers/${ID}")
  STATUS=$(printf '%s' "$LAYER" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')
  case "$STATUS" in
    ready) break ;;
    failed) echo "Layer failed: $LAYER"; exit 1 ;;
  esac
  i=$((i + 1))
  sleep 2
done
[ "$STATUS" = ready ] || { echo "Timed out: $LAYER"; exit 1; }
URL=$(printf '%s' "$LAYER" | sed -n 's/.*"tileset_url":"\([^"]*\)".*/\1/p')
echo "Ready: ${URL}"
echo "$LAYER"
curl -sS --fail -D - -o /dev/null "${BASE}${URL}" | grep -i -E '^(HTTP|content-type|cache-control|etag)'
curl -sS --fail -X DELETE "${BASE}/api/layers/${ID}" -o /dev/null -w 'DELETE %{http_code}\n'
