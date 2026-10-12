# Pruebas y verificación

Registro de las verificaciones realizadas, con fecha, revisión y entorno. Los comandos están en el [README](../README.md#tests).

## Resultados

| Fecha      | Revisión          | Entorno                                                                                         | Comprobación                                                                                                                 | Resultado                                  |
| ---------- | ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 12/10/2026 | `1071dec`         | GitHub Actions, `ubuntu-latest`, Node 24, servicio `postgis/postgis:17-3.5`                     | Job `checks`: lint, formato, tipos, unitarias, integración con PostGIS, build y E2E en Chromium con SwiftShader              | Correcto                                   |
| 12/10/2026 | `1071dec`         | GitHub Actions, `ubuntu-latest`                                                                 | Job `docker`: `docker compose up -d --build --wait` y `curl` a `/api/health` y a la web                                      | Correcto                                   |
| 12/10/2026 | `1071dec`         | Local: Node 24.19, Docker Desktop 28.4, Compose 2.39, PostgreSQL 17 / PostGIS 3.5 en contenedor | Unitarias 8/8, integración 13/13, E2E 1/1 en desarrollo y contra los contenedores de Compose                                 | Correcto                                   |
| 12/10/2026 | `1071dec`         | Local, con token de Cesium ion                                                                  | Terreno y edificios OSM activados juntos; edificios apoyados sobre el relieve ([captura](screenshots/terrain-buildings.jpg)) | Correcto                                   |
| 12/10/2026 | rama `fix/review` | Local: Node 22.22, PostgreSQL 16.13 + PostGIS 3.4.2 nativos, Chromium 1194 con SwiftShader      | Lint, formato y tipos                                                                                                        | Correcto                                   |
| 12/10/2026 | rama `fix/review` | Igual                                                                                           | `npm test`: 25/25 (6 ficheros)                                                                                               | Correcto                                   |
| 12/10/2026 | rama `fix/review` | Igual                                                                                           | `npm run test:integration`: 26/26 contra PostGIS real                                                                        | Correcto                                   |
| 12/10/2026 | rama `fix/review` | Igual                                                                                           | `npm run build`; chunk de Cesium de 4,17 MB (1,12 MB con gzip)                                                               | Correcto, con el aviso de tamaño esperado  |
| 12/10/2026 | rama `fix/review` | Igual                                                                                           | `npm run test:e2e`: 1/1                                                                                                      | Correcto                                   |
| 12/10/2026 | rama `fix/review` | nginx 1.24 nativo sirviendo `apps/web/dist` con `apps/web/nginx.conf`                           | gzip en JS, CSS y WASM; `Cache-Control`, `X-Content-Type-Options` y `Referrer-Policy` en `/assets/`                          | Correcto                                   |
| 12/10/2026 | rama `fix/review` | Igual que las pruebas locales                                                                   | `npm audit --omit=dev`                                                                                                       | 0 vulnerabilidades                         |
| —          | rama `fix/review` | GitHub Actions y Docker Compose                                                                 | CI completa y arranque de Compose                                                                                            | Pendiente: se ejecutan al publicar la rama |

## Qué cubren las pruebas

**Unitarias (25).** Umbrales y generador del simulador, contratos compartidos, orden de carga de Cesium ion, encuadre de cámara (distancias, esfera que contiene los puntos, móvil vertical frente a escritorio), aplicación de eventos realtime a la caché de TanStack Query, cliente REST ante respuestas no JSON y formato en español (plurales y hemisferios).

**Integración (26), con PostgreSQL/PostGIS real.**

- Salud, OpenAPI, contratos de activos, instalaciones, sensores y organización.
- Validación (400), recursos inexistentes (404 con el género correcto), cuerpo demasiado grande (413) y tipo de contenido no admitido (415).
- Proximidad `ST_DWithin` en metros, índices GiST, búsqueda con `%` y `_` como texto literal, histórico por sensor.
- Tick: una lectura por sensor, publicación solo tras COMMIT (un suscriptor ya ve las filas), nada publicado si la transacción se revierte, número fijo de sentencias por tick y marca de tiempo posterior al bloqueo.
- Incidencias: inyección, deduplicación concurrente, escalado, resolución idempotente, estado del activo con varias incidencias, cierre automático de anomalías naturales y retención de lecturas.
- WebSocket: eventos de anomalía y de renombrado recibidos por un cliente conectado.
- Seeds re-ejecutables y fase del histórico sembrado igual a la del generador.

**E2E (1), en Chromium.** Resumen → gemelo digital → cambio de instalación sin reconstruir el visor (mismo canvas y misma capa base) → anomalía persistida → segundo cliente actualizado por WebSocket → resolución → vista de 390 px sin desbordamiento y navegación con nombres accesibles.

## Comprobaciones en navegador (rama `fix/review`)

Con API y Vite locales, simulador activo y atlas local:

- En 20 s en el gemelo digital, la página hizo 4 peticiones REST, todas del sondeo de 30 s; las lecturas y los cambios de estado llegan por WebSocket y se aplican a la caché.
- 20 movimientos de ratón sobre el visor tardaron entre 2,2 y 2,7 s con SwiftShader. La revisión anterior midió 7,4 s en otra máquina, así que la cifra no es directamente comparable.
- Tras cambiar de instalación, el visor conserva su canvas y la capa base elegida.
- La cámara encuadra toda la red a 1440×900 y a 390×844. Capturas actualizadas en [`screenshots/`](screenshots/).
- `POST /api/alerts` con un cuerpo de 20 KB devuelve 413; `search=%` y `search=_` devuelven una lista vacía.

## Límites del entorno

- No hay despliegue público ni recursos en AWS; [aws.md](aws.md) es un plan.
- La ortofoto PNOA necesita conexión con `ign.es`; el atlas local funciona sin red. Las pruebas automáticas usan el atlas local.
- El terreno y los edificios de Cesium ion necesitan un token propio y no se prueban en CI.
- El chunk de Cesium supera el límite de aviso de Vite; se carga bajo demanda al abrir el gemelo digital.
