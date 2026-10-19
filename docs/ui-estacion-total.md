# Interfaz «Estación total» con placas flotantes

Diseño y estado final de la interfaz del visor (rama `feat/estacion-total`, creada desde `eac5230` de `feat/laguna-de-duero`). Se construyó en cinco pasos, B1 a B5, cada uno a cargo de un agente distinto que trabajó después del anterior sobre la misma rama. Los apartados 1 a 5 son el diseño que se acordó y que se ha construido; el 6 resume los pasos; los apartados «Estado tras B1» a «Estado tras B4» guardan las decisiones de cada paso, y el último, [«Estado final»](#11-estado-final-tras-b5), dice qué está hecho, qué queda pendiente y en qué se diferencian las capturas de las maquetas.

**Qué eligió David.** La base es la dirección A, «Estación total» (`design/A/concept.md` y sus maquetas). De la dirección C, «Sala de operaciones», se toman solo dos cosas:

- los valores de los sensores dibujados en la escena junto a cada activo;
- el haz de alerta que sube desde el activo.

Del resto de C no entra nada: ni la línea de tiempo de reproducción, ni el menú de lugar, ni sus fuentes o colores.

**Su última preferencia**, que manda sobre la maqueta A donde no coincidan: la interfaz **flota** sobre la escena, como en las maquetas de C (`C/desktop-overview.png`, `C/desktop-asset.png` y `C/phone.png`). Se mantiene el lenguaje visual de A, pero las franjas de A que ocupan todo el ancho del borde se sustituyen por placas sueltas.

## 1. Lenguaje visual (de A)

**Tokens.** Son los de `A/src/hud.css` y van como variables CSS en `styles/globals.css`:

| Token                  | Valor                           | Uso                                  |
| ---------------------- | ------------------------------- | ------------------------------------ |
| `ink-0`                | `#0E0E0D`                       | placas                               |
| `ink-1`                | `#161615`                       | paneles                              |
| `ink-2`                | `#1F1E1C`                       | filas y botones                      |
| `ink-3`                | `#2A2926`                       | pulsado                              |
| `rule`                 | `#363531`                       | filete decorativo                    |
| `rule-2`               | `#706D64`                       | borde de control, 3,5:1              |
| `fg-0`, `fg-1`, `fg-2` | `#EEECE6`, `#BAB6AC`, `#8F8B82` | texto; `fg-2` solo sobre fondo opaco |
| `sig`                  | `#FFD21A`                       | señal, con texto `sig-ink` `#191500` |
| `warn`                 | `#FF9F1A`                       | advertencia                          |
| `alarm`                | `#FF5A4C`                       | crítico                              |
| `alarm-bg`             | `#3A1411`                       | fondo del aviso crítico              |

**Un solo color de instrumento.** El amarillo `sig` se reserva para lo que mide:

- la retícula y la selección;
- las cotas;
- el plano de corte y los puntos A y B;
- el anillo de foco: `0 0 0 2px ink-0, 0 0 0 4px sig`.

El ámbar se usa solo para las advertencias, siempre con un triángulo. El rojo, solo para lo crítico, siempre con un rombo. El estado operativo es un anillo con un punto. Ningún estado se indica solo con el color: siempre van juntos forma, color y palabra.

**Herramienta activa.** Va invertida: fondo `fg-0` y texto `ink-0`. Nunca en amarillo.

**Tipografía.** Se usan IBM Plex Sans Condensed (400, 500 y 600) e IBM Plex Mono (400, 500 y 600). Las dos tienen licencia OFL-1.1 y se instalan con `@fontsource/ibm-plex-sans-condensed@5.3.0` y `@fontsource/ibm-plex-mono@5.3.0` (subconjunto latino). La licencia se cita en el README.

- Los números van en monoespaciada, con cifras tabulares y la coma decimal de `lib/format.ts`.
- Los textos van en minúscula inicial: sin rótulos en mayúsculas, sin titulares de marketing, sin degradados y sin desenfoques.

**Placas.** Son opacas (`ink-0` o `ink-1`, nunca de cristal) para que el texto cumpla el contraste AA sobre una nube muy clara. Tienen:

- radio de 2 px (3 px en las placas grandes y 8 px en el borde superior de las hojas del móvil);
- márgenes de 12 px respecto al borde y huecos de 8 px entre placas;
- una sola sombra: `0 8px 24px rgba(0,0,0,.5)`.

**Suelo oscuro.** `globe.baseColor` pasa de `#172537` a `#1d2420`. En Capas › Fondo hay tres opciones: «Ortofoto PNOA», «Neutro» y «Natural Earth».

- Si la ortofoto no se ve (la desactiva el usuario o fallan todas sus fuentes), el fondo pasa a «Neutro»: el atlas se oculta y queda el suelo oscuro, como en `design/renders/*suelo-oscuro*.png`.
- El atlas Natural Earth sigue disponible como opción, pero ya no es el recurso por defecto.

## 2. Disposición

**La escena llega a los cuatro bordes en todos los tamaños.** El visor (`CesiumView`) se monta una sola vez y no se desmonta nunca: ni al abrir secciones, ni al cambiar de instalación, ni al cambiar la URL. La página no tiene scroll: `100dvh` y `overflow: hidden`.

### Escritorio (1024 px o más; maqueta de referencia a 1440 × 900)

| Placa                      | Posición                                                                                        | Contenido                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lugar**                  | Arriba a la izquierda                                                                           | Botón GeoTwin con el menú (Gemelo, Resumen, Activos, Alertas, Ajustes, Atajos, Documentación de la API) · espacio de trabajo «Laguna de Duero» con la etiqueta discontinua `demo` · selector de instalación · **anunciador**.                                                                                                                                                                                                                          |
| **Herramientas**           | Debajo de Lugar, a 8 px                                                                         | `1 Orbitar` · `2 Medir` · `3 Perfil` · `4 Corte` · `5 Radio` · separador · `C Capas 7/8` (capas visibles de las listas). Cada tecla lleva su tecla visible (`kbd`).                                                                                                                                                                                                                                                                                    |
| **Paneles de herramienta** | Junto a su botón, debajo de la barra y alineados con él                                         | Capas (318 px), Medir y Radio. Solo hay uno abierto a la vez. Se cierran con Esc, con el botón Cerrar o pulsando otra vez la tecla, y el foco vuelve al botón.                                                                                                                                                                                                                                                                                         |
| **Hojas de sección**       | A la izquierda, bajo la barra de herramientas, 560 px                                           | Resumen, Activos, Alertas y Ajustes. Comparten sitio con los paneles de herramienta: abrir una cierra el otro.                                                                                                                                                                                                                                                                                                                                         |
| **Rumbo**                  | Arriba a la derecha, 290 × 54                                                                   | Cinta de rumbo, inclinación, altura de cámara, aguja (clic o `N`: norte arriba) y `+`/`−`. Debajo, `0 Encuadre inicial` y, con una ficha abierta, `F Centrar activo` a su izquierda (como en `A/desktop-asset.png`). A la izquierda de Rumbo, el botón de búsqueda `/`.                                                                                                                                                                                |
| **Ficha del activo**       | Flota junto al activo seleccionado, en el lado con más sitio, unida por una guía de 30 px o más | 372 px de ancho. Se ancla al borde derecho, bajo Rumbo, cuando no cabe sin tapar el activo ni otra placa. También lo hace en tableta y cuando el activo está fuera de la vista.                                                                                                                                                                                                                                                                        |
| **Lectura**                | Abajo a la izquierda                                                                            | Cursor (lat/lon N/O), UTM 30N, Cota, Suelo (MDT), Sobre el suelo y `Tiempo real hh:mm:ss` (`data-testid="connection"`). Con un activo seleccionado muestra Selección y Radio. Sobre la marca o la etiqueta de un activo dice «Activo» y da su posición, su cota (MDT más montaje) y su altura sobre el suelo. Con el puntero en el gráfico del perfil lee el punto bajo su cursor, con «Desde A» en lugar de UTM. Por debajo de 1360 px se oculta UTM. |
| **Escala**                 | Encima de Lectura                                                                               | Barra de 0, 25 y 50 m (con valores redondos), con la nota «en el centro».                                                                                                                                                                                                                                                                                                                                                                              |
| **Créditos**               | Abajo a la derecha, hasta 560 px y en dos líneas si hace falta                                  | Primera línea: el fondo que se ve, por ejemplo «Ortofoto PNOA · relieve LiDAR» (`data-testid="map-base"`). Después, el `creditContainer` de Cesium reubicado aquí, con la atribución LiDAR y la del fondo, y «Instalaciones ficticias · telemetría simulada». Con Fotorrealista, el logotipo y las atribuciones de Google quedan en la placa, que crece.                                                                                               |
| **Avisos**                 | Encima de Créditos, alineados a la derecha, 420 px como máximo                                  | Las notas actuales: `relief-hint`, `map-message` y el corte del tiempo real.                                                                                                                                                                                                                                                                                                                                                                           |
| **Chips de borde**         | En el borde de la zona libre                                                                    | Instalaciones (y activos en alerta) que quedan fuera de la pantalla o bajo una placa; lo que se ve entre las placas no lleva chip, ni tampoco aquello cuya etiqueta o rótulo se ve al menos a medias aunque su marca toque el borde de una placa. Tres como mucho, los más urgentes, y «+n» para ver el resto. Llevan rumbo y distancia, y un clic vuela hasta ellos.                                                                                  |

**Anunciador.** Está dentro de la placa Lugar. Sus celdas siguen a la instalación elegida (con «Todas las instalaciones», a toda la red):

- **Recuentos**, por ejemplo «18 activos ◆1 ▲1». Abre Activos.
- **Alarma activa**, por ejemplo «Crítico · Sonda de nivel · laguna · `simulado`», sobre `alarm-bg`. Abre Alertas. Si hay varias alarmas, muestra la más grave y más reciente, con «+n».
- **Otras instalaciones**, solo con una instalación elegida y alertas activas en otra: «◆ +1 en otras instalaciones» (hasta un escritorio ancho, «+1 en otras», para que quepa el activo de la alarma), sin el fondo de alarma (la forma da la gravedad). Abre Alertas para toda la red; la hoja tiene «Esta instalación · Toda la red».

**Ninguna placa tapa los créditos.** El borde inferior de cualquier panel, hoja, ficha o cajón queda como mínimo 8 px por encima de la placa Créditos.

**Encuadre de cámara.** `coveredByOverlays` (en `overlays.ts`) se amplía a los cuatro bordes y a todas las placas marcadas con `data-map-overlay`. Así, los encuadres dejan el objetivo en la zona libre.

- Se mira al norte desde 45° (como la vista cercana de un activo) y se encaja la caja de terreno de los puntos, con margen para las etiquetas, no una esfera: el borde cercano, el que se ve más grande, es el que tiene que caber (`fitGround`).
- Una instalación (enlace `?instalacion=…` o el selector) llena casi toda la zona libre: Torrelago, con la cámara a unos 540 m sobre el suelo y 760 m de distancia (antes, 1 580 m).
- Toda la red, con nubes cargadas, encuadra las instalaciones que caen dentro de ellas y están juntas (a menos de 700 m unas de otras, `networkFrame`); la que queda lejos, como el depósito del cerro a 1 km, se queda con su chip de borde. Con las cuatro hojas, la cámara queda a unos 1 090 m sobre el suelo en escritorio (944 m en `A/desktop-overview.png`, que mira desde −30°) y a unos 1 230 m en el móvil; antes, a 3 540 y 3 910 m. Sin nubes se encuadran todas.

### Tableta (de 640 a 1023 px)

- Mismas placas que en escritorio.
- Las herramientas muestran la tecla y el icono, con un `title` que da el nombre; cuando la columna de la izquierda no deja sitio para los iconos (por debajo de unos 775 px de ancho), solo la tecla. El nombre sigue siempre en el nombre accesible.
- La ficha del activo va siempre anclada a la derecha, con 360 px.

**La placa Lugar cede por pasos** cuando la pantalla se estrecha (por debajo de unos 1 400 px, también en escritorio). Mide la columna de arriba a la izquierda, que es la pantalla menos las placas de arriba a la derecha (consultas de contenedor en `globals.css`):

1. Primero se va el nombre del espacio de trabajo («Laguna de Duero»; sigue para el lector de pantalla).
2. Después el anunciador baja a una segunda fila del ancho de la placa, donde la alarma tiene sitio para el nombre del activo, y el espacio de trabajo vuelve.
3. En una columna estrecha (tableta pequeña) se va otra vez el espacio de trabajo, «GeoTwin» se queda solo con su marca y la alarma pasa a una tercera fila.

El selector de instalación se acorta con puntos suspensivos. Ninguna parte de la placa se dibuja nunca sobre otra ni fuera de la placa (`hud.spec.ts` lo comprueba a 1024 × 768, 900 × 700 y 700 × 700 con el nombre de instalación más largo).

### Móvil (menos de 640 px; maqueta de referencia a 390 × 844)

- **Placa superior.** Lleva el título (la instalación, o Laguna de Duero), una sublínea con «n activos», `demo` y «Tiempo real», y el botón Menú. Con una alarma activa se añade la fila del anunciador («◆ 1 crítico · Sonda de nivel · `simulado`» y «Ver»).
- **Escala y rumbo.** Dos placas pequeñas bajo la placa superior.
- **Barra de herramientas flotante abajo.** Orbitar, Medir, Perfil, Corte y Capas, con icono y texto y un área de pulsación de 44 px o más. La activa lleva una barra clara y el texto en negrita. No hay tecla Radio: se llega desde «Cercanos y radio» en la ficha.
- **Hojas inferiores.**
  - La del activo tiene tres alturas (25, 45 y 90 %). En la de 90 % están Lecturas, Histórico, Incidencias, Cercanos y radio, y Laboratorio. Al 45 % (y al 90 %), los tres saltos (Histórico, Cercanos y radio, Laboratorio) se quedan enteros sobre el borde de la hoja cuando el contenido sigue debajo.
  - Capas ocupa el 90 %.
  - Las secciones ocupan la pantalla entera.
  - El perfil ocupa el 50 %.
- **Créditos.** Van siempre encima de la hoja o de la barra, en dos líneas, y siempre nombran el fondo.
- **Sin línea de lectura.** Las cifras del cursor solo aparecen en Medir y Perfil, para el punto central. La cruz de Medir y su botón «Centro» apuntan al centro de la escena que queda libre entre la placa superior y los créditos sobre la hoja (`freeCentre`), no al de la pantalla.
- **Zona segura.** La barra, las hojas y los créditos dejan sitio a `safe-area-inset-bottom` cuando el navegador lo da.

## 3. Qué pasa a qué

| Hoy                                                                                                 | En la nueva interfaz                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aside.sidebar`: marca, tarjeta del espacio de trabajo, navegación, tarjeta de marketing, perfil    | Placa **Lugar**, con el menú y el selector                                                                                                                                                                                                                                                                                                                                                                                 |
| `header.topbar`: miga de pan, «Tiempo real», recuento de sensores, selector de instalación, campana | Lugar y anunciador. «Tiempo real» pasa a Lectura. Los sensores activos, a Resumen.                                                                                                                                                                                                                                                                                                                                         |
| Página Resumen (`dashboard.tsx`) y las páginas `/activos`, `/alertas` y `/ajustes`                  | **Hojas de sección** sobre la escena, con el mismo contenido re-maquetado en el lenguaje A                                                                                                                                                                                                                                                                                                                                 |
| Cabecera del gemelo («Explora la red» y «Buscar activo…»)                                           | **Ir a**: paleta en `/` o Ctrl/⌘+K que busca activos, instalaciones y capas sin tener en cuenta acentos ni mayúsculas. Intro vuela y selecciona.                                                                                                                                                                                                                                                                           |
| Fila de chips de activos (`map-asset-strip`)                                                        | Glifos y etiquetas en la escena (B3), la hoja Activos y la paleta. Lista oculta accesible de los activos de la escena, en orden de pantalla.                                                                                                                                                                                                                                                                               |
| Barra «Consulta espacial» y resultados                                                              | Herramienta **5 Radio**: placa con centro, radio (100, 250 y 500 m, 5 km) y lista `ST_DWithin`. B4 añade el anillo sobre el MDT.                                                                                                                                                                                                                                                                                           |
| `AssetDetail` (inspector a la derecha)                                                              | **Ficha del activo** flotante o anclada: estado, posición, UTM, suelo y montaje; sensores con «simulado»; histórico con umbrales y la leyenda «60 lecturas · cada 30 s · de … a …»; incidencias; Laboratorio de anomalías; renombrar; Cercanos.                                                                                                                                                                            |
| Panel Capas flotante a la derecha                                                                   | Panel **Capas** junto a su botón, con los mismos controles: subida con progreso, lista de hojas (mostrar, Ir, detalle, Borrar), color, Todos o Híbrido, calidad, tamaño, EDL, clases ASPRS, Relieve del LiDAR, Altura real, **Fondo** (Ortofoto PNOA, Neutro, Natural Earth) con la línea de fallo de fuentes, Fotorrealista (Google) y Edificios 3D (desactivados con su motivo si no hay token) y la leyenda de estados. |
| Columna de botones del mapa                                                                         | `+`/`−` y norte en Rumbo · «Centrar red» pasa a `0 Encuadre inicial` · «Alternar cartografía» pasa a Capas › Fondo (con las mismas reglas: desactivado bajo la malla de Google y diciendo por qué si fallaron todas las fuentes) · Edificios 3D y Fotorrealista pasan a Capas · Medir pasa a la tecla `2`                                                                                                                  |
| Etiquetas `.map-top` («MODO BÁSICO · ORTOFOTO PNOA · RELIEVE LIDAR», en mayúsculas)                 | `map-base` en Créditos, en minúscula inicial: «Ortofoto PNOA (descargada) · relieve LiDAR», «Fondo neutro (PNOA no disponible) · relieve LiDAR», «Fotorrealista (Google)», «Globo básico». Los textos los da `baseImageryLabel`, adaptado.                                                                                                                                                                                 |
| `.map-bottom`: leyenda de colores y «WGS 84 · SRID 4326 · geometrías demo»                          | Leyenda de formas en Capas. La nota del SRID pasa a Ajustes.                                                                                                                                                                                                                                                                                                                                                               |
| Pie global («DEMO · Instalaciones ficticias…» y el enlace a la API)                                 | Línea de honestidad en Créditos. El enlace a la API va al menú y a Ajustes.                                                                                                                                                                                                                                                                                                                                                |
| Panel Medir                                                                                         | Placa Medir junto a la tecla `2`. Mantiene `measure-results`, «Añadir punto en el centro» y «Al suelo (MDT)». En B3 los resultados también se dibujan en la escena como cotas.                                                                                                                                                                                                                                             |
| Tooltip del activo al pasar el ratón                                                                | Se mantiene, con el estilo nuevo (nombre y estado).                                                                                                                                                                                                                                                                                                                                                                        |

## 4. Qué se quita

- La barra lateral, la tarjeta «Infraestructura conectada» y el perfil de la organización.
- Los titulares de marketing: «Tu infraestructura. En perspectiva.», «Cada activo cuenta una historia.» y «Cada señal, una acción».
- Los rótulos `eyebrow` en mayúsculas.
- La paleta azul marino y cian, las utilidades de cristal y los degradados.
- Los chips de activos bajo el mapa, la barra «Consulta espacial» y las etiquetas `.map-top`.
- La columna de botones del mapa y el pie global.
- Las clases CSS que dejen de usarse. `globals.css` se reescribe sobre los tokens.

## 5. Decisiones comunes

**Rutas.**

- `/gemelo` es la escena sin hoja. `/` lleva a `/gemelo` y sustituye la entrada del historial.
- `/resumen`, `/activos`, `/alertas` y `/ajustes` abren su hoja sobre la escena.
- `instalacion` y `activo` siguen en la consulta, así que los enlaces antiguos `/gemelo?instalacion=…&activo=…` siguen funcionando.
- Abrir o cerrar una hoja añade una entrada al historial, de modo que Atrás la cierra.
- `lib/route.ts` y sus pruebas se actualizan. `/` ya no es Resumen.

**Atajos de una tecla** (`1`–`5`, `C`, `0`, `F`, `N`, `/`, `[`, `]` y `R`; `F` «Centrar activo», de la maqueta A, vuelve a la vista cercana del activo de la ficha y, sin ficha, solo muestra una nota):

- Funcionan en toda la página salvo cuando el foco está en `input`, `textarea`, `select` o `[contenteditable]`, cuando hay un diálogo modal abierto o cuando se pulsa un modificador.
- Ajustes › Atajos tiene un interruptor para apagarlos (WCAG 2.1.4). Se guarda en `localStorage` dentro de `try/catch`.
- Ctrl/⌘+K y Esc funcionan siempre. Esc cierra la placa superior: primero el panel, después la hoja, después la ficha.
- Las flechas y `+`/`−` siguen funcionando con el mapa enfocado.

**Una sola región en vivo, cortés,** anuncia resultados («Perfil listo: 336,2 m, 4 edificios», «Medida: 41,7 m»).

**Alturas en la lectura.**

- Cota, Suelo (MDT) y el perfil se muestran como **altitud ortométrica**: h − N, con la N de la hoja bajo el cursor (`vertical.geoid_offset_m`; el error es menor de 5 cm en una hoja). Así coinciden con PNOA y con las maquetas (Suelo de unos 700 m).
- «Sobre el suelo» es h(punto) − h(MDT).
- Fuera de las hojas se muestra «—» con «fuera de las hojas LiDAR».
- Con el relieve apagado se muestra «—» con «activa Relieve del LiDAR», porque `globeShift` baja la nube unos 700 m y las cifras no casarían. Por lo mismo, las teclas 3 y 4 se desactivan con ese motivo.

**Lecturas de la GPU.**

- `globe.pick` y `globe.getHeight` se calculan en cada movimiento, como mucho una vez por fotograma.
- `scene.pickPosition` y la clase del punto (`scene.pick` y `getProperty('classification')`) solo se leen tras 120 ms de cursor quieto.
- Nada lee la GPU en cada fotograma. Se mantienen `requestRenderMode` y `maximumRenderTimeChange: Infinity`.
- Las animaciones (los pulsos de B3) usan un bucle de motivos de render limitado a 30 fps que se para con la pestaña oculta y con `prefers-reduced-motion`.

**Estado.**

- `stores/tool.ts` guarda la herramienta activa, el panel abierto y la hoja abierta. Sustituye a `stores/measure.ts`, que se convierte en un selector.
- `stores/viewer.ts` publica el `Viewer` para que las placas se suscriban a `camera.changed` (`percentageChanged = 0.001`) y a `postRender` sin pasar por React en cada fotograma: escriben en referencias del DOM.

**Honestidad.**

- «simulado» aparece junto a cada lectura en la ficha, en las hojas y en la alarma del anunciador.
- Las etiquetas de la escena (B3) llevan borde discontinuo, la convención de «dato simulado» que explica la leyenda de Capas, y su `aria-label` termina en «simulado».
- La línea «Instalaciones ficticias · telemetría simulada» y la atribución LiDAR están siempre en pantalla.

**Ortofoto.** La release `data-laguna` aún no tiene `pnoa-laguna-z13-19.zip` (comprobado por última vez el 18/10/2026, antes de las capturas de B5). Por eso todas las capturas se hicieron con el fondo Neutro, y así se dice en sus pies. Nunca se simula una foto.

## 6. Cómo se construyó

Cada paso dejó verdes lint, formato, tipos, unitarias, integración, pytest, build y E2E en local y en CI, sin saltar, desactivar ni borrar ninguna prueba (las que cambiaban de interfaz se adaptaron en el mismo paso), y comparó sus capturas con las maquetas de `design/A` y `design/C` (fuera del repositorio). Las capturas se hicieron con hojas PNOA-LiDAR reales cargadas por la API en un clúster PostgreSQL desechable; solo B5 las copió a `docs/screenshots/`.

| Paso | Qué hizo                                                                                                                                                                                                                            | Pruebas nuevas                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Armazón, tokens y fuentes; placas de escritorio (Lugar y anunciador, Herramientas, Rumbo, Lectura, Escala, Créditos, Avisos, chips de borde); Capas; ficha; Radio como placa; hojas de sección; «Ir a»; rutas; atajos; fondo Neutro | Unitarias de UTM, lectura, escala, colocación de la ficha, chips, atajos, rutas, zona tapada y fondo Neutro; `hud.spec.ts`                                                                                    |
| B2   | Móvil (placa superior, barra de herramientas, hojas al 25, 45 y 90 %); secciones re-maquetadas en el lenguaje A; Ajustes › Atajos; accesibilidad                                                                                    | `contrast.unit.test.ts`, alturas de las hojas, orden de pantalla; `accessibility.spec.ts` (axe a 1440 × 900 y 390 × 844, teclado) y `phone.spec.ts`                                                           |
| B3   | Etiquetas de los sensores en la escena (de C), haces y anillos de alerta (de C), «Reconocer» en la API y en la interfaz, cotas de medición (de A)                                                                                   | Unitarias de colocación de etiquetas, oclusión, haz y cotas; integración de `acknowledge`; `scene-tags.spec.ts`                                                                                               |
| B4   | Perfil A–B con el endpoint `section`, Corte (Ver, Atenuar, Ocultar) y el anillo de Radio                                                                                                                                            | Unitarias de lectura de `.pnts`, MDT a lo largo de A–B, alturas, CSV, polígonos y planos de corte, anillo; integración de `section` frente a laspy; `profile.spec.ts`; comprobación con la hoja real 356-4606 |
| B5   | README y documentación al día, cinco capturas reales nuevas (y la de la medición de la torre), suite completa y CI                                                                                                                  | Ninguna nueva: la suite completa, con los recuentos en [verification.md](verification.md)                                                                                                                     |

## 7. Estado tras B1

**Hecho.** La escena ocupa toda la pantalla y no se desmonta (`features/hud/stage.tsx`); las placas de escritorio, Capas con Fondo (Ortofoto PNOA, Neutro, Natural Earth), Edificios 3D, Fotorrealista y la leyenda; la ficha flotante o anclada; Radio como placa; las hojas; «Ir a»; los chips de borde; la lectura del cursor con UTM 30N y cotas; las rutas nuevas; los atajos con su interruptor en Ajustes. Pruebas: unitarias de UTM, lectura, escala, colocación, chips, atajos, rutas, zona tapada en los cuatro bordes, fondo Neutro y búsqueda de «Ir a»; `tests/e2e/hud.spec.ts` y todas las E2E anteriores adaptadas.

**Decisiones que conviene saber en los pasos siguientes.**

- Los paneles (Capas, Medir, Radio) se abren alineados con el borde izquierdo de la barra de herramientas, no bajo su botón: así los colocan las maquetas A y C, y `coveredEdges` puede contarlos como zona tapada a la izquierda. El foco sigue volviendo al botón que los abrió.
- Las placas no importan Cesium. `cesium-view.tsx` publica en `stores/viewer.ts` (`useScene`) una API mínima creada en `digital-twin/scene-api.ts`: proyectar un punto, leer el suelo y la profundidad, eventos de cámara y de render, zoom, norte arriba, encuadre inicial y los interruptores de Google y de ion. B3 puede añadir ahí lo que necesiten las etiquetas y los haces.
- Toda placa lleva `data-map-overlay`; `features/hud/dom.ts` (`overlayBoxes`) las mide para el encuadre, los chips, las etiquetas de instalación y la ficha.
- `data-testid` útiles: `place-plate`, `annunciator-counts`, `annunciator-alarm`, `heading-plate`, `scale`, `readout` y `readout-<celda>`, `credits`, `map-base`, `section-sheet`, `asset-card`, `meter`, `edge-chip`.
- El móvil solo tiene una adaptación mínima (placas apiladas arriba, ficha y paneles a todo el ancho, sin lectura ni escala): el diseño de `A/phone.png` y `C/phone.png` es de B2.
- Los marcadores de los activos siguen siendo cajas y puntos de Cesium con los colores nuevos; los glifos, las etiquetas y los haces son de B3.

## 8. Estado tras B2

**Hecho.**

- **Móvil** (menos de 640 px): placa superior flotante (instalación como título, «n activos», `demo`, «Tiempo real», «Ir a» y Menú, con la fila del anunciador si hay una alarma), escala y rumbo en dos placas pequeñas, barra de herramientas flotante abajo (Orbitar, Medir, Perfil, Corte y Capas, 44 px o más, sin Radio) y hojas inferiores con alturas de 25, 45 y 90 % (`bottom-sheet.tsx` y `sheet.ts`): se arrastran, se mueven con las flechas, Inicio y Fin, y solo al 90 % son un diálogo modal con el foco atrapado. La ficha va al 45 % con Lecturas, Histórico, Incidencias, Cercanos y radio (abre Radio) y Laboratorio; Capas, al 90 %; Medir y Radio, al 45 %; las secciones, al 90 % (no a pantalla entera, para que los créditos sigan a la vista). Los créditos van siempre justo encima de la hoja o de la barra.
- **Secciones** en el lenguaje A: cifras como celdas de lectura, tablas monoespaciadas con el nombre como botón de la fila (en el móvil, un bloque por fila), estados con forma, color y palabra, gráficos de Recharts con los tokens (`styles/tokens.ts`) y coma decimal, sin titulares.
- **Ajustes**: interruptor de los atajos (`role="switch"`) con la lista de teclas, la nota de coordenadas y alturas (SRID 4326, UTM 30N ETRS89, alturas ortométricas) y el enlace a la documentación de la API.
- **Accesibilidad**: lista oculta de los activos de la escena en orden de pantalla (aparece al recibir el foco, tras la barra de herramientas), anillo de foco amarillo en todo lo enfocable, vuelos de cámara sin animación y hojas sin transición con `prefers-reduced-motion`. `contrast.unit.test.ts` comprueba los pares de tokens; `accessibility.spec.ts`, axe a 1440 × 900 y 390 × 844, el recorrido con teclado y los atajos; `phone.spec.ts`, el móvil.

**Decisiones que conviene saber en los pasos siguientes.**

- Con una hoja al 90 % la placa superior, los avisos y los chips de borde se ocultan (`.hud[data-modal]`): los créditos ocupan su sitio. Para volver al menú hay que bajar o cerrar la hoja.
- Una placa ancha apilada sobre una franja ya tapada (los créditos encima de la hoja) cuenta también como tapada para el encuadre y los chips (`coveredEdges`).
- El perfil de B4 en el móvil puede usar `PhoneSheet` con `snaps={[50]}`.
- La lista oculta (`scene-asset-list.tsx`) es el sitio donde B3 puede reflejar las etiquetas de la escena.

## 9. Estado tras B3

**Hecho.**

- **Etiquetas en la escena** (`features/scene/asset-tags.tsx`, con la colocación pura en `tag-layout.ts` y los textos en `tag-data.ts`): cada activo tiene una marca a la altura que resuelve su marcador (anillo con punto, triángulo ámbar o rombo rojo; hueca si algo la tapa), un mástil hasta el MDT si está montado en altura y una etiqueta de borde discontinuo con la última lectura del sensor en peor estado, con coma decimal. Las advertencias y los críticos añaden nombre y palabra hasta 700 m; hasta 2 km solo va el valor; más lejos, solo la marca. La colocación prueba ocho posiciones con la prioridad crítico › advertencia › seleccionado › resultado de Radio › operativo, nunca tapa una placa ni otra etiqueta y oculta la que no cabe. El `aria-label` de cada etiqueta termina en «simulado», y la lista oculta de la escena repite el valor con su etiqueta `simulado`. Las cajas y los puntos de Cesium de los activos ya no se dibujan: la entidad se conserva (posición y referencia de altura) y la marca DOM recibe el clic.
- **Oclusión**: tras cada parada de cámara y con las teselas cargadas, tres lecturas de `pickPosition` en una cruz de 3 px; si dos tienen algo más de 3 m por delante, la marca queda hueca y la etiqueta de un operativo atenúa su marco (el texto conserva el contraste). A más de 750 m el margen pasa a ser el 0,4 % de la distancia: a 4 km la profundidad y los discos de la nube no dan para 3 m y casi todas las marcas salían tapadas.
- **Haces y anillos** (`alert-beams.ts`): un haz vertical de 250 m (crítico) o 60 m (advertencia) sobre la normal geodésica, de 14 o 10 px, y dos anillos de 18 m que se expanden mientras la alerta no está reconocida. Los anillos se dibujan sin prueba de profundidad para que una cornisa no los esconda. El bucle de 30 fps se para con la pestaña oculta, con movimiento reducido y con un renderizador que no llega a unos 16 fotogramas por segundo (como SwiftShader): entonces los anillos quedan quietos. `cesium-view` publica `data-beams`, `data-pulses` y `data-pulse-motion`.
- **Reconocer**: `PATCH /api/alerts/:id/acknowledge` (migración `009`, campo `acknowledged_at`, evento `alert:updated`, idempotente; un escalado de advertencia a crítico vuelve a dejarla sin reconocer). Botón en la ficha (tecla `R`, también en Ajustes › Atajos), en Alertas (columna «Reconocida») y en el detalle de la incidencia. La ficha añade «Resolver» junto a cada incidencia.
- **Cotas** (`features/measure/dimension-lines.ts`): las medidas se dibujan con línea amarilla de 1,5 px sobre halo oscuro, discontinua donde la tapa la nube, marcas en los extremos y el valor en Plex Mono 500 13 px sobre amarillo: cada tramo y el total, el área en el centroide y el desnivel como cota vertical (desde 1 m, con el valor a la derecha). La ficha del activo seleccionado dibuja la cota de montaje («41,9 m sobre el suelo») en lugar del mástil; su valor es una etiqueta DOM que se aparta de la ficha.

**Decisiones que conviene saber en los pasos siguientes.**

- `DataSourceCollection.add` se resuelve más tarde: con el doble montaje de `StrictMode`, una fuente quitada antes de entrar se quedaba vacía en la colección. Las fuentes nuevas (haces, cota de montaje) y la de Medir esperan a la promesa antes de quitarse.
- Las etiquetas de la escena evitan las placas (`overlayBoxes`) y las etiquetas de instalación (`labelBoxes`, que publica `cesium-view`). B4 puede añadir a `blocked` el cajón del perfil y el anillo de Radio, y marcar los resultados de Radio, que ya suben de prioridad (`useTool().radius.ids`).
- Sobre Google (Fotorrealista) el ancla es `scene.sampleHeight` en cada parada de cámara, sin los haces; no se ha podido probar en este entorno.

**Capturas de comparación** (`…/estacion/shots/B3/`, cuatro hojas reales, fondo Neutro porque la release aún no trae la ortofoto, SwiftShader):

- Vista general frente a `C/desktop-overview.png` (`cmp-overview.jpg`), con una alerta crítica simulada en la pasarela de la torre sur y una advertencia en la sonda: misma estructura (valores junto a cada activo con guía, rótulo con nombre, valor y palabra del crítico, haz rojo desde la torre y haz ámbar en la laguna) sobre las placas de A. Diferencias: el haz es más estrecho que el de la maqueta (14 px, como dice el plan); la sonda, a más de 700 m, solo muestra el valor; los rótulos de instalación siguen siendo los de B1, sin recuentos.
- Activo en alerta frente a `C/desktop-asset.png` (`cmp-asset.jpg`): haz, anillos, ficha flotante con la incidencia arriba («Reconocer» y «Resolver» a mano) y la cota de montaje. La ficha se coloca a la izquierda porque es el lado con más sitio en este encuadre; el anillo de Radio y la línea de tiempo de C no entran (el anillo es de B4).
- Cota de montaje frente a `A/phone.png` y la medición documentada de la torre (`cmp-montaje.jpg`): «41,9 m sobre el suelo» del MDT a la cubierta, y Medir sobre la cubierta y el pie de la torre da 54,7 m en 3D, 35,4 m en horizontal y **−41,7 m** de desnivel, el mismo valor que en [laguna-de-duero.md](laguna-de-duero.md). En el móvil el aviso de ortofoto no disponible ocupa parte de la escena (solo pasa sin la foto).

## 10. Estado tras B4

**Hecho.**

- **Endpoint `GET /api/layers/:id/section`** (`apps/api/src/modules/layers/section.ts`, contrato `sectionQuery`/`sectionSchema` en `packages/shared`): recorre el `tileset.json`, descarta las teselas cuya caja no toca la franja y lee los `.pnts` (`POSITION` o `POSITION_QUANTIZED`, `RTC_CENTER`, transformaciones del tileset y de cada tesela, RGB y la clase de la tabla de lotes, también por `BATCH_ID`) de todos los niveles. La vista previa que py3dtiles pone en la raíz (una tesela `REPLACE` con hijos, copia de la primera) no cuenta: con esa regla la suma de las teselas da exactamente el `point_count` de la capa. Columnas `s`, `d`, `h`, `cls` y `rgb` ordenadas por `s`, la N de la capa y el recuento; LRU en memoria, `ETag` y gzip (unos 70 KB para los 8.287 puntos de la línea de la maqueta). Errores: 400 (A o B no válidos, a menos de 1 m, más de 2 km, `half` fuera de 0,25–5 m), 404, 409 `LAYER_NOT_READY` y 413 `SECTION_TOO_LARGE` (más de 400.000 puntos).
- **Perfil (tecla 3)**: A y B se ponen con `globe.pick(camera.getPickRay())` y se arrastran (la cámara se queda quieta mientras); una línea discontinua sigue al puntero hasta poner B. En la escena, la línea sobre el MDT con marcas cada 50 m, A y B en amarillo, el contorno discontinuo del plano hasta el punto más alto y las alturas E1…En como cotas. El cajón flota abajo, entre los márgenes, sobre la escala y la lectura y sin tapar los créditos ni los avisos (en el móvil, hoja al 50 %): gráfico en lienzo a escala 1:1 con exageración 1:1, 2:1 y 5:1 (el lienzo crece hacia arriba y se desplaza), línea del MDT cada metro (`section-math.ts`, la bilineal del MDT ya cargado), puntos en RGB o por clase más tenues lejos del plano, cursor compartido con la escena (también al pasar el puntero cerca de la línea en el mapa), lectura en el cursor, «Alturas en el corte» (percentil 95 de la clase 6 menos la mediana del MDT; un hueco de más de 8 m separa edificios, de modo que dos alas de un bloque con un patio quedan juntas) y «Exportar CSV» (`;`, coma decimal, BOM para Excel). Una sola región en vivo anuncia «Perfil listo: 336,2 m, 4 edificios».
- **Corte (tecla 4)**: interruptor sobre el perfil (si no hay perfil, lo empieza). «Ver» recorta con un `ClippingPolygonCollection` la caja delante de la franja, del lado de la cámara (se recalcula al parar la cámara si cambia de lado), en cada tileset, también en los que cargan después (`cloudTilesets` en `point-cloud-layers.ts`); «Atenuar» además multiplica por 0,38 el color fuera de la franja con el `CustomShader` de puntos redondos y dos planos en coordenadas de ojo; «Ocultar» deja solo la franja (`inverse`). Sin WebGL 2, `ClippingPlaneCollection` con los mismos planos (`cutPlanes`, con su signo probado) y la matriz privada en `clippingPlanesMatrix`. Suelo recortado con rejilla de 10 m clasificada sobre el terreno (color liso si no hay materiales en el suelo). Fotorrealista y EDL se apagan mientras dura el corte y vuelven al quitarlo. `cesium-view` publica `data-cut` (`front`, `dim`, `hide`).
- **Relieve**: sin el relieve del LiDAR, 3 y 4 están desactivados con «Activa «Relieve del LiDAR» en Capas: lo usan Perfil y Corte»; apagarlo con el perfil abierto lo cierra.
- **Radio (tecla 5)**: consulta en cuanto cambia el centro o el radio (100, 250, 300, 500 m o 5 km; el 300 es el de la maqueta); un clic en el mapa fija otro centro. Anillo discontinuo sobre el MDT (un punto cada 5 m a la altura bilineal del modelo, más tenue donde la nube queda delante: clasificado sobre el terreno, como decía el plan, la nube lo tapaba), disco tenue clasificado, «r = 300 m · 5 activos dentro» sobre el anillo y una guía con la distancia a cada activo. La ficha lista el resultado en «Cercanos» con el mismo selector; los activos encontrados que quedan fuera de la vista o tapados tienen chip de borde. `data-radius` y `data-radius-count`.
- **Teclas**: `[` y `]` estrechan o ensanchan la franja (0,25 a 5 m); Esc cierra el perfil después del panel.
- **Correcciones de la revisión de `feat/laguna-de-duero`** (`eac5230..10e7d05`), unidas con un merge y llevadas a las placas flotantes: bajo la malla de Google se ocultan la capa PNOA y su crédito (`data-base-imagery="google"`); la nota de Híbrido y el título de la casilla Suelo nombran la malla de Google en Capas; con todas las fuentes PNOA caídas, los otros botones de Capas › Fondo dicen que también quitan el aviso («Ocultar el aviso y quedarse con el atlas» o «… con el fondo neutro»), que es lo que decía el título de «Alternar cartografía»; la capa de Google se da por fallida si falla la raíz, si falla el arranque o si no llega ninguna tesela en 30 s; el MDT mezcla las hojas cercanas en una muesca cóncava. El aviso de Medir ya no hace falta como en la interfaz antigua: el panel Medir cuelga de la barra de herramientas (o es una hoja en el móvil) y termina por encima de las placas de abajo, donde están los avisos; la prueba comprueba que aviso y panel no se tapan y que los créditos se leen enteros a 1440×900 y a 390×844.
- **Foco al cerrar**: un panel o una hoja que se cierra devuelve el foco a su botón en el mismo momento (`focusBack` en `hud/dom.ts`) y solo espera un fotograma si el botón aún no puede recibirlo. Antes siempre esperaba al siguiente fotograma, y en el ejecutor de CI el fotograma que redibuja la escena que deja libre una hoja al 90 % tardaba más de 5 s con SwiftShader: la prueba del móvil fallaba porque el foco seguía en el cuerpo de la página.
- **Etiqueta de Radio**: «r = 300 m · 5 activos dentro» se coloca, cada vez que para la cámara, en el punto del anillo más cercano al borde inferior que queda dentro de la vista y libre de placas (`labelSpot`, con prueba unitaria), y unos píxeles por encima del anillo, para que los trazos no la crucen.
- **Etiquetas durante el perfil**: con la herramienta Perfil activa, los activos operativos se quedan solo con su marca (la franja es lo que se mira); las advertencias, los críticos y el seleccionado conservan su etiqueta (`lodFor(…, quiet)`, con prueba unitaria).
- **Perfil en el móvil**: la placa de ayuda es una sola línea («Toca el mapa para poner A», sin teclas ni leyenda del corte, que ya dice la hoja) y los controles de la hoja caben en dos filas: los nombres de grupo («Fuera de la franja», «Color», «Exageración») siguen para el lector de pantalla, pero no se ven. En la escena las cotas de los edificios dicen solo E1…E4 cuando la vista mide menos de 640 px de ancho (con el valor se pisaban; la hoja da las alturas), y el gráfico ocupa 150 px de alto, de modo que su eje de distancias queda dentro de la hoja al 50 % en una pantalla de 844 px.
- **La ficha y Radio**: la ficha flotante deja a la vista los resultados de Radio en pantalla (cada uno con 28 px de margen); si no encuentra sitio junto al activo sin taparlos, se acopla a la derecha, como en `A/desktop-asset.png` (`placeCard(…, keep)`, con prueba unitaria).

**Capturas** (`estacion/shots/B4/`, con las 4 hojas reales cargadas, fondo neutro porque la release `data-laguna` no trae la ortofoto, SwiftShader; cada una junto a su maqueta en `cmp-*.jpg`):

- `b4-perfil-corte.png` frente a `A/desktop-signature.png`: misma línea A–B sobre Torrelago y mismo encuadre (148°, −30,5°). Coinciden la longitud (336,2 m), los 8.287 puntos (8.282 en la maqueta), la lectura en el cursor a 245,4 m (cota 742,4 m, MDT 701,3 m, +41,1 m) y E1…E4 (29,5 · 37,9 · 38,0 · 41,1 m). Cambia lo que pidió David: el cajón flota entre márgenes por encima de la escala y la lectura, con los créditos libres a la derecha, y las placas de arriba flotan sobre la escena. Con el perfil activo, los activos operativos se quedan con su marca y la advertencia y el crítico conservan su etiqueta. La placa de alarma y el chip del crítico dicen «Pasarela LoRa · torre sur» porque es la alarma que tiene la base de datos de desarrollo, no la de la maqueta.
- `b4-radio-sonda.png` frente a `A/desktop-asset.png`: Radio de 300 m alrededor de la sonda de la laguna, con la laguna, el anillo discontinuo sobre el MDT, «r = 300 m · 5 activos dentro» por encima del anillo y la lista `ST_DWithin` (65, 180, 196, 199 y 274 m, los mismos de la maqueta). La ficha se acopla a la derecha, como en la maqueta, porque flotando junto a la sonda tapaba los resultados. La sonda está en advertencia (1,95 m) y no en crítico como en la maqueta: es el valor simulado del momento. Los resultados que quedan detrás de la ficha o fuera de la vista tienen chip de borde.
- `b4-movil-perfil.png` frente a `A/phone.png` y `C/phone.png`: placa superior y barra de herramientas flotantes, el perfil en una hoja al 50 % con el gráfico 1:1 y su eje, los créditos enteros por encima de la hoja y E1…E4 sin valor en la escena.

**Decisiones que conviene saber en el paso siguiente.**

- La parte de Cesium de las tres herramientas va en su propio chunk diferido (`section-scene.tsx`); el cajón es React sin Cesium. Comparten estado por `stores/section.ts` y `stores/tool.ts`; `cesium-view` publica `data-profile="on"` cuando ya se puede picar A y B.
- El rumbo del perfil es el verdadero (251°), no el de la cuadrícula UTM de la maqueta (252°): en Laguna de Duero difieren en la convergencia de meridianos, 1,1°. La longitud también es la del elipsoide (336,2 m; la de la cuadrícula es 336,17 m).
- Con el cajón abierto la escena libre se reduce a la franja entre la barra de herramientas y el cajón: las capturas encuadran la línea ahí.
- Las E2E esperan hasta 10 s en cada aserción (`expect.timeout` en `playwright.config.ts`) y `demo.spec.ts` y la primera de `base-imagery.spec.ts` tienen 180 s: en el ejecutor de GitHub, un fotograma de SwiftShader puede tener ocupada la página varios segundos y esas dos pruebas tardan más de 1,5 min. En CI una prueba que falla se repite una vez (`retries`); si pasa, el informe la marca como «flaky» y la anotación de la ejecución lo dice: en tres ejecuciones seguidas fallaron pruebas distintas que en local pasan siempre (`demo.spec.ts` esperando «Operativo», `accessibility.spec.ts` buscando el interruptor de Ajustes, `profile.spec.ts` proyectando A antes de que la cámara dibujara), sin que los tiempos del resto cambiaran.
- Las capturas usan `/src/stores/*.ts` desde la página: si el Vite compartido (5311) ha recargado un módulo (por ejemplo, porque una E2E reconstruyó `packages/shared`), la página importa otra copia del store y la herramienta no responde. Reiniciar Vite antes de capturar lo evita.

## 11. Estado final (tras B5)

**Hecho.** Todo lo de los apartados 1 a 5 funciona, salvo lo que se lista abajo como pendiente: escena a pantalla completa con placas flotantes opacas, anunciador, teclas 1–5 y C con sus paneles, lectura del cursor con UTM 30N y cotas ortométricas, ficha flotante o anclada, hojas de sección, «Ir a», chips de borde, móvil con placa superior, barra flotante y hojas, etiquetas de los sensores y haces de alerta en la escena, «Reconocer», cotas de medición, Perfil A–B, Corte y el anillo de Radio. En B5:

- **Documentación**: README (capturas, «Qué funciona», Teclado, Medición, Perfil A–B y corte, pruebas y licencias de las fuentes), `demo-guide.md`, `architecture.md` (placas, rutas, atajos, etiquetas y haces, `section`, corte y radio), `laguna-de-duero.md` (perfil y alturas), `api.md` (`acknowledge` y `section`), `fotorrealista.md` (dónde están el interruptor y los créditos) y `verification.md`.
- **Capturas** en `docs/screenshots/`: `estacion-vista-general.jpg`, `estacion-alerta.jpg`, `estacion-capas.jpg`, `estacion-perfil-corte.jpg`, `estacion-movil.jpg` y `estacion-medicion-torre.jpg`, con las ocho hojas reales y el fondo neutro. Las capturas antiguas que ya no muestran la interfaz se han borrado; se conservan `laguna-antes-despues.jpg` (compara el dibujo de la nube y lo dice), `lidar-12m.png` y `terrain-buildings.jpg` (registros de verificación).
- **Dos arreglos** que salieron al mirar las capturas: con Capas abierto, el chip de borde de una instalación lejana se colocaba encima de la etiqueta de un sensor (las etiquetas de la escena y los rótulos de instalación evitan ahora también los chips, `sceneBlockers`); y la etiqueta de un activo en alerta cuya marca queda tapada bajaba al 55 % de opacidad, con el texto rojo o ámbar por debajo del contraste AA (ahora solo se atenúan las de los operativos, `fadesTag`).
- **Suite completa y CI** con los recuentos en [verification.md](verification.md), junto con la comparación de cada captura con su maqueta.

**Tras la tercera verificación.**

- **Placa Lugar en pantallas estrechas**: por debajo de unos 1 250 px el selector de instalación se dibujaba encima de los recuentos y la alarma se quedaba en una franja roja ilegible. Ahora la placa cede por pasos (ver [Tableta](#tableta-de-640-a-1023-px)) y las herramientas de la tableta llevan icono.
- **Rendimiento al mover la cámara**: la lectura de la cámara estaba en el estado de `Stage`, la raíz de la aplicación, y cada fotograma de una órbita volvía a dibujar toda la interfaz. Ahora va a un almacén pequeño (`CameraFeed` en `heading-plate.tsx`) que solo leen Rumbo y Escala, y el visor, Medir y la escena de Perfil y Radio están memorizados. Las cifras, en [verification.md](verification.md).
- **Chips de borde**: no repiten lo que se ve (etiqueta o rótulo a la vista), se recolocan cuando una placa cambia de tamaño, cuando llega el relieve y poco después de parar la cámara, y su flecha lleva asta, para que se lea igual en cualquier ángulo.
- **Radio**: la etiqueta del radio evita los propios trazos del anillo y la ficha flotante deja a la vista las distancias de los resultados, no solo su punto.
- **Perfil**: las cotas E1…En evitan las marcas A y B.
- **Desarrollo local**: `db:migrate` y `db:seed` compilan antes los paquetes compartidos, así que funcionan nada más hacer `npm ci`.

**Tras las notas menores de la tercera verificación.**

- **Sin «ResizeObserver loop»**: `Stage` medía las placas de arriba y de abajo dentro de su `ResizeObserver` y escribía `--hud-top` y `--hud-bottom`, que cambian el tamaño de paneles, hojas y ficha, observados a su vez por los chips de borde; el navegador lo daba como error de la ventana (37 veces en una pasada de las E2E). Ahora la medida va al siguiente fotograma. Todas las E2E fallan si aparece ese error y `layout-errors.spec.ts` abre y cierra Capas, dos hojas, la ficha y el cajón del perfil en escritorio y en móvil.
- **Lectura del cursor sobre una marca**: las marcas y etiquetas están encima del lienzo, así que al pasar sobre ellas todas las casillas se quedaban en «—». Ahora la placa dice «Activo» y da la posición conocida del activo (grados, UTM 30N y MDT), como la selección.
- **Rótulos de instalación**: guardan el margen de la interfaz (12 px, 10 en el móvil) con todos los bordes de la vista y, si ningún sitio queda libre de marcas, toman el que menos tapa; A, B, la línea y el contorno del perfil cuentan como marcas (`scene-marks.ts`).
- **Capas**: la barra y la etapa («descargando») de una hoja en proceso van en la columna del texto, debajo del nombre.
- **E2E de Perfil**: la prueba ponía la cámara sobre `globe.getHeight`, que justo al llegar el relieve aún puede ser el elipsoide; la cámara quedaba bajo el suelo y A no llegaba a la pantalla (el fallo intermitente de CI). Ahora usa el MDT de la aplicación y espera a que el punto esté dentro de la página.

**Tras las notas menores de la cuarta verificación (escena).**

- **Rótulos de instalación con recuentos**: debajo del nombre, en Plex Mono, «6 activos · ◆ 1 crítico · ▲ 1 advertencia» o «6 activos · sin alertas», cada aviso con su forma, su color y su palabra, como las etiquetas de los activos. Los rótulos son ahora DOM sobre el lienzo (como las etiquetas) y no etiquetas de Cesium; cuando no hay sitio para las dos líneas, o solo lo hay encima de las marcas, el rótulo pierde primero los recuentos y se queda con el nombre (`placeLabels` con `compact`).
- **Radio**: las distancias de cada resultado y «r = 300 m · n activos dentro» cuentan como obstáculo para los rótulos de instalación, las etiquetas de los activos y los chips de borde (`addSceneLabels` en `scene-marks.ts`), como ya lo eran los valores de Medir y del perfil. Antes «136 m» quedaba debajo del rótulo de Torrelago y «171 m», bajo un chip.
- **Perfil visto de lejos**: la línea A–B, las cifras de sus marcas de distancia y las cotas de los demás edificios son obstáculo para E1…En, que suben un escalón en lugar de quedar cruzados. El contorno discontinuo del plano no cuenta: un valor puede quedar sobre su borde superior, y se lee entero.
- **Gráfico del perfil**: la cifra amarilla del cursor no se sale del gráfico en A ni en B (antes «336,2» quedaba cortada por el borde derecho), y los nombres y las alturas de los edificios («E2», «37,9») van sobre una pequeña placa del color del cajón para que los puntos del edificio no los crucen.
- **Etiqueta del activo elegido**: se coloca antes que ninguna otra y, si entera (nombre, valor y palabra) no cabe en ninguno de los ocho sitios, se queda con el valor y su forma en lugar de desaparecer. A 1280 × 800 con Alertas y la ficha abiertas, la pasarela crítica de la torre sur salía solo con su marca.

**Tras las notas menores de la cuarta verificación (lectura, placas y móvil).**

- **Lectura sobre una marca**: el activo bajo el puntero solo se cambiaba al entrar en un elemento (`pointerover`), así que «Activo» se quedaba al salir de la página desde la marca, cuando la marca se apartaba de un puntero quieto (un vuelo) o desaparecía, y tras un toque. Ahora también lo deciden `pointerout`, una comprobación tras cada fotograma y cada cambio de las marcas, y un toque nunca lo crea (`nextHover`). La línea del activo da también su Cota (MDT más montaje) y «Sobre el suelo» (el montaje).
- **Lectura del perfil**: con el puntero (o las flechas) en el gráfico, la placa de abajo lee el punto bajo su cursor, como `A/desktop-signature.png`: «Desde A», posición, UTM, Cota, Suelo (MDT) y altura sobre el suelo. Fuera del gráfico vuelve al cursor de la escena.
- **Tecla `F` «Centrar activo»**: vuela a la vista cercana del activo de la ficha conservando el rumbo; con una ficha abierta tiene su placa junto a `0 Encuadre inicial`; sin ficha, una nota breve lo dice. Está en Ajustes › Atajos, en la tabla del README y en la guarda de los campos de texto.
- **Anunciador**: la alarma sigue ahora a la instalación elegida, como los recuentos. Las alertas de las demás se cuentan en «+n en otras instalaciones», que abre Alertas para toda la red. Antes, con Torrelago elegido, la alarma nombraba la sonda de la laguna.
- **Móvil, Medir**: la cruz estaba fija al 50 % de la pantalla y, con la hoja al 45 %, caía sobre los créditos. Ahora va al centro de la escena libre, y «Centro» mide ese punto.
- **Móvil, ficha al 45 %**: Histórico, Cercanos y radio y Laboratorio quedaban cortados por el borde de la hoja, justo encima de la barra. Ahora se pegan a ese borde, enteros, y el resto de la hoja pasa por debajo.
- **Encuadres**: ver [Encuadre de cámara](#escritorio-1024-px-o-más-maqueta-de-referencia-a-1440--900). Un enlace a Torrelago ponía la cámara a 1,6 km (Torrelago ocupaba una sexta parte del ancho; ahora, a 760 m) y el móvil encuadraba también el depósito del cerro, con la nube en una esquina.

**Pendiente o distinto del diseño.**

- **Ortofoto real.** Ninguna captura la lleva: la release `data-laguna` no trae `pnoa-laguna-z13-19.zip` y el entorno no llega a IDEE ni al IGN. Que esos servidores acepten las peticiones del navegador (CORS) sigue sin comprobarse.
- **Google Photorealistic 3D Tiles** sigue sin probarse con Google: solo con una malla local que sustituye la respuesta de Cesium ion ([prueba manual](fotorrealista.md#prueba-manual)).
- **El vídeo de 40 s** es de la interfaz anterior; no se ha vuelto a grabar.
- **Leyenda de Altura** en Capas: una barra de «baja» a «alta», no la regla vertical con cotas de `A/desktop-capas.png`; con varias hojas cada una usa su propio rango.
- **Perfil**: con el perfil abierto la franja superior de la escena cuenta entera como tapada para el encuadre, pero desde la segunda verificación los chips de borde solo salen para lo que está fuera de la pantalla o bajo una placa.
- **Encuadre a −45°**: la maqueta mira desde −30° con rumbo 150°; los encuadres miran al norte desde −45°, como la vista cercana de un activo, para que las etiquetas no se amontonen al fondo.
