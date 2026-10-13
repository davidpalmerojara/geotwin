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

## Pipeline LiDAR (rama `feat/lidar-pipeline`)

Entorno local del 13/10/2026: Node 22.22, PostgreSQL 16.13 + PostGIS 3.4.2 nativos, Python 3.13 con `apps/worker/python/requirements-dev.txt`, 4 CPU. Sin Docker local: MinIO y las imágenes se prueban en GitHub Actions. Todas las nubes usadas son **sintéticas**.

| Fecha      | Revisión  | Entorno                                                                                  | Comprobación                                                                                                                                      | Resultado |
| ---------- | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 13/10/2026 | `082a832` | GitHub Actions: Python 3.13, rejilla EGM08-REDNAP de `cdn.proj.org`, MinIO `pgsty/minio` | Job `checks`: unitarias, pytest, integración (pipeline con py3dtiles real y driver S3 contra MinIO), build y E2E                                  | Correcto  |
| 13/10/2026 | `082a832` | GitHub Actions, Docker Compose completo (db, MinIO, API, worker, web)                    | Job `docker`: `scripts/smoke-layer.sh` sube el LAZ sintético por nginx, el worker lo convierte y se sirve el `tileset.json`                       | Correcto  |
| 13/10/2026 | rama      | Local                                                                                    | `npm test` 60/60; `npm run test:integration` 36/36 (+1 de S3 sin servidor), ya fusionada con `fix/review`; `pytest` 13/13, con la rejilla oficial | Correcto  |
| 13/10/2026 | rama      | Local, servidor S3 `moto` (emulador compatible)                                          | Contrato del driver S3 y recorrido completo API → worker → teselas con `STORAGE_DRIVER=s3` y corrección por rejilla (N = 53,106 m)                | Correcto  |
| 13/10/2026 | rama      | Local, API y worker como procesos separados, almacenamiento local, `TILER_JOBS=3`        | Hoja sintética de 12 M de puntos (LAZ de 86 MB): subida 0,7 s; conversión 66 s; 1.372 ficheros y 187 MB de teselas; worker ≤ 3,4 GB PSS           | Correcto  |
| 13/10/2026 | rama      | Igual                                                                                    | Worker matado a mitad de conversión: el job quedó en reintento y, al arrancar otro worker, terminó la capa sin intervención                       | Correcto  |

Lo que cubren las pruebas nuevas:

- **Unitarias.** Detección LAS/LAZ por la cabecera (firma, versión, formato de punto) y streaming con SHA-256 sin emitir nada si el fichero no es LAS; ondulación EGM96 en Laguna de Duero frente al valor de PROJ (53,60 m) y frente al oficial EGM08-REDNAP (53,11 m, error entre 0,4 y 0,6 m); orden de prioridad de los métodos verticales; contrato del almacenamiento local (escritura atómica, claves inseguras rechazadas); configuración; máquina de estados del job con un conversor simulado (éxito, fichero dañado sin reintento, error inesperado con reintento y fallo en el último intento, caída del conversor, timeout que mata el proceso, borrado a mitad de proceso, reproceso que sustituye la ejecución anterior).
- **Python (pytest).** Lectura de cabecera, CRS y clases; CRS por defecto si el fichero no lo trae; LAZ truncado y fichero no LAS con error legible; coordenadas que no encajan con el CRS; desplazamiento de alturas por cabecera; conversión real con RGB, clasificación y alturas elipsoidales comprobadas al centímetro; ruta exacta con la rejilla; LAZ de varios bloques sin bloqueo.
- **Integración.** Subida → cola → worker → `ready` con progreso por WebSocket, metadatos, cabeceras de caché, `ETag` y 304; duplicado 409; tipo por contenido 415; tamaño 413 con y sin `Content-Length`; LAZ dañado → `failed` con mensaje legible; reproceso con y sin ondulación manual y URL nueva; borrado de fila y objetos con evento; rutas de teselas que intentan salir de la carpeta; OpenAPI del multipart.

## Límites del entorno

- No hay despliegue público ni recursos en AWS; [aws.md](aws.md) es un plan.
- La ortofoto PNOA necesita conexión con `ign.es`; el atlas local funciona sin red. Las pruebas automáticas usan el atlas local.
- El terreno y los edificios de Cesium ion necesitan un token propio y no se prueban en CI.
- El chunk de Cesium supera el límite de aviso de Vite; se carga bajo demanda al abrir el gemelo digital.
- No se ha probado todavía con una hoja PNOA-LiDAR real (los servidores del CNIG no eran accesibles desde este entorno); las cifras de rendimiento son de una nube sintética del mismo tamaño.
