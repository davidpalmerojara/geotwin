# Build the TypeScript worker with Node, run it on a Python image that has the conversion
# toolchain (laspy + lazrs, pyproj, py3dtiles), with the Node binary copied in.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --workspace @geotwin/worker --workspace @geotwin/shared --workspace @geotwin/storage --include-workspace-root --cache /tmp/geotwin-npm-cache --no-audit --no-fund && rm -rf /tmp/geotwin-npm-cache
COPY . .
RUN npm run build -w @geotwin/shared -w @geotwin/storage && npm run build -w @geotwin/worker && npm prune --omit=dev --workspace @geotwin/worker --workspace @geotwin/shared --workspace @geotwin/storage --include-workspace-root

FROM python:3.12-slim-bookworm
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY apps/worker/python/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/lidar && /opt/lidar/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
  && rm /tmp/requirements.txt && useradd --create-home --uid 10001 worker
ENV NODE_ENV=production LIDAR_PYTHON=/opt/lidar/bin/python \
  LIDAR_SCRIPT=/app/apps/worker/python/geotwin_lidar.py \
  NUMBA_CACHE_DIR=/tmp/numba PROJ_NETWORK=OFF
COPY --from=build --chown=worker /app/node_modules ./node_modules
COPY --from=build --chown=worker /app/package*.json ./
COPY --from=build --chown=worker /app/packages/shared ./packages/shared
COPY --from=build --chown=worker /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=build --chown=worker /app/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=worker /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=worker /app/apps/worker/dist ./apps/worker/dist
COPY --chown=worker apps/worker/python/geotwin_lidar.py ./apps/worker/python/geotwin_lidar.py
RUN mkdir -p /app/data/storage && chown worker /app/data /app/data/storage
USER worker
CMD ["node", "apps/worker/dist/main.js"]
