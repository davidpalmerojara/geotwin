#!/bin/sh
set -eu
node apps/api/dist/db/cli.js migrate
if [ "${DEMO_MODE:-false}" = "true" ]; then
  node apps/api/dist/db/cli.js seed
fi
exec node apps/api/dist/server.js
