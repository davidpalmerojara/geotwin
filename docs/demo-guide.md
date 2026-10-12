# Demostración de 90 segundos

Antes: arranca Compose, comprueba `/api/health`, deja el token ion vacío para evitar dependencias opcionales y usa un navegador con WebGL. No borres histórico: resuelve las incidencias previas desde Alerts si quieres iniciar con contadores a cero. Si llevas mucho tiempo con el simulador activo puede haber anomalías naturales nuevas.

1. **0–15 s · Overview.** Muestra 18 activos, 36 sensores y tres instalaciones. Explica: coordenadas reales de Valladolid, instalaciones ficticias y telemetría simulada. El dashboard consulta PostgreSQL, no tiene cifras hardcodeadas.
2. **15–30 s · Digital Twin.** Selecciona **Pisuerga · Water Hub** en la barra superior; la cámara vuela a la instalación. Pulsa el marcador o el chip **Pump 01**. Enseña sus sensores, histórico y umbrales.
3. **30–45 s · Anomalía.** Selecciona Temperatura y pulsa **Simular fallo**. Aparece una lectura de 95,2 °C frente al umbral crítico de 85 °C. Marcador e inspector se vuelven críticos y aparece una incidencia. El evento se transmite a otras pestañas abiertas.
4. **45–60 s · Persistencia.** Pulsa la incidencia **Alerta crítica** y muestra severidad, mensaje, UUID y fecha. Opcional: entra en Overview para ver el contador de alertas actualizado y vuelve al gemelo.
5. **60–75 s · Resolución.** Pulsa **Marcar como resuelta**. El backend elimina el fallo simulado, inserta una lectura basal y actualiza el estado si no quedan otras incidencias. El marcador vuelve a verde.
6. **75–90 s · Evidencia técnica.** Muestra Alerts → Resueltas. En el gemelo ejecuta **Buscar cercanos** con radio 500 m: resultado calculado por ST_DWithin y distancia en metros. Abre `/api/docs` para enseñar el contrato validado.

Para demostrar resincronización: abre dos pestañas, genera el fallo en una y observa la otra. Interrumpe temporalmente la red de una pestaña, resuelve desde la segunda y restaura la conexión: la primera consulta REST tras reconectar y recupera el estado vigente.

Si falta internet cartográfico, alterna al mapa local de baja resolución; sensores, alertas y consultas siguen usando la red local. Si el equipo no ofrece WebGL, la UI informa del fallo del visor; usa un navegador con aceleración gráfica para enseñar el P0 completo.
