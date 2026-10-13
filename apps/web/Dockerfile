FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --workspace @geotwin/web --workspace @geotwin/shared --include-workspace-root --cache /tmp/geotwin-npm-cache --no-audit --no-fund && rm -rf /tmp/geotwin-npm-cache
COPY . .
ARG VITE_CESIUM_ION_TOKEN=""
ENV VITE_CESIUM_ION_TOKEN=$VITE_CESIUM_ION_TOKEN
RUN npm run build -w @geotwin/shared && npm run build -w @geotwin/web
FROM nginxinc/nginx-unprivileged:1.28-alpine
ENV API_UPSTREAM=api:3001 NGINX_ENVSUBST_FILTER=API_UPSTREAM
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
