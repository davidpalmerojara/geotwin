FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --workspace @geotwin/api --workspace @geotwin/shared --workspace @geotwin/storage --include-workspace-root --cache /tmp/geotwin-npm-cache --no-audit --no-fund && rm -rf /tmp/geotwin-npm-cache
COPY . .
RUN npm run build -w @geotwin/shared -w @geotwin/storage && npm run build -w @geotwin/api && npm prune --omit=dev --workspace @geotwin/api --workspace @geotwin/shared --workspace @geotwin/storage --include-workspace-root
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/packages/shared ./packages/shared
COPY --from=build --chown=node:node /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=build --chown=node:node /app/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node database ./database
# Local storage driver writes here (mounted as a volume in Compose).
RUN mkdir -p /app/data/storage && chown node:node /app/data /app/data/storage
USER node
EXPOSE 3001
COPY --chown=node:node apps/api/entrypoint.sh /app/entrypoint.sh
CMD ["sh", "/app/entrypoint.sh"]
