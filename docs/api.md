# API REST y eventos

Swagger UI: `/api/docs/`. Contrato OpenAPI: `/api/openapi.json`. Las fechas se transportan en ISO 8601, con zona horaria. La API de esta demo usa una organización fija y no requiere login.

| Método / ruta                    | Entrada                                              | Resultado                                              |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `GET /api/health`                | —                                                    | PostgreSQL real, versión PostGIS, modos demo/simulador |
| `GET /api/dashboard/summary`     | `installation_id?` UUID                              | Conteos y tendencia de 30 min                          |
| `GET /api/organization`          | —                                                    | Organización de la demo y su región (nombre de lugar)  |
| `GET /api/installations`         | —                                                    | Instalaciones, coordenadas y número de activos         |
| `GET /api/assets`                | `installation_id?`, `status?`, `search?` (literal)   | Lista de activos                                       |
| `GET /api/assets/nearby`         | `lat`, `lng`, `radius?`                              | Activos y `distance_m`, ordenados por distancia        |
| `GET /api/assets/:id`            | UUID                                                 | Detalle del activo                                     |
| `PATCH /api/assets/:id`          | `{ "name": "Pump 01 · Revisada" }`                   | Activo actualizado; emite `asset:updated`              |
| `GET /api/assets/:id/readings`   | `sensor_id?`, `limit?`                               | Últimas `limit` lecturas, orden temporal ascendente    |
| `GET /api/sensors`               | `asset_id?`                                          | Sensores, umbrales y última lectura                    |
| `GET /api/alerts`                | `asset_id?`, `installation_id?`, `status?`, `limit?` | Incidencias activas/resueltas                          |
| `GET /api/alerts/:id`            | UUID                                                 | Detalle sincronizado de una incidencia                 |
| `POST /api/alerts`               | `asset_id`, `severity`, `message`                    | Incidencia manual persistida; 201                      |
| `PATCH /api/alerts/:id/resolve`  | Sin cuerpo                                           | Incidencia resuelta, idempotente                       |
| `POST /api/demo/anomalies`       | `sensor_id`, `mode`                                  | Lectura inmediata e incidencia; 201; solo demo         |
| `GET /api/docs`                  | —                                                    | Swagger UI (redirección a `/api/docs/`)                |
| `GET /api/layers`                | —                                                    | Capas LiDAR, de la más reciente a la más antigua       |
| `POST /api/layers`               | multipart `file` (LAS/LAZ) + opciones en la query    | Capa en cola; 201. 409, 413 o 415 si no se acepta      |
| `GET /api/layers/limits`         | —                                                    | Formatos aceptados y límite de subida en bytes         |
| `GET /api/layers/:id`            | UUID                                                 | Estado, progreso y metadatos de la capa                |
| `POST /api/layers/:id/reprocess` | `{ "geoid_offset_m"?: number \| null }`              | Vuelve a encolar una capa `ready` o `failed`; 202      |
| `DELETE /api/layers/:id`         | UUID                                                 | Borra la capa, cancela su job y sus objetos; 204       |
| `GET /api/layers/:id/tiles/*`    | Ruta dentro del tileset                              | `tileset.json` y `.pnts` en streaming, con caché       |

`lat` [-90,90], `lng` [-180,180], `radius` (0,50000] metros, predeterminado 500. `limit` de lecturas [1,500], predeterminado 120, y de alertas [1,500], predeterminado 100. `name` 1–100 caracteres; mensaje manual 5–500. `search` busca texto literal: `%` y `_` no son comodines. `mode`/`severity`: `warning` o `critical`. Estados de activo: `healthy`, `warning`, `critical`; de alerta: `active`, `resolved`.

## Capas LiDAR

`POST /api/layers` recibe **un** fichero en el campo `file` de un `multipart/form-data`. El tipo se decide por el contenido (firma `LASF` y cabecera LAS 1.0-1.4; LAZ si el formato de punto lleva el bit de compresión), nunca por la extensión. El cuerpo se envía al almacenamiento en streaming mientras se calcula su SHA-256, sin cargarlo entero en memoria. Opciones en la query:

| Parámetro        | Valor                                       | Predeterminado                                                   |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `name`           | 1-100 caracteres                            | Nombre del fichero sin extensión                                 |
| `crs_in`         | `EPSG:nnnn`; solo si el fichero no trae CRS | `EPSG:25830` (ETRS89 / UTM 30N)                                  |
| `vertical_datum` | `orthometric` o `ellipsoidal`               | `orthometric` (PNOA: altitudes REDNAP)                           |
| `geoid_offset_m` | N en metros, de −150 a 150                  | Lo calcula el worker (rejilla oficial o EGM96)                   |
| `attribution`    | 1-500 caracteres                            | La de PNOA-LiDAR si el fichero se llama `PNOA_…`; si no, ninguna |

Respuestas de la subida: 201 con la capa en `queued`; 409 `DUPLICATE_LAYER` si el mismo contenido (SHA-256) ya es una capa, con su nombre en el mensaje; 413 `PAYLOAD_TOO_LARGE` por encima de `LAYER_UPLOAD_MAX_BYTES` (150 MiB por defecto); 415 `UNSUPPORTED_MEDIA_TYPE` si no es multipart o el fichero no es LAS/LAZ; 400 si falta `file` o las opciones no son válidas. En 413 y 415 la conexión se cierra, porque el resto del cuerpo no se lee.

Una capa (`layerSchema` en `packages/shared`) incluye `status` (`queued`, `processing`, `ready`, `failed`), `stage` (`queued`, `downloading`, `inspecting`, `tiling`, `uploading`, `done`), `progress` 0-100, `error` legible si falla, `source` (nombre, formato, bytes, SHA-256), `crs_in`, `vertical` (`datum`, `override_m`, `geoid_offset_m` aplicado y `method`), `point_count`, `point_format`, `bbox` `[oeste, sur, este, norte]` en grados, `center`, `height_range_m` (alturas del fichero, ortométricas en PNOA), `tileset_url` (solo si está lista) y `attribution`.

`tileset_url` apunta a `GET /api/layers/:id/tiles/<job>/tileset.json`, listo para `Cesium3DTileset.fromUrl`. Los `.pnts` llevan posición, RGB y la clasificación ASPRS como atributo `classification` de la batch table (para estilos como `${classification} === 6`). Todas las respuestas de teselas llevan `ETag` y `Cache-Control: public, max-age=31536000, immutable`, porque la ruta cambia si la capa se reprocesa; con `If-None-Match` devuelven 304. Rutas con `..`, barras invertidas o segmentos ocultos devuelven 400 o 404.

```bash
curl -F file=@apps/worker/tests/fixtures/synthetic-laguna-duero.laz \
  'http://localhost:3001/api/layers?name=Prueba%20sint%C3%A9tica&attribution=Datos%20sint%C3%A9ticos'
curl http://localhost:3001/api/layers/ID_DEVUELTO          # status, progress, tileset_url…
curl -X POST http://localhost:3001/api/layers/ID_DEVUELTO/reprocess \
  -H 'Content-Type: application/json' -d '{"geoid_offset_m": 53.1}'
curl -X DELETE http://localhost:3001/api/layers/ID_DEVUELTO
```

`scripts/smoke-layer.sh` hace este recorrido completo contra una pila en marcha (la CI lo ejecuta contra Docker Compose).

## Ejemplo reproducible

```bash
curl 'http://localhost:3001/api/assets/nearby?lat=41.655&lng=-4.737&radius=500'
curl -X POST http://localhost:3001/api/demo/anomalies   -H 'Content-Type: application/json'   -d '{"sensor_id":"30000000-0000-4000-8000-000000000001","mode":"critical"}'
# Usa el id de alerta devuelto:
curl -X PATCH http://localhost:3001/api/alerts/ID_DEVUELTO/resolve
```

Resolución no recibe cuerpo; no envíes `Content-Type: application/json` vacío. Los clientes validan respuestas con contratos Zod y presentan errores accionables.

## Errores

Validación o JSON mal formado devuelve 400, recurso inexistente 404, conflicto 409 (capa duplicada o que todavía se procesa), cuerpo JSON de más de 16 KB o fichero por encima del límite 413 (`PAYLOAD_TOO_LARGE`), tipo de contenido no admitido 415, creación válida 201, lectura/actualización 200 y fallo interno 500. Los demás errores 4xx de Fastify conservan su código. La ausencia del endpoint demo cuando está deshabilitado devuelve 404. WebSocket rechaza un Origin ajeno a la allowlist con 403; las conexiones sin cabecera Origin (clientes que no son navegadores) se aceptan, porque la allowlist protege frente a páginas web ajenas y no autentica a nadie. Los errores internos se registran con request ID y no exponen detalles SQL al cliente. Todas las respuestas, también las de error, llevan `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `X-Frame-Options: DENY`.

```json
{ "error": { "code": "NOT_FOUND", "message": "Activo no encontrado", "request_id": "req-12" } }
```

## WebSocket `/api/ws`

Mensaje JSON: `{ "type": "...", "data": { ... } }`, validado con `realtimeEventSchema`.

| Evento                 | Datos                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `sync:required`        | `connected_at`; se emite al conectar y pide sincronización REST  |
| `sensor:reading`       | sensor, activo, métrica, unidad, valor, fecha, simulated         |
| `asset:status_changed` | `asset_id`, `status`                                             |
| `asset:updated`        | Activo completo tras un cambio de nombre                         |
| `alert:created`        | Alerta nueva completa                                            |
| `alert:updated`        | Alerta completa tras escalar de warning a critical (mismo ID)    |
| `alert:resolved`       | Alerta completa, con `resolved_at` y `resolved_by`               |
| `layer:created`        | Capa completa recién subida                                      |
| `layer:progress`       | `id`, `status`, `stage`, `progress` (como mucho uno por segundo) |
| `layer:ready`          | Capa completa con `tileset_url`                                  |
| `layer:failed`         | Capa completa con `error`                                        |
| `layer:deleted`        | `id`                                                             |

Los eventos `layer:*` los produce el worker, otro proceso: llegan por `LISTEN/NOTIFY` de PostgreSQL a todas las réplicas de la API y de ahí a sus WebSockets. Si la conexión de escucha se corta, al recuperarla se envía `sync:required`.

Las alertas incluyen `resolved_by`: `operator` cuando alguien la resuelve y `auto_recovery` cuando una anomalía natural del simulador vuelve al rango normal. Solo se publican cambios confirmados en PostgreSQL. Los eventos no sustituyen la fuente de verdad REST. No existe replay por cursor ni outbox en este MVP.
