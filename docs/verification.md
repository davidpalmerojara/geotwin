# Verificación

Verificación local el 12 de octubre de 2026. Node 24.19, Docker Desktop 28.4, Compose 2.39. PostgreSQL 17 / PostGIS 3.5 en contenedor real. No se ha desplegado públicamente ni creado recursos AWS.

## Estado por fase

| Fase            | Implementación y archivos principales                                                                                   | Comandos y resultado                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Fundamentos | npm workspaces, `package-lock.json`, `docker-compose.yml`, migración y seeds en `database/`, configuración Vite/Fastify | `npm install`, `docker compose up -d db --wait`, `npm run db:migrate`, `npm run db:seed`: ejecutados correctamente tras recuperar Docker                                                                                              |
| 2 — Backend     | `apps/api/src/modules/`, `db/`, `app.ts`; Zod compartido y OpenAPI                                                      | `npm run test:integration`: **13/13** pasadas con PostgreSQL/PostGIS real; incluye ST_DWithin, índice, persistencia, SQL parametrizado, concurrencia, resolución y WebSocket                                                          |
| 3 — Frontend    | Dashboard, inventario, visor Cesium, inspector, centro de incidencias y Settings                                        | Build Vite verificado. Visor WebGL, selección, fly-to, diálogo y responsive comprobados en Chromium. Capturas locales en `screenshots/`                                                                                               |
| 4 — Realtime    | Servicio transaccional, generador, hub, reconexión y sincronización REST                                                | **1 smoke E2E pasó** con dashboard → Cesium → fallo → resolución y segundo cliente actualizado por WebSocket. No se usan mocks REST                                                                                                   |
| 5 — Calidad     | ESLint, Prettier, TypeScript estricto, Vitest, Playwright, GitHub Actions, Dockerfiles, documentación y plantilla ECS   | `npm run check`, `npm run format:check`: correctos. `npm audit --omit=dev`: **0 vulnerabilidades**. Imagen API compilada y `docker compose up -d api --wait` saludable. **Ambas imágenes construidas y Compose completo funcionando** |

Los 5 tests unitarios verifican umbrales exactos, reproducibilidad, anomalías periódicas UUIDs hexadecimales y contratos de entrada/eventos. La CI está configurada, pero no se ha ejecutado remotamente porque no se ha publicado un repositorio ni activado GitHub Actions.

## Incidencias corregidas

- Cliente REST enviaba Content-Type JSON en un PATCH sin cuerpo: Fastify lo rechazaba. Se envía Content-Type únicamente cuando hay body; el E2E de resolución pasó después de la corrección.
- Carrera de reconexión al recuperar red: handlers de sockets anteriores ya no alteran la conexión vigente.
- Tipos Cesium: Cartesian2 real y ColorMaterialProperty para actualización de materiales.
- Gráficos con animación durante snapshots/refetch: se dibujan sin animación para que la lectura vigente aparezca completa.
- Servicio público de teselas OSM devolvía imágenes de bloqueo. Se cambió a WMTS PNOA del IGN, cuyo GetCapabilities y GetTile se verificaron (HTTP 200, image/jpeg, CORS). Los créditos del productor permanecen visibles.

## Verificación final y recuperación del entorno

La máquina llegó a menos de 200 MB libres. Hubo ENOSPC, congelación de Docker, errores de entrada/salida y corrupción de archivos en el contexto de BuildKit. También desapareció el ejecutable Chromium de la caché del entorno durante las verificaciones. Estos fallos provocaron builds y E2E fallidos inicialmente.

Después de recuperarse aproximadamente 6 GB libres, se reinstaló Chromium, se renovaron los cuatro archivos afectados en el contexto Docker (los originales estaban íntegros) y se repitieron las verificaciones. El smoke selecciona el **atlas local real** mediante el control del visor: usa Cesium, REST, PostGIS y WebSocket, sin depender de teselas externas y sin mocks de API.

Resultado final:

- `npm test`: **5/5** correctas.
- `npm run test:integration`: **13/13** correctas, contra PostGIS real.
- `npm run test:e2e`: **1/1** correcto en desarrollo local, con actualización de segundo cliente y chequeo responsive.
- `docker compose build api` y `docker compose build web`: **correctos**.
- `docker compose up -d --wait`: **correcto**; API y base saludables, web funcionando.
- `http://localhost:8080/`, `/api/health`, `/api/docs/` y atlas de Cesium: **HTTP 200**; health confirma PostGIS **3.5.2** y simulador activo.
- `E2E_BASE_URL=http://localhost:8080 npm run test:e2e`: **1/1 correcto sobre los contenedores de producción**, en 26,8 segundos. Verifica persistencia, cambio visual a crítico, notificación a segundo cliente y resolución.
- Lint, TypeScript estricto, formato y build de producción: **correctos**. Auditoría de dependencias npm de producción: **0 vulnerabilidades** en la revisión realizada.

Los edificios ion no se verificaron porque no se suministró token. El aviso de tamaño del bundle Cesium (~4 MB minificados) se conserva; se carga mediante import dinámico. La CI está preparada, no se ha ejecutado en GitHub.

La demo queda arrancada localmente en **http://localhost:8080**. No se ha publicado en internet ni ejecutado la plantilla AWS. Para detenerla conservando el volumen: `docker compose stop`.

Para repetir las pruebas, ejecutar **secuencialmente**:

```bash
npm run check
npm run format:check
npm run test:integration
npm run test:e2e
docker compose up -d --build --wait
curl --fail http://localhost:8080/api/health
E2E_BASE_URL=http://localhost:8080 npm run test:e2e
```

La API local de los tests necesita 3001 libre: si la instancia Compose está activa, detener primero `api` y `web` con `docker compose stop api web`. No ejecutar integración y E2E simultáneamente: comparten la base exclusiva `geotwin_test`. El E2E contra Compose crea y resuelve una anomalía en su demo local.

`CAPTURE_DEMO=true npm run test:e2e` genera capturas reales en `docs/screenshots/`. Las capturas incluidas muestran iteraciones locales, no sustituyen el smoke final. PNOA GetCapabilities y GetTile se verificaron por separado; las teselas externas pueden tardar y el atlas local ofrece modo sin internet. No se necesita una limpieza general de Docker para usar la entrega; disponer de 8 GB libres evita repetir la presión de disco observada.

## Pendiente hacia producción

Autenticación, autorización y aislamiento multiempresa (P1), infraestructura AWS real autorizada y validada, retención/particionado, observabilidad, limitación de peticiones y estrategia de difusión para múltiples réplicas. Importación GeoJSON y análisis avanzado en P2. La app se presenta expresamente como demo local de una organización.
