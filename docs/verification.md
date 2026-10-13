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
| 13/10/2026 | `629836e` | GitHub Actions: Python 3.13, rejilla EGM08-REDNAP de `cdn.proj.org`, MinIO `pgsty/minio` | Job `checks`: unitarias, pytest, integración (pipeline con py3dtiles real y driver S3 contra MinIO), build y E2E                                  | Correcto  |
| 13/10/2026 | `629836e` | GitHub Actions, Docker Compose completo (db, MinIO, API, worker, web)                    | Job `docker`: `scripts/smoke-layer.sh` sube el LAZ sintético por nginx, el worker lo convierte y se sirve el `tileset.json`                       | Correcto  |
| 13/10/2026 | rama      | Local                                                                                    | `npm test` 60/60; `npm run test:integration` 36/36 (+1 de S3 sin servidor), ya fusionada con `fix/review`; `pytest` 13/13, con la rejilla oficial | Correcto  |
| 13/10/2026 | rama      | Local, servidor S3 `moto` (emulador compatible)                                          | Contrato del driver S3 y recorrido completo API → worker → teselas con `STORAGE_DRIVER=s3` y corrección por rejilla (N = 53,106 m)                | Correcto  |
| 13/10/2026 | rama      | Local, API y worker como procesos separados, almacenamiento local, `TILER_JOBS=3`        | Hoja sintética de 12 M de puntos (LAZ de 86 MB): subida 0,7 s; conversión 66 s; 1.372 ficheros y 187 MB de teselas; worker ≤ 3,4 GB PSS           | Correcto  |
| 13/10/2026 | rama      | Igual                                                                                    | Worker matado a mitad de conversión: el job quedó en reintento y, al arrancar otro worker, terminó la capa sin intervención                       | Correcto  |

Lo que cubren las pruebas nuevas:

- **Unitarias.** Detección LAS/LAZ por la cabecera (firma, versión, formato de punto) y streaming con SHA-256 sin emitir nada si el fichero no es LAS; ondulación EGM96 en Laguna de Duero frente al valor de PROJ (53,60 m) y frente al oficial EGM08-REDNAP (53,11 m, error entre 0,4 y 0,6 m); orden de prioridad de los métodos verticales; contrato del almacenamiento local (escritura atómica, claves inseguras rechazadas); configuración; máquina de estados del job con un conversor simulado (éxito, fichero dañado sin reintento, error inesperado con reintento y fallo en el último intento, caída del conversor, timeout que mata el proceso, borrado a mitad de proceso, reproceso que sustituye la ejecución anterior).
- **Python (pytest).** Lectura de cabecera, CRS y clases; CRS por defecto si el fichero no lo trae; LAZ truncado y fichero no LAS con error legible; coordenadas que no encajan con el CRS; desplazamiento de alturas por cabecera; conversión real con RGB, clasificación y alturas elipsoidales comprobadas al centímetro; ruta exacta con la rejilla; LAZ de varios bloques sin bloqueo.
- **Integración.** Subida → cola → worker → `ready` con progreso por WebSocket, metadatos, cabeceras de caché, `ETag` y 304; duplicado 409; tipo por contenido 415; tamaño 413 con y sin `Content-Length`; LAZ dañado → `failed` con mensaje legible; reproceso con y sin ondulación manual y URL nueva; borrado de fila y objetos con evento; rutas de teselas que intentan salir de la carpeta; OpenAPI del multipart.

## Capas en el visor y medición (rama `feat/lidar-layer`)

Rama que fusiona `fix/review` y `feat/lidar-pipeline` y añade el panel Capas y la herramienta Medir. Entorno local del 13/10/2026: Node 22.22, PostgreSQL 16.13 + PostGIS 3.4.2 nativos, Python 3.13 con los requisitos del worker y la rejilla EGM08-REDNAP, Chromium 141 (build 1194) con SwiftShader, atlas local (sin ortofoto PNOA). Todas las nubes son **sintéticas**.

| Fecha      | Revisión             | Entorno                                                 | Comprobación                                                                                                                                                                                  | Resultado |
| ---------- | -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 13/10/2026 | rama                 | Local                                                   | Lint, formato, tipos; `npm test` 81/81 (15 ficheros); `npm run test:integration` 37/37 (+1 de S3 sin servidor); `pytest` 13/13; `npm audit --omit=dev` sin vulnerabilidades                   | Correcto  |
| 13/10/2026 | rama                 | Local                                                   | `npm run build`: el panel Capas va en el bundle principal; la herramienta Medir es un chunk aparte de 7 kB que se descarga al abrirla; el chunk de Cesium sigue en 4,17 MB (1,12 MB con gzip) | Correcto  |
| 13/10/2026 | rama                 | Local, `npm run test:e2e` con API, worker y Vite reales | 2/2: el flujo anterior y la subida de la nube sintética por el panel hasta verla en el mapa, con estilos, medición y borrado                                                                  | Correcto  |
| 13/10/2026 | `70b5cc8`, `92100c3` | GitHub Actions                                          | Jobs `checks` (con el nuevo E2E y su worker) y `docker`                                                                                                                                       | Correcto  |

En el navegador, a 1440×900 y 390×844, con la nube sintética de 5.540 puntos:

- La capa pasa de _En cola_ a _Lista_ en unos 4 s; el panel recibe el progreso por WebSocket y la lista de capas no se vuelve a pedir por REST (el E2E lo comprueba).
- RGB, altura y clasificación se ven como se espera: suelo, dos edificios, una fila de árboles y una charca. La leyenda de altura marca 751,6-763,2 m elipsoidales (altitudes del fichero + N = 53,11 m de la rejilla oficial).
- Medición del tejado del edificio grande al suelo de al lado: 33,0 m en 3D, 31,8 m en horizontal y −9,01 m de desnivel. Las fórmulas se comprueban aparte contra GeographicLib.
- Con la nube visible se siguen seleccionando activos desde el mapa y desde la lista, y un clic sobre la nube (sin la herramienta abierta) no selecciona nada ni da errores.
- Hoja **sintética** de tamaño real (12 M de puntos, LAZ de 86,5 MB, 1 × 1 km): subida por la API en 1 s, lista en 79 s y 187 MB de teselas. En el visor (SwiftShader, sin GPU), la vista general cargó 127 respuestas de teselas (3,2 MB) en unos 11 s; tras acercar tres veces y pasar a calidad alta, 343 respuestas y 8,1 MB en total, con unos 210 MB de memoria JavaScript. Solo se descargan los niveles de detalle que pide la vista ([captura](screenshots/lidar-12m.png)).
- Sin desbordamiento horizontal en ninguno de los dos tamaños. En el móvil el panel se pliega bajo el mapa, y el mapa crece mientras se mide para que la herramienta no tape lo medido.

Fallos encontrados y corregidos durante esta verificación:

- **Puntos de un píxel.** py3dtiles deja a 0 el error geométrico de las teselas hoja y Cesium lo estimaba con el volumen de una caja casi plana: el suelo se dibujaba con puntos de un píxel que el _eye-dome lighting_ volvía blanquecinos. Ahora la resolución base es la separación media de la capa.
- **Borrar una capa en proceso bloqueaba la cola.** Al borrarla, el worker mataba solo el proceso principal de Python; los procesos que py3dtiles crea con `fork` seguían vivos con la salida estándar abierta, la ejecución no terminaba nunca y, con un job a la vez, las siguientes subidas se quedaban _En cola_ hasta que pg-boss diera el job por caducado (30 min). Se vio subiendo y borrando una nube sintética de 1,5 M de puntos. El conversor corre ahora en su propio grupo de procesos, que se mata entero; una prueba unitaria con un conversor falso que hace `fork` lo cubre y fallaba antes del arreglo.
- **Líneas de medición que no aparecían** hasta mover la cámara (geometría asíncrona en `requestRenderMode`) y una petición a `/favicon.ico` que daba 404.

### Segunda verificación independiente y correcciones

Una verificación independiente de `f107162` dio por buenos la instalación desde cero, las pruebas, la CI, las pruebas de API hostiles, la recuperación tras matar el worker, el datum vertical comprobado con las rejillas oficiales y la medición frente a GeographicLib, pero encontró un fallo grave y varios menores. Todos se han corregido, cada uno con su prueba:

- **Encuadre tapado por el panel Capas (grave).** El panel está abierto de entrada en escritorio y, a 1280×900, la vista de la red dejaba San Cristóbal debajo. La red, una instalación y una capa se encuadran ahora en la parte del mapa que deja libre el panel. Un E2E comprueba a 1280 y 1440 px que ningún marcador ni su etiqueta queda debajo; fallaba antes del arreglo.
- **Progreso que retrocedía** (de 60 % a 37 % en una hoja sintética de 6 M de puntos): el contador de py3dtiles baja durante el teselado. El progreso es ahora monótono en Python y en el worker.
- **Líneas de medición** que bajo mucha carga no aparecían en 1,2 s: se sigue pidiendo render hasta que la geometría está construida (máximo 20 s).
- **Mensaje de error fuera de la vista** con el panel desplazado: ahora se lleva a la vista.
- **Créditos CC-BY tapados** por la herramienta Medir en el móvil: el panel se coloca justo encima de los créditos.
- **Carpetas temporales** de intentos matados: el worker borra al arrancar, y cada 10 min, las que superan el tiempo máximo del job.
- **Subidas cortadas** registradas como error 500: ahora son 400 `INCOMPLETE_UPLOAD`, y el HTTP mal formado recibe el formato de error de la API.
- **Contraste** por debajo de 4,5:1 en textos secundarios de toda la aplicación y dos `<aside>` sin nombre: corregidos y cubiertos por un E2E con axe.
- **Textos**: el límite se expresa en MiB en todas partes y la documentación aclara que la leyenda de altura da metros solo con una capa visible. Una capa en proceso sin noticias del worker durante 90 s lo indica.

| Fecha      | Revisión | Entorno                                                                                                                      | Comprobación                                                                                                                                                                 | Resultado |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 13/10/2026 | rama     | Local: Node 22.22, PostgreSQL 16 + PostGIS 3 nativos, Python 3.13, rejilla EGM08-REDNAP, Chromium build 1194 con SwiftShader | Lint, formato, tipos; `npm test` 96/96 (18 ficheros); `npm run test:integration` 39/39 (+1 de S3 sin servidor); `pytest` 14/14; `npm run build`                              | Correcto  |
| 13/10/2026 | rama     | Igual, `npm run test:e2e` con API, worker y Vite reales                                                                      | 7/7: los dos flujos anteriores, encuadre junto al panel a 1280 y 1440 px, créditos visibles al medir en el móvil y axe sin infracciones en cinco páginas, escritorio y móvil | Correcto  |

## Límites del entorno

- No hay despliegue público ni recursos en AWS; [aws.md](aws.md) es un plan.
- La ortofoto PNOA necesita conexión con `ign.es`; el atlas local funciona sin red. Las pruebas automáticas usan el atlas local.
- El terreno y los edificios de Cesium ion necesitan un token propio y no se prueban en CI.
- El chunk de Cesium supera el límite de aviso de Vite; se carga bajo demanda al abrir el gemelo digital.
- No se ha probado todavía con una hoja PNOA-LiDAR real (los servidores del CNIG no eran accesibles desde este entorno); las cifras de rendimiento son de una nube sintética del mismo tamaño. El visor se ha probado con nubes sintéticas (5.540 y 12 M de puntos), no con una real.
