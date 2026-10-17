# Capa fotorrealista (Google), opcional

El visor puede poner debajo de los activos la malla 3D fotorrealista de **Google Photorealistic 3D Tiles**, servida a través de **Cesium ion** (asset 2275207). Es una opción para enseñar el entorno con aspecto real; no sustituye a la nube PNOA-LiDAR, que sigue siendo la base medida del gemelo.

**No se ha podido probar con Google de verdad.** El entorno en el que se ha desarrollado no tiene salida a `cesium.com` ni a los servidores de Google. Lo que sí está probado es la lógica alrededor: una prueba E2E sustituye la respuesta de Cesium ion por una malla plana local y comprueba el interruptor, el globo oculto, los activos apoyados en la malla, la medición, el crédito en pantalla, los mensajes de error (401 y 429) y que, tras un fallo sin conexión, otro clic vuelve a preguntar a ion sin recargar la página; las pruebas unitarias cubren la carga y la clasificación de errores con dobles. Los pasos de la [prueba manual](#prueba-manual) sirven para confirmarlo con una cuenta real.

## Qué hace

- El botón **Fotorrealista (Google)** (icono de edificio, en la columna de controles del mapa) **solo aparece si la web se ha construido con `VITE_CESIUM_ION_TOKEN`**. Sin token no se ofrece.
- Al activarlo se carga el tileset con `createGooglePhotorealistic3DTileset` de CesiumJS, que, sin clave propia de Google, lo pide a Cesium ion. Se carga **una sola vez**: apagarlo y encenderlo después solo lo oculta y lo muestra, para no volver a pedir la tesela raíz (cuenta para la cuota).
- Con la capa activa:
  - Se **oculta el globo**: las teselas de Google ya incluyen el suelo. Con él se ocultan el relieve del LiDAR y la cartografía de fondo (ortofoto PNOA o atlas); el control **Fondo** de Capas queda desactivado («Oculto con Fotorrealista») y conserva su valor. El modo **Híbrido (sin suelo)** se puede usar: la malla hace de suelo. Si estaban cargados los edificios OSM de ion, también se ocultan (serían los mismos edificios dos veces).
  - Los **activos** se apoyan en la malla, en su posición (`HeightReference.RELATIVE_TO_3D_TILE`): la pasarela de una cubierta queda sobre la cubierta de la malla, sin sumar su altura de montaje, porque la malla ya tiene el edificio. Las áreas de las instalaciones se dibujan sobre la malla y sus etiquetas se pegan a ella.
  - Las **nubes PNOA** se siguen pudiendo mostrar encima, a su altura real, desde el panel Capas. Donde la nube y la malla coinciden, se tapan una a otra según cuál quede delante en cada píxel.
  - **Medir** funciona igual: el clic toma la profundidad de lo dibujado, ahora la malla. «Al suelo (MDT)» sigue usando el modelo del terreno del LiDAR si hay hojas cargadas.
  - La **atribución** de Google y de sus proveedores de datos se muestra en el propio mapa (`showCreditsOnScreen`), como exigen sus condiciones, junto a la de PNOA-LiDAR si hay nubes visibles.
- Al apagarla vuelven el globo, el relieve del LiDAR y la cartografía de fondo que estuviera elegida.
- El visor no tiene geocodificador, así que no se usa ningún otro geocodificador con estas teselas (las condiciones de Google lo exigen).

## Errores

Si algo falla, la capa no se activa (o se desactiva sola) y el visor sigue con la vista LiDAR. El mensaje aparece sobre el mapa:

| Situación                                                | Cómo se detecta                                                               | Mensaje (resumido)                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| El token no tiene el asset 2275207 o no autoriza esa URL | HTTP 401, 403 o 404 de Cesium ion                                             | «El token de Cesium ion no da acceso…»               |
| Cuota mensual agotada                                    | HTTP 429, o un mensaje con «quota»                                            | «La cuenta de Cesium ion ha agotado su cuota…»       |
| Sin conexión                                             | El navegador está desconectado o la petición no recibe respuesta              | «Sin conexión con Cesium ion o con Google…»          |
| Otro fallo                                               | Cualquier otra respuesta                                                      | «No se pudo cargar la capa fotorrealista de Google…» |
| Fallan teselas con la capa ya activa                     | Una tesela rechazada (401, 403, 429) o 8 fallos seguidos sin ninguna correcta | El de la tabla según el caso; la capa se apaga sola  |

El código exacto que devuelve Cesium ion al agotar la cuota no se ha podido comprobar; se trata como cuota cualquier 429 o mensaje que la mencione, y el resto cae en «Otro fallo» sin romper el visor.

## Condiciones de uso

- Hace falta una cuenta de **Cesium ion** con el asset **Google Photorealistic 3D Tiles (2275207)** añadido a «My Assets» y un token con acceso a él.
- El plan gratuito **Community** de Cesium ion es para uso **personal o no comercial** y tiene una **cuota mensual de teselas raíz** de Google (cada carga de la capa la consume). Esta demo **no debe publicarse con ese token**: una demo pública agotaría la cuota y no es un uso personal.
- Un `VITE_*` acaba **dentro del bundle**: cualquiera que abra la web puede leer el token. Usa un token de solo lectura, limitado a los assets necesarios y a la URL desde la que lo vas a abrir (por ejemplo `http://localhost:5173`).
- Las teselas, sus imágenes y su atribución son de Google y sus proveedores, sujetas a las condiciones de Google Maps Platform y de Cesium ion. No se descargan, no se guardan en el repositorio y no se usan en las capturas ni en el vídeo de este repositorio.

## Prueba manual

Hace falta una cuenta propia de Cesium ion. Unos 10 minutos.

1. En [ion.cesium.com](https://ion.cesium.com/), en **Asset Depot**, busca «Google Photorealistic 3D Tiles» y pulsa **Add to my assets**. Comprueba en **My Assets** que aparece con el id **2275207**.
2. En **Access Tokens**, crea un token nuevo con el ámbito `assets:read`, limitado a los assets 2275207, 1 (Cesium World Terrain) y 96188 (OSM Buildings), y a la URL `http://localhost:5173` (o `http://localhost:8080` con Docker).
3. Pon el token en `.env` como `VITE_CESIUM_ION_TOKEN=…` y arranca la web (`npm run dev`, o `docker compose up -d --build --wait`: la imagen web lo toma al construirse).
4. Abre la escena con las hojas de Laguna de Duero cargadas y el panel **Capas** (tecla `C`). Comprueba que el interruptor «Fotorrealista (Google)» está activo (sin token aparece desactivado con el motivo).
5. Púlsalo. En unos segundos deberías ver la malla de Google; la placa de créditos dice «Fotorrealista (Google)» y el interruptor queda marcado. Comprueba:
   - abajo a la derecha, en la placa de créditos, el logotipo o el texto de Google y sus proveedores de datos, sin abrir ningún desplegable;
   - que no se ve el mapa de fondo ni el relieve del LiDAR (solo la malla);
   - que los marcadores de Torrelago están sobre las cubiertas de las torres y los de la laguna en la orilla;
   - que con **Medir**, dos clics en el suelo dan una distancia razonable y uno en una cubierta y otro al pie de su torre dan unos 42 m de desnivel;
   - que en Capas se pueden ocultar y mostrar las nubes PNOA encima de la malla.
6. Vuelve a pulsar el interruptor: regresan el mapa de fondo y el relieve del LiDAR. Púlsalo otra vez: la malla vuelve sin esperar (no se vuelve a cargar).
7. Errores (opcional): con un token sin el asset 2275207 el mapa debe decir «El token de Cesium ion no da acceso…» y seguir con la vista LiDAR; con la red cortada (modo sin conexión de las herramientas del navegador) antes de pulsar, «Sin conexión…».
8. En la página de la cuenta de Cesium ion, mira el consumo de Google 3D Tiles: cada carga de la capa cuenta una sesión de tesela raíz.

Si algún punto no se cumple, anota el mensaje del mapa y lo que muestre la consola del navegador.
