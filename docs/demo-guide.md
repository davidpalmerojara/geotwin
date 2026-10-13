# Demostración de 90 segundos

Antes: arranca Compose, comprueba `/api/health`, deja el token ion vacío para evitar dependencias opcionales y usa un navegador con WebGL. Carga una vez las ocho hojas de Laguna de Duero con `scripts/upload-layers.sh` (unos 4 minutos; ver [Laguna de Duero con datos reales](laguna-de-duero.md)). No borres histórico: resuelve las incidencias previas desde Alertas si quieres iniciar con contadores a cero. Las anomalías naturales del simulador se cierran solas cuando la lectura vuelve a la normalidad; puede haber alguna abierta durante menos de un minuto.

1. **0–15 s · Resumen.** Muestra 18 activos, 36 sensores y tres instalaciones. Explica: instalaciones ficticias en Laguna de Duero, colocadas sobre sitios que se ven en la nube LiDAR real, y telemetría simulada. El dashboard consulta PostgreSQL, no tiene cifras hardcodeadas.
2. **15–30 s · Gemelo digital.** La cámara encuadra la red sobre la nube PNOA-LiDAR, con su suelo como relieve. Selecciona **Laguna y zona deportiva** en la barra superior; la cámara encuadra esa instalación. Pulsa el marcador o el chip **Sonda de nivel · laguna**, en la orilla. Enseña sus sensores (nivel y temperatura del agua), histórico y umbrales.
3. **30–45 s · Anomalía.** Con Nivel seleccionado, pulsa **Simular fallo**. Aparece una lectura de 2,35 m frente al umbral crítico de 2,1 m. Marcador e inspector se vuelven críticos y aparece una incidencia. El evento se transmite a otras pestañas abiertas.
4. **45–60 s · Persistencia.** Pulsa la incidencia **Alerta crítica** y muestra severidad, mensaje, UUID y fecha. Opcional: entra en Resumen para ver el contador de alertas actualizado y vuelve al gemelo.
5. **60–75 s · Resolución.** Pulsa **Marcar como resuelta**. El backend elimina el fallo simulado, inserta una lectura basal y actualiza el estado si no quedan otras incidencias. El marcador vuelve a verde.
6. **75–90 s · Evidencia técnica.** Muestra Alertas → Resueltas. En el gemelo, con la sonda seleccionada, ejecuta **Buscar cercanos** con radio 500 m: la consulta se centra en el activo y devuelve los activos calculados por ST_DWithin, con su distancia en metros. Copia la URL (`/gemelo?instalacion=…&activo=…`) en otra pestaña: abre la misma instalación y el mismo activo. Abre `/api/docs` para enseñar el contrato validado.

**Nube de puntos y medición (60 s más, opcional).**

1. **Capas.** Abre el panel: ocho hojas `PNOA_…` listas, con sus puntos, los de solape descartados y la ondulación del geoide aplicada. Señala la atribución de PNOA-LiDAR en los créditos del visor. Si quieres enseñar el pipeline en directo, arrastra la nube **sintética** `apps/worker/tests/fixtures/synthetic-laguna-duero.laz`: verás _En cola_, _Procesando N %_ con su etapa y _Lista_, empujados por WebSocket desde el worker.
2. **Estilos.** Acércate a las torres de Torrelago y cambia entre **RGB**, **Altura** y **Clasificación**; desmarca **Suelo** para dejar edificios y árboles.
3. **Medir.** Pulsa la regla y haz clic en la cubierta de una torre y en el suelo de al lado: unos 42 m de desnivel. Cambia a **Área** y rodea la laguna: unas 3,7 ha. Comenta que las distancias horizontales son geodésicas sobre WGS84 y que el relieve es el modelo del terreno sacado de la propia nube.

Para demostrar resincronización: abre dos pestañas, genera el fallo en una y observa la otra. Interrumpe temporalmente la red de una pestaña, resuelve desde la segunda y restaura la conexión: la primera consulta REST tras reconectar y recupera el estado vigente.

Si falta internet cartográfico, alterna al mapa local de baja resolución; la nube, sensores, alertas y consultas siguen usando la red local. Si el equipo no ofrece WebGL, la UI informa del fallo del visor; usa un navegador con aceleración gráfica para enseñar el P0 completo.
