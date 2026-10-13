# API REST y eventos

Swagger UI: `/api/docs/`. Contrato OpenAPI: `/api/openapi.json`. Las fechas se transportan en ISO 8601, con zona horaria. La API de esta demo usa una organización fija y no requiere login.

| Método / ruta                   | Entrada                                              | Resultado                                              |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `GET /api/health`               | —                                                    | PostgreSQL real, versión PostGIS, modos demo/simulador |
| `GET /api/dashboard/summary`    | `installation_id?` UUID                              | Conteos y tendencia de 30 min                          |
| `GET /api/organization`         | —                                                    | Organización de la demo y su región (nombre de lugar)  |
| `GET /api/installations`        | —                                                    | Instalaciones, coordenadas y número de activos         |
| `GET /api/assets`               | `installation_id?`, `status?`, `search?` (literal)   | Lista de activos                                       |
| `GET /api/assets/nearby`        | `lat`, `lng`, `radius?`                              | Activos y `distance_m`, ordenados por distancia        |
| `GET /api/assets/:id`           | UUID                                                 | Detalle del activo                                     |
| `PATCH /api/assets/:id`         | `{ "name": "Pump 01 · Revisada" }`                   | Activo actualizado; emite `asset:updated`              |
| `GET /api/assets/:id/readings`  | `sensor_id?`, `limit?`                               | Últimas `limit` lecturas, orden temporal ascendente    |
| `GET /api/sensors`              | `asset_id?`                                          | Sensores, umbrales y última lectura                    |
| `GET /api/alerts`               | `asset_id?`, `installation_id?`, `status?`, `limit?` | Incidencias activas/resueltas                          |
| `GET /api/alerts/:id`           | UUID                                                 | Detalle sincronizado de una incidencia                 |
| `POST /api/alerts`              | `asset_id`, `severity`, `message`                    | Incidencia manual persistida; 201                      |
| `PATCH /api/alerts/:id/resolve` | Sin cuerpo                                           | Incidencia resuelta, idempotente                       |
| `POST /api/demo/anomalies`      | `sensor_id`, `mode`                                  | Lectura inmediata e incidencia; 201; solo demo         |
| `GET /api/docs`                 | —                                                    | Swagger UI (redirección a `/api/docs/`)                |

`lat` [-90,90], `lng` [-180,180], `radius` (0,50000] metros, predeterminado 500. `limit` de lecturas [1,500], predeterminado 120, y de alertas [1,500], predeterminado 100. `name` 1–100 caracteres; mensaje manual 5–500. `search` busca texto literal: `%` y `_` no son comodines. `mode`/`severity`: `warning` o `critical`. Estados de activo: `healthy`, `warning`, `critical`; de alerta: `active`, `resolved`.

## Ejemplo reproducible

```bash
curl 'http://localhost:3001/api/assets/nearby?lat=41.655&lng=-4.737&radius=500'
curl -X POST http://localhost:3001/api/demo/anomalies   -H 'Content-Type: application/json'   -d '{"sensor_id":"30000000-0000-4000-8000-000000000001","mode":"critical"}'
# Usa el id de alerta devuelto:
curl -X PATCH http://localhost:3001/api/alerts/ID_DEVUELTO/resolve
```

Resolución no recibe cuerpo; no envíes `Content-Type: application/json` vacío. Los clientes validan respuestas con contratos Zod y presentan errores accionables.

## Errores

Validación o JSON mal formado devuelve 400, recurso inexistente 404, cuerpo de más de 16 KB 413 (`PAYLOAD_TOO_LARGE`), tipo de contenido no admitido 415, creación válida 201, lectura/actualización 200 y fallo interno 500. Los demás errores 4xx de Fastify conservan su código. La ausencia del endpoint demo cuando está deshabilitado devuelve 404. WebSocket rechaza un Origin ajeno a la allowlist con 403; las conexiones sin cabecera Origin (clientes que no son navegadores) se aceptan, porque la allowlist protege frente a páginas web ajenas y no autentica a nadie. Los errores internos se registran con request ID y no exponen detalles SQL al cliente. Todas las respuestas, también las de error, llevan `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `X-Frame-Options: DENY`.

```json
{ "error": { "code": "NOT_FOUND", "message": "Activo no encontrado", "request_id": "req-12" } }
```

## WebSocket `/api/ws`

Mensaje JSON: `{ "type": "...", "data": { ... } }`, validado con `realtimeEventSchema`.

| Evento                 | Datos                                                           |
| ---------------------- | --------------------------------------------------------------- |
| `sync:required`        | `connected_at`; se emite al conectar y pide sincronización REST |
| `sensor:reading`       | sensor, activo, métrica, unidad, valor, fecha, simulated        |
| `asset:status_changed` | `asset_id`, `status`                                            |
| `asset:updated`        | Activo completo tras un cambio de nombre                        |
| `alert:created`        | Alerta nueva completa                                           |
| `alert:updated`        | Alerta completa tras escalar de warning a critical (mismo ID)   |
| `alert:resolved`       | Alerta completa, con `resolved_at` y `resolved_by`              |

Las alertas incluyen `resolved_by`: `operator` cuando alguien la resuelve y `auto_recovery` cuando una anomalía natural del simulador vuelve al rango normal. Solo se publican cambios confirmados en PostgreSQL. Los eventos no sustituyen la fuente de verdad REST. No existe replay por cursor ni outbox en este MVP.
