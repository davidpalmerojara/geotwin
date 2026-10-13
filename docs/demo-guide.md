# Demostración de 90 segundos

Antes: arranca Compose, comprueba `/api/health`, deja el token ion vacío para evitar dependencias opcionales y usa un navegador con WebGL. No borres histórico: resuelve las incidencias previas desde Alertas si quieres iniciar con contadores a cero. Las anomalías naturales del simulador se cierran solas cuando la lectura vuelve a la normalidad; puede haber alguna abierta durante menos de un minuto.

1. **0–15 s · Resumen.** Muestra 18 activos, 36 sensores y tres instalaciones. Explica: coordenadas reales de Valladolid, instalaciones ficticias y telemetría simulada. El dashboard consulta PostgreSQL, no tiene cifras hardcodeadas.
2. **15–30 s · Gemelo digital.** La cámara encuadra toda la red. Selecciona **Pisuerga · Water Hub** en la barra superior; la cámara encuadra esa instalación. Pulsa el marcador o el chip **Pump 01**. Enseña sus sensores, histórico y umbrales.
3. **30–45 s · Anomalía.** Selecciona Temperatura y pulsa **Simular fallo**. Aparece una lectura de 95,2 °C frente al umbral crítico de 85 °C. Marcador e inspector se vuelven críticos y aparece una incidencia. El evento se transmite a otras pestañas abiertas.
4. **45–60 s · Persistencia.** Pulsa la incidencia **Alerta crítica** y muestra severidad, mensaje, UUID y fecha. Opcional: entra en Resumen para ver el contador de alertas actualizado y vuelve al gemelo.
5. **60–75 s · Resolución.** Pulsa **Marcar como resuelta**. El backend elimina el fallo simulado, inserta una lectura basal y actualiza el estado si no quedan otras incidencias. El marcador vuelve a verde.
6. **75–90 s · Evidencia técnica.** Muestra Alertas → Resueltas. En el gemelo, con Pump 01 seleccionado, ejecuta **Buscar cercanos** con radio 500 m: la consulta se centra en el activo y devuelve los activos calculados por ST_DWithin, con su distancia en metros. Copia la URL (`/gemelo?instalacion=…&activo=…`) en otra pestaña: abre la misma instalación y el mismo activo. Abre `/api/docs` para enseñar el contrato validado.

**Capas LiDAR y medición (60 s más, opcional).** Antes, sube una vez la nube **sintética** `apps/worker/tests/fixtures/synthetic-laguna-duero.laz` desde el panel **Capas** del gemelo (o déjala para hacerlo en directo: tarda unos segundos). Explica que no son datos medidos y que una hoja real de PNOA-LiDAR sigue el mismo camino.

1. **Subida y progreso.** Arrastra el fichero al panel: verás _En cola_, _Procesando N %_ con su etapa y _Lista_, empujados por WebSocket desde el worker. La cámara vuela a la nube, a unos 7 km al sur de las instalaciones.
2. **Estilos.** Cambia entre **RGB**, **Altura** (con una sola capa visible, la leyenda da sus alturas elipsoidales en metros) y **Clasificación**, y desmarca **Suelo** para dejar edificios, árboles y agua. Señala la atribución en los créditos del visor y que desaparece al ocultar la capa.
3. **Medir.** Pulsa la regla y haz clic en un tejado y en el suelo de al lado: 3D, horizontal y desnivel (unos 7-9 m en el edificio grande). Cambia a **Área** y rodea el tejado. Comenta que las distancias horizontales son geodésicas sobre WGS84 y que con el globo básico la nube se dibuja apoyada en el elipsoide sin alterar las medidas.

Para demostrar resincronización: abre dos pestañas, genera el fallo en una y observa la otra. Interrumpe temporalmente la red de una pestaña, resuelve desde la segunda y restaura la conexión: la primera consulta REST tras reconectar y recupera el estado vigente.

Si falta internet cartográfico, alterna al mapa local de baja resolución; sensores, alertas y consultas siguen usando la red local. Si el equipo no ofrece WebGL, la UI informa del fallo del visor; usa un navegador con aceleración gráfica para enseñar el P0 completo.
