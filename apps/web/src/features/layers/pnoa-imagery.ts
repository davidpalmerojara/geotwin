/**
 * The PNOA orthophoto over the globe (and over the LiDAR relief, which it drapes on by itself).
 * The viewer has no base layer of its own (the neutral ground is the globe's colour; the Natural
 * Earth atlas is added underneath only when chosen). The PNOA layer is added once, on top, from
 * the first source whose probe tile loads, and Capas › Fondo only shows or hides it, so its tile
 * cache survives toggles. While the Google mesh is the ground the layer (and so its credit) is
 * hidden too.
 * If the source in use starts failing (a refusal, or a run of errors) the next one takes over;
 * when none is left the layer is removed and the viewer says so.
 */
import { useEffect, useState } from 'react';
import {
  Credit,
  ImageryLayer,
  Rectangle,
  UrlTemplateImageryProvider,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type TileProviderError,
  type Viewer,
} from 'cesium';
import { useLayerView } from '../../stores/layers';
import {
  IGN_WMTS_LAYER,
  ImageryFailureWatch,
  PNOA_CREDIT_HTML,
  pickSource,
  pnoaSources,
  probeSource,
  type PnoaSource,
} from './base-imagery';

/** Whether the PNOA layer should be drawn: wanted, and not under the Google mesh. */
const shownIn = (s: { baseImagery: string; photoreal: boolean }) =>
  s.baseImagery === 'pnoa' && !s.photoreal;

function providerOf(source: PnoaSource, maximumLevel: number): ImageryProvider {
  const common = {
    tilingScheme: new WebMercatorTilingScheme(),
    rectangle: Rectangle.fromDegrees(...source.rectangle),
    minimumLevel: source.minimumLevel,
    maximumLevel: Math.min(source.maximumLevel, maximumLevel),
    credit: new Credit(PNOA_CREDIT_HTML, true),
  };
  if (source.kind === 'wmts')
    return new WebMapTileServiceImageryProvider({
      ...common,
      url: source.url,
      layer: IGN_WMTS_LAYER,
      style: 'default',
      format: 'image/jpeg',
      tileMatrixSetID: 'GoogleMapsCompatible',
    });
  return new UrlTemplateImageryProvider({ ...common, url: source.url });
}

/**
 * Keeps the PNOA layer in step with the store: probed and added the first time the orthophoto
 * is wanted, shown or hidden afterwards. `maximumLevel` caps the zoom level of the photo tiles
 * (lower on phones, see imageryLevelFor).
 */
export function usePnoaImagery(viewer: Viewer | null, ready: boolean, maximumLevel: number) {
  const wanted = useLayerView((s) => s.baseImagery === 'pnoa');
  // Becomes true the first time the orthophoto is wanted and stays so: hiding it never unloads.
  const [go, setGo] = useState(wanted);
  if (wanted && !go) setGo(true);

  // Probe and add once per viewer, as soon as the orthophoto is wanted.
  useEffect(() => {
    if (!viewer || !ready || !go) return;
    const v = viewer;
    const setPnoa = useLayerView.getState().setPnoa;
    const sources = pnoaSources({
      sources: import.meta.env.VITE_PNOA_SOURCES as string | undefined,
      tileUrl: import.meta.env.VITE_PNOA_TILE_URL as string | undefined,
    });
    let layer: ImageryLayer | undefined;
    let cancelled = false;
    const use = async (start: number) => {
      setPnoa({ state: 'probing' });
      const pick = await pickSource(sources, (s) => probeSource(s), start);
      if (cancelled || v.isDestroyed()) return;
      if (!pick.source) {
        if (pick.failures.length) console.warn('Ortofoto PNOA no disponible:', pick.failures);
        setPnoa({ state: 'error' });
        v.scene.requestRender();
        return;
      }
      const source = pick.source;
      const provider = providerOf(source, maximumLevel);
      const watch = new ImageryFailureWatch();
      let abandoned = false;
      // A tile that arrives resets the run of failures.
      const request = provider.requestImage.bind(provider);
      provider.requestImage = (x, y, level, req) => {
        const promise = request(x, y, level, req);
        void promise?.then(
          () => watch.loaded(),
          () => undefined,
        );
        return promise;
      };
      provider.errorEvent.addEventListener((error: TileProviderError) => {
        // Cesium keeps the parent tile's imagery for a failed tile: never retry in a loop.
        error.retry = false;
        if (abandoned || cancelled || v.isDestroyed() || !watch.failed(error.error)) return;
        abandoned = true;
        if (layer) v.imageryLayers.remove(layer, true);
        layer = undefined;
        void use(pick.index + 1);
      });
      layer = new ImageryLayer(provider, { show: shownIn(useLayerView.getState()) });
      v.imageryLayers.add(layer);
      setPnoa({ state: 'on', source: source.id });
      v.scene.requestRender();
    };
    void use(0);
    const unsubscribe = useLayerView.subscribe((s, previous) => {
      if (shownIn(s) === shownIn(previous) || !layer || v.isDestroyed()) return;
      layer.show = shownIn(s);
      v.scene.requestRender();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (layer && !v.isDestroyed()) v.imageryLayers.remove(layer, true);
      layer = undefined;
      useLayerView.getState().setPnoa({ state: 'off' });
    };
    // Started once per viewer: later toggles only flip `show` through the subscription above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, ready, go]);
}
