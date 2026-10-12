# Arquitectura y decisiones

```mermaid
flowchart LR
  Browser[React + TypeScript] -->|REST validado| API[Fastify / OpenAPI]
  Browser --> Cesium[CesiumJS / WGS84]
  Browser --> Query[TanStack Query]
  Browser --> UI[Zustand: interfaz]
  API --> Repo[Repositorios SQL con pg]
  Repo --> DB[(PostgreSQL + PostGIS)]
  Simulator[Generador determinista] --> Service[Servicio de telemetría]
  API -->|Inyección demo / resolución| Service
  Service -->|Transacción y bloqueo| DB
  Service -->|Después de COMMIT| Hub[Hub WebSocket]
  Hub -->|Eventos y resincronización| Query
  Shared[Contratos Zod compartidos] -.-> API
  Shared -.-> Browser
```

## Límites de módulos

`packages/shared` contiene contratos y tipos, sin acceso a bases de datos ni componentes. La API separa configuración, pool/migraciones, repositorio, servicio transaccional, transporte HTTP, hub y generador. React usa hooks de consulta para datos del servidor, componentes por feature y un store exclusivo de navegación, selección y conexión.

Los controladores validan con Zod y delegan. El repositorio solo accede a PostgreSQL mediante parámetros. El servicio maneja la operación de negocio que requiere varias escrituras. El simulador no conoce Fastify ni componentes React. La UI no tiene activos ni lecturas incrustadas: todo procede de los seeds y la API.

## Persistencia

Organización → instalaciones → activos → sensores → lecturas. Cada alerta pertenece a un activo y opcionalmente a un sensor; las incidencias manuales no inventan un sensor. FKs compuestas verifican que instalación/organización y sensor/activo correspondan. UUIDs para recursos; identidad bigint para lecturas. Timestamps `timestamptz`, puntos `geometry(Point,4326)`, umbrales ascendentes y estados restringidos con CHECK.

`001_initial.sql` crea tablas y GiST de geometría y de la expresión `location::geography`. El segundo coincide con la expresión de proximidad para evitar confundir grados con metros. El histórico se lee por sensor con el índice único `(sensor_id, recorded_at)`, recorrido hacia atrás para obtener las últimas lecturas; `002` elimina un índice duplicado de esas mismas columnas. Índices de activo/estado y estado/tiempo apoyan la gestión de alertas. `003` añade `alerts.resolved_by` (`operator` o `auto_recovery`) y `004` la región de la organización, que la interfaz muestra en lugar de nombres de lugar fijos en el código.

`schema_migrations` guarda nombre, checksum SHA-256 y fecha. Un advisory lock transaccional impide aplicar migraciones simultáneas; modificar una ya aplicada provoca error. Los cambios posteriores requieren **una nueva migración**, sin editar la anterior. Migraciones y seeds se ejecutan en transacciones; seeds insertan fixtures con IDs deterministas y no reemplazan incidencias ni lecturas existentes.

## Consistencia de telemetría

La fila `telemetry_state` guarda la secuencia y se bloquea con `FOR UPDATE`. Tick, inyección demo, creación manual y resolución comparten ese bloqueo: evita carreras de escritura y es suficiente para este volumen demo. Se incrementa la secuencia, se calculan lecturas deterministas, se persisten, se detectan umbrales y se recalcula el estado de los activos dentro de la misma transacción.

El tick trabaja por lotes: un `INSERT ... SELECT unnest(...)` para todas las lecturas, una sentencia que abre o escala alertas y un único recálculo de estado para todos los activos afectados. Son entre 9 y 12 sentencias por tick, sin depender del número de sensores (antes eran al menos tres por sensor). Las marcas de tiempo salen de `clock_timestamp()` leído **después** de obtener el bloqueo, no de `now()` (inicio de la transacción, antes de esperar), para que el orden temporal coincida con el de confirmación.

El índice único parcial sobre sensor con alerta activa protege la deduplicación en la base, incluso ante solicitudes concurrentes. Una advertencia que alcanza el umbral crítico se escala sobre la misma alerta. Su evento `alert:created` representa también esa actualización; los consumidores invalidan la caché y recuperan la entidad vigente.

Se publica **solo tras COMMIT**. Si el proceso cae entre COMMIT y emisión, REST y la resincronización recuperan el estado; no existe entrega garantizada de cada evento. Un outbox sería necesario para consumidores que exijan entrega durable. No se añade infraestructura que la demo no necesita.

Las alertas inyectadas y las manuales quedan enclavadas hasta intervención. Las anomalías **naturales** del simulador (sin override) se cierran solas en cuanto la lectura vuelve al rango normal, con `resolved_by = auto_recovery`; así una demo que lleva horas encendida no acaba con toda la red en rojo. `resolve` es idempotente: si ya está resuelta conserva la misma fecha. Para anomalías simuladas elimina su override y añade una lectura basal; otras alertas activas del mismo activo siguen condicionando la salud. Estado: crítico si existe cualquier incidencia crítica activa, advertencia si quedan advertencias, operativo en caso contrario.

## Realtime en navegador

Los eventos se agrupan en ventanas de 200 ms y se aplican a la caché de TanStack Query sin peticiones: `sensor:reading` actualiza la última lectura del sensor y añade el punto al histórico del inspector; `asset:status_changed` y `asset:updated` (renombrado) modifican listas, resultados de proximidad y detalle. Solo los eventos de alerta invalidan las consultas de alertas y resumen, que se recargan por REST. Las consultas geográficas conservan los datos previos mientras recargan (`keepPreviousData`). En reconexión (`sync:required`) se consulta REST para recuperar eventos perdidos; foco de ventana y polling de 30 s ofrecen recuperación adicional.

La retención (`READINGS_RETENTION_HOURS`, 24 h en la demo) borra al arrancar y cada 10 minutos las lecturas antiguas, por sensor y en lotes acotados, fuera del bloqueo de telemetría. WebSocket usa espera exponencial con jitter hasta 30 s, ping/pong y límite de backpressure en servidor.

El hub es de un proceso. La plantilla AWS mantiene una réplica. Varias APIs con hubs separados requerirían una estrategia de difusión y un único productor, incluso si el bloqueo SQL protege las escrituras.

## Cesium

React crea y destruye Viewer y manejadores para evitar fugas y contextos WebGL acumulados. El visor nunca depende del estado de las consultas: cambiar de instalación no lo desmonta, así que se conservan la capa base, el relieve y los edificios. Assets son entidades reales del motor, actualizadas sin reconstruir el visor. La cámara encuadra una esfera que contiene los activos y las instalaciones visibles; la distancia se calcula con el campo de visión del eje más estrecho, que en un móvil vertical es el horizontal. El picking al mover el ratón se limita a uno por fotograma y el tooltip se mueve por DOM, sin renderizar React. Los colores proceden del mismo estado REST que usa el inspector. La selección geoespacial usa `scene.pick`, y la selección desde lista comparte el mismo ID de interfaz.

PNOA y el globo elipsoidal no invocan ion. La capa Natural Earth local da continuidad básica sin red. Buildings se activa junto con Cesium World Terrain, con token y errores visibles. Si falla la lectura del terreno, no se añade el tileset de edificios sobre el elipsoide. Activos y etiquetas usan CLAMP_TO_TERRAIN; las áreas se clasifican sobre el terreno. Se conserva la elevación original del tileset OSM, sin traslaciones artificiales. Se conservan créditos cartográficos. Integración de recursos basada en la [documentación oficial de Cesium](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/); consulta espacial según [ST_DWithin](https://postgis.net/docs/ST_DWithin.html).

## Por qué estas decisiones

- Monolito modular: menos operación y transacciones directas para un MVP de alcance acotado.
- SQL y pg: hace visibles las consultas, índices y capacidades de PostGIS, sin ORM que las oculte.
- Zod + type provider: fuente común de validación, tipos y documentación.
- Sin autenticación aparente: organización única declarada; P1 exige seguridad real.
- Sin Redis, Kubernetes ni microservicios: no hay un requisito probado que los justifique.
- shadcn/ui: componentes Button y Dialog mantenidos en el repositorio, basados en Radix, cva y Tailwind; accesibilidad del diálogo y variantes coherentes.
