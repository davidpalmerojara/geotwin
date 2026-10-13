# Pruebas y verificación

Registro de las verificaciones realizadas, con fecha, revisión y entorno. Los comandos están en el [README](../README.md#tests).

## Resultados

| Fecha      | Revisión                      | Entorno                                                                                                           | Comprobación                                                                                                                                                 | Resultado                                 |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 12/10/2026 | `1071dec`                     | GitHub Actions, `ubuntu-latest`, Node 24, servicio `postgis/postgis:17-3.5`                                       | Job `checks`: lint, formato, tipos, unitarias, integración con PostGIS, build y E2E en Chromium con SwiftShader                                              | Correcto                                  |
| 12/10/2026 | `1071dec`                     | GitHub Actions, `ubuntu-latest`                                                                                   | Job `docker`: `docker compose up -d --build --wait` y `curl` a `/api/health` y a la web                                                                      | Correcto                                  |
| 12/10/2026 | `1071dec`                     | Local: Node 24.19, Docker Desktop 28.4, Compose 2.39, PostgreSQL 17 / PostGIS 3.5 en contenedor                   | Unitarias 8/8, integración 13/13, E2E 1/1 en desarrollo y contra los contenedores de Compose                                                                 | Correcto                                  |
| 12/10/2026 | `1071dec`                     | Local, con token de Cesium ion                                                                                    | Terreno y edificios OSM activados juntos; edificios apoyados sobre el relieve ([captura](screenshots/terrain-buildings.jpg))                                 | Correcto                                  |
| 13/10/2026 | `c81b4c9` (rama `fix/review`) | GitHub Actions, `ubuntu-latest`, Node 24, servicio `postgis/postgis:17-3.5`                                       | Job `checks`: lint, formato, tipos, unitarias, integración con PostGIS, build y E2E en Chromium con SwiftShader                                              | Correcto                                  |
| 13/10/2026 | `c81b4c9` (rama `fix/review`) | GitHub Actions, `ubuntu-latest`                                                                                   | Job `docker`: `docker compose up -d --build --wait` y `curl` a `/api/health` y a la web                                                                      | Correcto                                  |
| 13/10/2026 | `833969b` (rama `fix/review`) | Local: Node 22.22, PostgreSQL 16.13 + PostGIS 3.4.2 nativos sin Docker, Chromium 141 (build 1194) con SwiftShader | Desde cero (`npm ci`, base `geotwin_test` inexistente): build de contratos, lint, formato y tipos                                                            | Correcto                                  |
| 13/10/2026 | `833969b`                     | Igual                                                                                                             | `npm test`: 30/30 (7 ficheros)                                                                                                                               | Correcto                                  |
| 13/10/2026 | `833969b`                     | Igual                                                                                                             | `npm run test:integration`: 28/28 contra PostGIS real                                                                                                        | Correcto                                  |
| 13/10/2026 | `833969b`                     | Igual                                                                                                             | `npm run build`; chunk de Cesium de 4,17 MB (1,12 MB con gzip)                                                                                               | Correcto, con el aviso de tamaño esperado |
| 13/10/2026 | `833969b`                     | Igual                                                                                                             | `npm run test:e2e`: 1/1 (Playwright 1.64 con `PLAYWRIGHT_CHROMIUM_PATH`)                                                                                     | Correcto                                  |
| 13/10/2026 | `833969b`                     | nginx 1.24 nativo sirviendo `apps/web/dist` con `apps/web/nginx.conf`                                             | gzip del chunk de Cesium (1,12 MB transferidos); `Cache-Control`, `X-Content-Type-Options` y `Referrer-Policy` en `/assets/`; `/gemelo?…` sirve `index.html` | Correcto                                  |
| 13/10/2026 | `833969b`                     | Igual que las pruebas locales                                                                                     | `npm audit --omit=dev`                                                                                                                                       | 0 vulnerabilidades                        |

## Qué cubren las pruebas

**Unitarias (30).** Umbrales y generador del simulador, contratos compartidos, orden de carga de Cesium ion, encuadre de cámara (distancias, esfera que contiene los puntos, margen de red frente a instalación, móvil vertical frente a escritorio), aplicación de eventos realtime a la caché de TanStack Query, cliente REST ante respuestas no JSON, formato en español (plurales y hemisferios) y rutas compartibles (escritura, lectura y valores no válidos).

**Integración (28), con PostgreSQL/PostGIS real.**

- Salud, OpenAPI, contratos de activos, instalaciones, sensores y organización.
- Validación (400), recursos inexistentes (404 con el género correcto), cuerpo demasiado grande (413), tipo de contenido no admitido (415) y cabeceras de seguridad en respuestas correctas y de error.
- Proximidad `ST_DWithin` en metros, índices GiST, búsqueda con `%` y `_` como texto literal, histórico por sensor.
- Tick: una lectura por sensor, publicación solo tras COMMIT (un suscriptor ya ve las filas), nada publicado si la transacción se revierte, número fijo de sentencias por tick y marca de tiempo posterior al bloqueo.
- Incidencias: inyección, deduplicación concurrente, escalado publicado como `alert:updated`, resolución idempotente, estado del activo con varias incidencias, cierre automático de anomalías naturales y retención de lecturas.
- WebSocket: eventos de anomalía y de renombrado recibidos por un cliente conectado.
- Seeds re-ejecutables y fase del histórico sembrado igual a la del generador.

**E2E (1), en Chromium.** Resumen → gemelo digital → cambio de instalación sin reconstruir el visor (mismo canvas y misma capa base) → anomalía persistida → segundo cliente actualizado por WebSocket → resolución → vista de 390 px sin desbordamiento y navegación con nombres accesibles → la URL del activo seleccionado abre la misma instalación y el mismo activo, y Atrás vuelve a la vista anterior.

## Comprobaciones en navegador (13/10/2026, `833969b`)

Con API y Vite locales, simulador activo y atlas local, a 1440×900 y 390×844:

- En 20 s en el gemelo digital, la página hizo 4 peticiones REST (instalaciones, organización, resumen y activos), las del sondeo de 30 s; las lecturas y los cambios de estado llegan por WebSocket y se aplican a la caché.
- 20 movimientos de ratón sobre el visor tardaron 2,1 s con SwiftShader. La revisión anterior midió 7,4 s en otra máquina, así que la cifra no es directamente comparable.
- Tras cambiar de instalación, el visor conserva su canvas y la capa base elegida, en escritorio y en móvil.
- La cámara encuadra toda la red y, al elegir una instalación, esa instalación llena la vista. Capturas actualizadas en [`screenshots/`](screenshots/).
- Flujo de anomalía: el activo pasa a crítico en el visor, el inspector y el contador de alertas; la resolución lo devuelve a operativo.
- `POST /api/alerts` con un cuerpo de 20 KB devuelve 413; `search=%` y `search=_` devuelven una lista vacía; `/api/health` lleva `nosniff`, `DENY` y `Referrer-Policy`.

## Límites del entorno

- No hay despliegue público ni recursos en AWS; [aws.md](aws.md) es un plan.
- La ortofoto PNOA necesita conexión con `ign.es`; el atlas local funciona sin red. Las pruebas automáticas usan el atlas local.
- El terreno y los edificios de Cesium ion necesitan un token propio y no se prueban en CI.
- El chunk de Cesium supera el límite de aviso de Vite; se carga bajo demanda al abrir el gemelo digital.
