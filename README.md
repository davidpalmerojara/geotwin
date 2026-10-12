# GeoTwin Cloud

**Monitorización de infraestructuras con gemelos digitales 3D.** MVP integrado para demostrar ingeniería full-stack geoespacial: React, CesiumJS, Fastify, PostgreSQL/PostGIS y WebSockets.

Demo **de organización única**, sin autenticación. Tres instalaciones ficticias situadas en coordenadas geográficas reales de Valladolid, 18 activos, 36 sensores y 30 minutos de histórico inicial. Toda la operación y telemetría está explícitamente identificada como **simulada**. No representa ni controla infraestructuras reales.

## Arranque con Docker

Requisitos: Docker Engine / Docker Desktop con Compose v2, acceso a internet durante la construcción y al menos **8 GB libres** para imágenes y caché. En Apple Silicon se emula `linux/amd64` para la imagen oficial PostGIS. No necesitas Node en el host para esta opción.

```bash
cp .env.example .env
docker compose up -d --build --wait
```

Abre **http://localhost:8080**. Documentación interactiva: **http://localhost:8080/api/docs**. La API también escucha en `http://localhost:3001`, PostgreSQL en `localhost:55432`. Los puertos publicados se limitan a loopback.

La API aplica migraciones y, con `DEMO_MODE=true`, ejecuta seeds idempotentes antes de arrancar. Los datos permanecen en el volumen `pgdata`. `docker compose stop` detiene la demo conservando sus datos; `docker compose start` vuelve a arrancarla. Para revisar errores: `docker compose logs --tail=100 api web db`. **No borres el volumen para una actualización normal.**

## Desarrollo local

Node **24 LTS recomendado** (mínimo 22.13), npm 10 o superior y Docker para PostgreSQL/PostGIS. Usa `.nvmrc` si trabajas con nvm. No mantengas al mismo tiempo la API de Compose y la API local en el puerto 3001.

```bash
cp .env.example .env
npm ci
docker compose up -d db --wait
npm run db:migrate
npm run db:seed
npm run dev
```

Abre **http://localhost:5173**. Vite redirige REST y WebSocket a la API. `npm run dev` compila automáticamente el paquete compartido; si modificas sus contratos, vuelve a compilarlo con `npm run build -w @geotwin/shared` o reinicia dev.

```bash
npm run build           # contratos, API y web de producción
npm run typecheck      # TypeScript estricto, incluye tests
npm run lint
npm run format:check
```

`npm run start -w @geotwin/api` usa la API compilada. Para servir la web de producción integrada usa la imagen nginx de Compose; `vite preview` por sí solo no es un servidor API.

## Qué funciona

- Dashboard calculado mediante SQL, filtros por instalación y tendencia de sensores.
- Visor Cesium real: cámara en Valladolid, selección mediante clic, fly-to, marcadores y volúmenes de activos con color operativo, búsqueda y controles de navegación.
- Inspector de activos con sensores, última lectura, histórico y umbrales. Edición persistente del nombre.
- Telemetría cada 5 segundos, persistida antes de publicar eventos; secuencia reproducible y anomalías periódicas.
- Fallos controlados desde la UI: una lectura crítica crea una incidencia, actualiza el activo y se propaga a clientes conectados.
- Registro manual de incidencias y resolución idempotente con histórico de resolución.
- Reconexión WebSocket con espera exponencial y sincronización REST. TanStack Query es la única caché remota; Zustand conserva únicamente estado de interfaz.
- Proximidad PostGIS con `ST_DWithin(location::geography, point::geography, radius)` e índice GiST sobre la misma expresión. El radio y la distancia se expresan en metros.
- OpenAPI generado desde los mismos esquemas Zod usados para entrada, salida y contratos compartidos.

## Cesium sin token

No necesitas cuenta de Cesium para el flujo principal. La aplicación arranca con globo elipsoidal, ortofotos PNOA del IGN y geometrías de activos. Workers, Widgets, Assets y ThirdParty se sirven desde `/cesium/` tanto en Vite como en nginx.

PNOA necesita conexión a internet. Se conservan créditos de IGN-CNIG y su licencia CC-BY 4.0; [servicio oficial](https://pnoa.ign.es/pnoa-imagen/visualizadores-y-servicios-web). El botón **Alternar cartografía** cambia a la cartografía Natural Earth de baja resolución incluida localmente con Cesium, manteniendo selección y navegación. Sin ion no hay terreno de alta resolución ni edificios fotogramétricos. Los volúmenes de colores son representaciones **demo** de activos, y los círculos de instalación son áreas orientativas, no límites catastrales.

Opcionalmente configura `VITE_CESIUM_ION_TOKEN` y reconstruye la web. El botón **Edificios 3D** carga conjuntamente **Cesium World Terrain** y **Cesium OSM Buildings**. El token necesita lectura de **ambos assets** (terreno: 1; edificios: 96188) y autorización de la URL utilizada, por ejemplo `http://localhost:8080`. Si falta permiso para el terreno, los edificios no se muestran sobre el globo básico. Marcadores, volúmenes y áreas se ajustan al suelo mediante referencias de altura de Cesium; no se desplaza artificialmente el tileset. Un error conserva el visor básico. Una variable `VITE_*` es **pública en el bundle**: utiliza exclusivamente un token ion de lectura, restringido a los assets y dominios necesarios; nunca un token privado con permisos de escritura.

## Tests

```bash
npm test                      # 8 pruebas unitarias del dominio, contratos y carga de ion
npm run test:integration       # crea/migra geotwin_test; 13 pruebas con PostGIS real
npx playwright install chromium
npm run test:e2e               # arranca API y Vite para el flujo real en Chromium
```

Las pruebas de integración requieren PostgreSQL activo en 55432. Utilizan **únicamente** la base `geotwin_test` y rechazan otro nombre antes de limpiar fixtures. `TEST_DATABASE_URL` permite ajustar host y credenciales. El usuario local de PostgreSQL debe poder crear esa base. No uses una base de negocio para los tests.

El E2E también usa `geotwin_test`, desactiva el simulador periódico y mantiene disponible la inyección controlada; no usa mocks de REST. Selecciona la capa local real para que el test no dependa del servicio de ortofotos. Necesita los puertos 3001 y 5173 libres y un navegador con WebGL (se configura SwiftShader en CI). Los informes de fallo se guardan en `test-results/`. La CI ejecuta checks, integración, build, E2E y un arranque de Compose.

Para probar una instancia Compose ya iniciada, puedes ejecutar el mismo smoke test con `E2E_BASE_URL=http://localhost:8080 npm run test:e2e`. Esto **crea y resuelve una anomalía de demo** en el activo Pump 01 de esa instancia; úsalo solo en una demo descartable o local.

## Variables de entorno

| Variable                                            | Uso                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                      | Conexión PostgreSQL de la API; no se envía al navegador                              |
| `TEST_DATABASE_URL`                                 | Base exclusiva `geotwin_test` para tests                                             |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Inicialización local de Compose; cambian solo al crear un volumen nuevo              |
| `PORT`, `HOST`                                      | API local, por defecto 3001 / 127.0.0.1                                              |
| `CORS_ORIGIN`                                       | Lista de orígenes HTTP y WebSocket separados por comas                               |
| `DEMO_MODE`                                         | Expone `/api/demo/anomalies` solo si es `true`; por defecto seguro `false` en código |
| `SIMULATOR_ENABLED`                                 | Activa el generador periódico; por defecto `true`                                    |
| `SIMULATOR_INTERVAL_MS`                             | Cadencia, mínimo 1000; por defecto 5000                                              |
| `VITE_CESIUM_ION_TOKEN`                             | Token público de lectura opcional; requiere reconstrucción del frontend              |
| `API_UPSTREAM`                                      | nginx: `api:3001` en Compose, `127.0.0.1:3001` en la tarea ECS propuesta             |

Las credenciales de `.env.example` son exclusivamente locales. `.env` está ignorado por Git y excluido del contexto Docker. `.env.example` se copia para arrancar la demo; el simulador y el control de anomalías se activan expresamente allí.

## Documentación

- [Arquitectura y decisiones](docs/architecture.md)
- [Endpoints, eventos y ejemplos](docs/api.md)
- [Demo de 90 segundos](docs/demo-guide.md)
- [Preparación AWS sin despliegue](docs/aws.md)
- [Verificación realizada y límites del entorno](docs/verification.md)

## Limitaciones y siguientes pasos

P0 implementado y flujo principal verificado también sobre Docker Compose, con el alcance de verificación registrado en `docs/verification.md`. P1 pendiente: OIDC, autorización por recurso y aislamiento multiempresa efectivo. El `organization_id` actual identifica una organización fija del servidor; **no constituye seguridad multiempresa**. No expongas esta demo como un SaaS de producción.

La simulación resuelve un fallo eliminando su override e insertando una lectura basal. En un sistema físico, resolver una incidencia y recuperar un sensor son operaciones distintas. La salud actual se deriva de incidencias activas; una lectura que vuelve a la normalidad no resuelve automáticamente una incidencia.

Sin retención/particionado, el histórico crece indefinidamente. Las listas están pensadas para la pequeña red demo (alerts máximo 500; lectura de detalle máximo 500). Antes de escalar: paginación por cursor, particionado por fecha, retención, límites de peticiones, observabilidad y backups con ensayo de restauración. El hub WebSocket vive en un solo proceso; debe mantenerse **una réplica** hasta introducir un mecanismo de difusión compartido si hay necesidad real. Añadir autenticación antes de cualquier publicación.

El módulo Cesium pesa aproximadamente 4 MB minificados y se descarga al abrir Digital Twin. Su build produce un aviso de tamaño esperado; no se oculta. Importador GeoJSON y análisis espacial adicional quedan en P2.
