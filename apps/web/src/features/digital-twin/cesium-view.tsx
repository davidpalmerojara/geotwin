// Workers and imagery assets are served from /cesium/ in dev and production.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  createWorldTerrainAsync,
  Cartographic,
  HeightReference,
  ClassificationType,
  sampleTerrainMostDetailed,
  HeadingPitchRange,
  BoundingSphere,
  PerspectiveFrustum,
  JulianDate,
  Ellipsoid,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Asset, Installation } from '@geotwin/shared';
import { Crosshair, Layers, Mountain, Plus, Minus, Ruler } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { loadIonEnvironment } from './ion-environment';
import { fitDistance, frameOf, type LatLng } from './camera';
import { coordinates } from '../../lib/format';
import { usePointCloudLayers } from '../layers/point-cloud-layers';
import { useLayerView } from '../../stores/layers';
import { useMeasure } from '../../stores/measure';
// The measuring tool is only downloaded when it is first opened.
const MeasureTool = lazy(() => import('../measure/measure-tool'));
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
// Oblique view that fits every point on desktop and on a portrait phone.
function flyToPoints(v: Viewer, points: LatLng[], duration: number) {
  const frame = frameOf(points);
  if (!frame || v.isDestroyed()) return;
  const canvas = v.scene.canvas;
  const aspect =
    canvas.clientWidth && canvas.clientHeight ? canvas.clientWidth / canvas.clientHeight : 1;
  const fov =
    (v.camera.frustum instanceof PerspectiveFrustum ? v.camera.frustum.fov : undefined) ??
    Math.PI / 3;
  v.camera.flyToBoundingSphere(
    new BoundingSphere(Cartesian3.fromDegrees(frame.center.lng, frame.center.lat, 0), frame.radius),
    {
      offset: new HeadingPitchRange(
        0,
        CesiumMath.toRadians(-55),
        fitDistance(frame.radius, fov, aspect),
      ),
      duration,
    },
  );
  v.scene.requestRender();
}
interface Props {
  assets: Asset[];
  installations: Installation[];
  installationId: string;
  region: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInstallation: (id: string) => void;
}
export default function CesiumView({
  assets,
  installations,
  installationId,
  region,
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
  const [terrain, setTerrain] = useState<'ellipsoid' | 'world'>('ellipsoid');
  const ionLoading = useRef<Viewer | null>(null);
  const measuring = useMeasure((s) => s.active),
    setMeasuring = useMeasure((s) => s.setActive);
  usePointCloudLayers(ready ? viewer.current : null, ready, terrain === 'world');
  const cloudsShown = useLayerView(
    (s) => Object.entries(s.render).filter(([id, r]) => r === 'shown' && !s.hidden[id]).length,
  );
  const colorMode = useLayerView((s) => s.colorMode);
  useEffect(() => () => setMeasuring(false), [setMeasuring]);
  const tooltip = useRef<HTMLDivElement>(null);
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  const buildingsRef = useRef<Awaited<ReturnType<typeof createOsmBuildingsAsync>> | undefined>(
    undefined,
  );
  const baseGeneration = useRef(0);
  const selectedRef = useRef(selectedId);
  const framed = useRef(false);
  useEffect(() => {
    callbacks.current = { onSelect, onInstallation };
  }, [onSelect, onInstallation]);
  useEffect(() => {
    if (!container.current) return;
    let v: Viewer | undefined, handler: ScreenSpaceEventHandler | undefined;
    let pointer: Cartesian2 | undefined;
    let hoverFrame = 0;
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
      setTerrain('ellipsoid');
      setBuildings('off');
      v.scene.backgroundColor = Color.fromCssColorString('#090e17');
      v.scene.globe.baseColor = Color.fromCssColorString('#172537');
      v.scene.globe.enableLighting = false;
      v.scene.globe.depthTestAgainstTerrain = true;
      handler = new ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((movement: { position: Cartesian2 }) => {
        // While measuring, clicks add measurement points instead of selecting.
        if (useMeasure.getState().active) return;
        const picked: unknown = v?.scene.pick(movement.position);
        if (typeof picked === 'object' && picked && 'id' in picked && picked.id instanceof Entity) {
          const id = String(picked.id.id);
          if (id.startsWith('asset:')) callbacks.current.onSelect(id.slice(6));
          if (id.startsWith('installation:')) callbacks.current.onInstallation(id.slice(13));
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      // Hover picking: at most one scene.pick per animation frame, and the tooltip is moved
      // directly in the DOM so mouse moves never re-render this component.
      handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
        pointer = Cartesian2.clone(movement.endPosition, pointer);
        if (!hoverFrame) hoverFrame = requestAnimationFrame(pickHover);
      }, ScreenSpaceEventType.MOUSE_MOVE);
      const pickHover = () => {
        hoverFrame = 0;
        const tip = tooltip.current;
        if (!v || v.isDestroyed() || !tip || !pointer) return;
        if (useMeasure.getState().active) {
          tip.style.display = 'none';
          return;
        }
        const picked: unknown = v.scene.pick(pointer);
        const entity =
          typeof picked === 'object' && picked && 'id' in picked && picked.id instanceof Entity
            ? picked.id
            : undefined;
        v.scene.canvas.style.cursor = entity ? 'pointer' : '';
        if (!entity) {
          tip.style.display = 'none';
          return;
        }
        const width = container.current?.clientWidth ?? 400;
        tip.firstChild!.textContent = entity.name ?? 'Activo';
        tip.style.left = `${Math.max(8, Math.min(pointer.x + 15, width - 200))}px`;
        tip.style.top = `${pointer.y + 15}px`;
        tip.style.display = '';
      };
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebGL no disponible');
    }
    return () => {
      setReady(false);
      cancelAnimationFrame(hoverFrame);
      handler?.destroy();
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
      framed.current = false;
      buildingsRef.current = undefined;
      if (ionLoading.current === v) ionLoading.current = null;
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
          Cartesian3.fromDegrees(a.location.lng, a.location.lat, 0),
        );
        if (existing.point) existing.point.color = new ConstantProperty(color);
        if (existing.box) {
          existing.box.material = new ColorMaterialProperty(color.withAlpha(0.55));
          existing.box.outlineColor = new ConstantProperty(color);
        }
        if (existing.label) {
          existing.label.text = new ConstantProperty(a.name);
          existing.label.show = new ConstantProperty(selectedId === a.id);
        }
      } else
        v.entities.add({
          id,
          name: a.name,
          position: Cartesian3.fromDegrees(a.location.lng, a.location.lat, 0),
          point: {
            heightReference: HeightReference.CLAMP_TO_TERRAIN,
            pixelSize: 13,
            color,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Infinity,
          },
          box: {
            heightReference: HeightReference.CLAMP_TO_TERRAIN,
            dimensions: new Cartesian3(22, 22, 55),
            material: color.withAlpha(0.55),
            outline: true,
            outlineColor: color,
          },
          label: {
            heightReference: HeightReference.CLAMP_TO_TERRAIN,
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
            classificationType: ClassificationType.TERRAIN,
            semiMajorAxis: 210,
            semiMinorAxis: 210,
            material: Color.CYAN.withAlpha(0.08),
          },
          label: {
            heightReference: HeightReference.CLAMP_TO_TERRAIN,
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
  // Frame the selected installation (its assets and centre) or the whole network.
  // Keyed on positions only, so status updates and renames never move the camera.
  const frameKey = JSON.stringify(
    (() => {
      const installation = installations.find((i) => i.id === installationId);
      const scoped = installation
        ? assets.filter((a) => a.installation_id === installation.id)
        : assets;
      return [
        ...scoped.map((a) => a.location),
        ...(installation ? [installation.location] : installations.map((i) => i.location)),
      ].map(({ lat, lng }) => ({ lat, lng }));
    })(),
  );
  const framePoints = useMemo(() => JSON.parse(frameKey) as LatLng[], [frameKey]);
  const placeCenter = useMemo(() => frameOf(framePoints)?.center, [framePoints]);
  const place = installations.find((i) => i.id === installationId)?.name ?? region;
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !framePoints.length) return;
    // A selected asset has its own close-up; do not pull the camera away from it.
    if (selectedRef.current && framed.current) return;
    flyToPoints(v, framePoints, framed.current ? 1 : 0);
    framed.current = true;
  }, [framePoints, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !selectedId || !ready) return;
    // Fly straight to the asset position. Viewer.flyTo(entity) waits for the entity's
    // bounding sphere in a later render; with requestRenderMode that flight could stay
    // pending until an unrelated update and then start from a stale view.
    const position = v.entities
      .getById(`asset:${selectedId}`)
      ?.position?.getValue(JulianDate.now());
    if (!position) return;
    v.camera.flyToBoundingSphere(new BoundingSphere(position, 60), {
      duration: 1,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 650),
    });
    v.scene.requestRender();
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
    if (!v || !token || ionLoading.current === v) return;
    if (buildingsRef.current) {
      buildingsRef.current.show = !buildingsRef.current.show;
      setBuildings(buildingsRef.current.show ? 'on' : 'off');
      v.scene.requestRender();
      return;
    }
    setBuildings('loading');
    setMapMessage('');
    ionLoading.current = v;
    try {
      const environment = await loadIonEnvironment(
        createWorldTerrainAsync,
        createOsmBuildingsAsync,
      );
      if (v.isDestroyed()) {
        environment.buildings.destroy();
        return;
      }
      // Never translate the building tileset: its elevations are already aligned to World Terrain.
      v.terrainProvider = environment.terrain;
      v.scene.primitives.add(environment.buildings);
      buildingsRef.current = environment.buildings;
      setTerrain('world');
      setBuildings('on');
      v.scene.requestRender();

      // Loading relief can put an existing close-up camera below the newly raised ground.
      const position = Cartographic.fromCartesian(v.camera.positionWC);
      const cameraPosition = Cartesian3.clone(v.camera.positionWC);
      try {
        const [surface] = await sampleTerrainMostDetailed(environment.terrain, [
          Cartographic.clone(position),
        ]);
        if (
          !v.isDestroyed() &&
          surface &&
          Number.isFinite(surface.height) &&
          Cartesian3.distance(v.camera.positionWC, cameraPosition) < 1 &&
          position.height < surface.height + 100
        ) {
          v.camera.flyTo({
            destination: Cartesian3.fromRadians(
              position.longitude,
              position.latitude,
              surface.height + 500,
            ),
            orientation: { heading: v.camera.heading, pitch: v.camera.pitch, roll: v.camera.roll },
            duration: 1,
          });
        }
      } catch {
        // The scene still refines terrain normally if the optional camera-height query fails.
      }
    } catch (failure) {
      if (!v.isDestroyed()) {
        setBuildings('error');
        setMapMessage(
          failure instanceof Error
            ? failure.message
            : 'No se pudieron cargar el terreno y los edificios.',
        );
      }
    } finally {
      if (ionLoading.current === v) ionLoading.current = null;
    }
  };
  // Keyboard navigation of the focused map: arrows pan over the ground, + and - zoom.
  const onMapKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const v = viewer.current;
    if (!v || event.target !== event.currentTarget) return;
    const camera = v.camera;
    const step = Math.max(camera.positionCartographic.height * 0.15, 5);
    const up = Ellipsoid.WGS84.geodeticSurfaceNormal(camera.positionWC, new Cartesian3());
    const forward = Cartesian3.normalize(
      Cartesian3.cross(up, camera.rightWC, new Cartesian3()),
      new Cartesian3(),
    );
    const right = Cartesian3.cross(forward, up, new Cartesian3());
    const moves: Record<string, () => void> = {
      ArrowUp: () => camera.move(forward, step),
      ArrowDown: () => camera.move(forward, -step),
      ArrowRight: () => camera.move(right, step),
      ArrowLeft: () => camera.move(right, -step),
      '+': () => camera.zoomIn(camera.positionCartographic.height * 0.3),
      '-': () => camera.zoomOut(camera.positionCartographic.height * 0.3),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
    v.scene.requestRender();
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
    <div className={`map-shell ${measuring ? 'measuring' : ''}`}>
      <div
        ref={container}
        className="cesium-host"
        data-testid="cesium-view"
        data-ready={ready}
        data-terrain={terrain}
        data-buildings={buildings}
        data-pointclouds={cloudsShown}
        data-color-mode={colorMode}
        tabIndex={0}
        role="application"
        aria-label="Mapa 3D. Flechas para desplazarse; + y - para acercar o alejar."
        onKeyDown={onMapKey}
      />
      <div className="map-top">
        <span className="map-tag">
          <span className="tiny-dot" />
          {place.toUpperCase()}
          {placeCenter && <b>{coordinates(placeCenter.lat, placeCenter.lng, 4)}</b>}
        </span>
        <span className="map-tag">
          {token ? 'ION LISTO' : 'MODO BÁSICO'} · {base} ·{' '}
          {terrain === 'world' ? 'RELIEVE 3D' : 'GLOBO BÁSICO'}
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
          onClick={() => viewer.current && flyToPoints(viewer.current, framePoints, 1)}
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
              ? 'Edificios OSM y terreno 3D de Cesium ion'
              : 'Configura VITE_CESIUM_ION_TOKEN para edificios 3D'
          }
          aria-label="Edificios 3D"
          aria-pressed={buildings === 'on'}
          onClick={() => void toggleBuildings()}
        >
          <Mountain size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Medir distancias, desniveles y áreas"
          aria-label="Medir"
          aria-pressed={measuring}
          disabled={!ready}
          onClick={() => setMeasuring(!measuring)}
        >
          <Ruler size={17} />
        </Button>
      </div>
      {measuring && ready && viewer.current && (
        <Suspense fallback={null}>
          <MeasureTool viewer={viewer.current} onClose={() => setMeasuring(false)} />
        </Suspense>
      )}
      <div ref={tooltip} className="map-tooltip" style={{ display: 'none' }} aria-hidden="true">
        <span />
        <small>Haz clic para inspeccionar</small>
      </div>
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
