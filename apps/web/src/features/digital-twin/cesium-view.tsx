// Workers and imagery assets are served from /cesium/ in dev and production.
import { useEffect, useRef, useState } from 'react';
import {
  Cartesian3,
  Cartesian2,
  Color,
  ColorMaterialProperty,
  Viewer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  Entity,
  ConstantProperty,
  ConstantPositionProperty,
  DistanceDisplayCondition,
  ImageryLayer,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
  Rectangle,
  Credit,
  TileMapServiceImageryProvider,
  buildModuleUrl,
  Ion,
  createOsmBuildingsAsync,
  HeadingPitchRange,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Asset, Installation } from '@geotwin/shared';
import { Crosshair, Layers, Mountain, Plus, Minus } from 'lucide-react';
import { Button } from '../../components/ui/button';
function pnoaProvider() {
  const provider = new WebMapTileServiceImageryProvider({
    url: 'https://www.ign.es/wmts/pnoa-ma',
    layer: 'OI.OrthoimageCoverage',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'GoogleMapsCompatible',
    tilingScheme: new WebMercatorTilingScheme(),
    rectangle: Rectangle.fromDegrees(-10, 35, 5, 45),
    maximumLevel: 19,
    credit: new Credit(
      '<a href="https://www.ign.es/" target="_blank">PNOA © IGN-CNIG · CC-BY 4.0</a>',
      true,
    ),
  });
  return provider;
}
const colors = { healthy: '#34d399', warning: '#fbbf24', critical: '#fb7185' };
interface Props {
  assets: Asset[];
  installations: Installation[];
  installationId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInstallation: (id: string) => void;
}
export default function CesiumView({
  assets,
  installations,
  installationId,
  selectedId,
  onSelect,
  onInstallation,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null);
  const callbacks = useRef({ onSelect, onInstallation });
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [base, setBase] = useState('PNOA'),
    [buildings, setBuildings] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [mapMessage, setMapMessage] = useState('');
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  const buildingsRef = useRef<Awaited<ReturnType<typeof createOsmBuildingsAsync>> | undefined>(
    undefined,
  );
  const baseGeneration = useRef(0);
  useEffect(() => {
    callbacks.current = { onSelect, onInstallation };
  }, [onSelect, onInstallation]);
  useEffect(() => {
    if (!container.current) return;
    let v: Viewer | undefined, handler: ScreenSpaceEventHandler | undefined;
    try {
      Ion.defaultAccessToken = token ?? '';
      v = new Viewer(container.current, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        baseLayer: new ImageryLayer(pnoaProvider()),
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
      viewer.current = v;
      v.scene.backgroundColor = Color.fromCssColorString('#090e17');
      v.scene.globe.baseColor = Color.fromCssColorString('#172537');
      v.scene.globe.enableLighting = false;
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(-4.727, 41.639, 10500),
        orientation: {
          heading: CesiumMath.toRadians(12),
          pitch: CesiumMath.toRadians(-58),
          roll: 0,
        },
        duration: 0,
      });
      handler = new ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((movement: { position: Cartesian2 }) => {
        const picked: unknown = v?.scene.pick(movement.position);
        if (typeof picked === 'object' && picked && 'id' in picked && picked.id instanceof Entity) {
          const id = String(picked.id.id);
          if (id.startsWith('asset:')) callbacks.current.onSelect(id.slice(6));
          if (id.startsWith('installation:')) callbacks.current.onInstallation(id.slice(13));
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
        const picked: unknown = v?.scene.pick(movement.endPosition);
        if (typeof picked === 'object' && picked && 'id' in picked && picked.id instanceof Entity)
          setHover({
            name: picked.id.name ?? 'Activo',
            x: Math.max(
              8,
              Math.min(movement.endPosition.x + 15, (container.current?.clientWidth ?? 400) - 200),
            ),
            y: movement.endPosition.y + 15,
          });
        else setHover(null);
      }, ScreenSpaceEventType.MOUSE_MOVE);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebGL no disponible');
    }
    return () => {
      setReady(false);
      handler?.destroy();
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
      buildingsRef.current = undefined;
    };
  }, [token]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const ids = new Set<string>();
    for (const a of assets) {
      const id = `asset:${a.id}`;
      ids.add(id);
      const color = Color.fromCssColorString(colors[a.status]);
      const existing = v.entities.getById(id);
      if (existing) {
        existing.name = a.name;
        existing.position = new ConstantPositionProperty(
          Cartesian3.fromDegrees(a.location.lng, a.location.lat, 45),
        );
        if (existing.point) existing.point.color = new ConstantProperty(color);
        if (existing.box) existing.box.material = new ColorMaterialProperty(color.withAlpha(0.55));
        if (existing.label) {
          existing.label.text = new ConstantProperty(a.name);
          existing.label.show = new ConstantProperty(selectedId === a.id);
        }
      } else
        v.entities.add({
          id,
          name: a.name,
          position: Cartesian3.fromDegrees(a.location.lng, a.location.lat, 45),
          point: {
            pixelSize: 13,
            color,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Infinity,
          },
          box: {
            dimensions: new Cartesian3(22, 22, 55),
            material: color.withAlpha(0.55),
            outline: true,
            outlineColor: color,
          },
          label: {
            text: a.name,
            font: '13px sans-serif',
            show: selectedId === a.id,
            fillColor: Color.WHITE,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#0b1422'),
            pixelOffset: new Cartesian2(0, -28),
            disableDepthTestDistance: Infinity,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 100000),
          },
        });
    }
    for (const i of installations) {
      const id = `installation:${i.id}`;
      ids.add(id);
      if (!v.entities.getById(id))
        v.entities.add({
          id,
          name: i.name,
          position: Cartesian3.fromDegrees(i.location.lng, i.location.lat),
          ellipse: {
            height: 0,
            semiMajorAxis: 210,
            semiMinorAxis: 210,
            material: Color.CYAN.withAlpha(0.08),
            outline: true,
            outlineColor: Color.CYAN.withAlpha(0.35),
          },
          label: {
            text: i.name,
            font: '12px sans-serif',
            fillColor: Color.CYAN,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#101c30'),
            pixelOffset: new Cartesian2(0, 50),
            disableDepthTestDistance: Infinity,
          },
        });
    }
    for (const entity of [...v.entities.values]) if (!ids.has(entity.id)) v.entities.remove(entity);
    v.scene.requestRender();
  }, [assets, installations, selectedId, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const installation = installations.find((i) => i.id === installationId);
    if (installation)
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          installation.location.lng,
          installation.location.lat - 0.004,
          1100,
        ),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-60), roll: 0 },
        duration: 1,
      });
    else
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(-4.727, 41.639, 10500),
        orientation: {
          heading: CesiumMath.toRadians(12),
          pitch: CesiumMath.toRadians(-58),
          roll: 0,
        },
        duration: 1,
      });
  }, [installationId, installations, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !selectedId || !ready) return;
    const entity = v.entities.getById(`asset:${selectedId}`);
    if (entity)
      void v.flyTo(entity, {
        duration: 1,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 650),
      });
  }, [selectedId, ready]);
  const toggleBase = async () => {
    const v = viewer.current;
    if (!v) return;
    const generation = ++baseGeneration.current;
    try {
      const next = base === 'PNOA' ? 'Local' : 'PNOA';
      const provider =
        next === 'Local'
          ? await TileMapServiceImageryProvider.fromUrl(
              buildModuleUrl('Assets/Textures/NaturalEarthII'),
            )
          : pnoaProvider();
      if (v.isDestroyed() || generation !== baseGeneration.current) return;
      v.imageryLayers.removeAll();
      v.imageryLayers.addImageryProvider(provider);
      v.scene.requestRender();
      setBase(next);
      setMapMessage('');
    } catch {
      setMapMessage('No se pudo cambiar la cartografía.');
    }
  };
  const toggleBuildings = async () => {
    const v = viewer.current;
    if (!v || !token) return;
    if (buildingsRef.current) {
      buildingsRef.current.show = !buildingsRef.current.show;
      setBuildings(buildingsRef.current.show ? 'on' : 'off');
      v.scene.requestRender();
      return;
    }
    setBuildings('loading');
    try {
      const tiles = await createOsmBuildingsAsync();
      if (v.isDestroyed()) {
        tiles.destroy();
        return;
      }
      v.scene.primitives.add(tiles);
      buildingsRef.current = tiles;
      setBuildings('on');
      v.scene.requestRender();
    } catch {
      setBuildings('error');
      setMapMessage(
        'No se pudieron cargar edificios ion. Comprueba los permisos del token y la cobertura.',
      );
    }
  };
  if (error)
    return (
      <div className="state-box">
        <strong>El visor necesita WebGL</strong>
        <p>{error}</p>
        <p>Los activos y las alertas siguen disponibles en el menú.</p>
      </div>
    );
  return (
    <div className="map-shell">
      <div ref={container} className="cesium-host" data-testid="cesium-view" data-ready={ready} />
      <div className="map-top">
        <span className="map-tag">
          <span className="tiny-dot" />
          VALLADOLID, ESPAÑA <b>41.6523° N / 4.7245° W</b>
        </span>
        <span className="map-tag">
          {token ? 'ION READY' : 'BASIC MODE'} · {base}
        </span>
      </div>
      <div className="map-controls">
        <Button
          variant="outline"
          size="icon"
          title="Acercar"
          aria-label="Acercar"
          onClick={() => {
            viewer.current?.camera.zoomIn(viewer.current.camera.positionCartographic.height * 0.4);
            viewer.current?.scene.requestRender();
          }}
        >
          <Plus size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Alejar"
          aria-label="Alejar"
          onClick={() => {
            viewer.current?.camera.zoomOut(viewer.current.camera.positionCartographic.height * 0.4);
            viewer.current?.scene.requestRender();
          }}
        >
          <Minus size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Centrar red"
          aria-label="Centrar red"
          onClick={() =>
            viewer.current?.camera.flyTo({
              destination: Cartesian3.fromDegrees(-4.727, 41.639, 10500),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-58), roll: 0 },
              duration: 1,
            })
          }
        >
          <Crosshair size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Alternar ortofoto PNOA / mapa local sin conexión"
          aria-label="Alternar cartografía"
          onClick={() => void toggleBase()}
        >
          <Layers size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!token || buildings === 'loading'}
          title={
            token
              ? 'Edificios 3D de Cesium ion'
              : 'Configura VITE_CESIUM_ION_TOKEN para edificios 3D'
          }
          aria-label="Edificios 3D"
          onClick={() => void toggleBuildings()}
        >
          <Mountain size={17} />
        </Button>
      </div>
      {hover && (
        <div className="map-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.name}
          <small>Haz clic para inspeccionar</small>
        </div>
      )}
      {mapMessage && (
        <div className="map-message" role="status">
          {mapMessage}
        </div>
      )}
      <div className="map-bottom">
        <div className="map-legend">
          <span>
            <i className="bg-emerald-400" />
            Operativo
          </span>
          <span>
            <i className="bg-amber-400" />
            Advertencia
          </span>
          <span>
            <i className="bg-rose-400" />
            Crítico
          </span>
        </div>
        <span>WGS 84 · SRID 4326 · geometrías demo</span>
      </div>
    </div>
  );
}
