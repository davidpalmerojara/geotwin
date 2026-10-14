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
  TileMapServiceImageryProvider,
  buildModuleUrl,
  Ion,
  createGooglePhotorealistic3DTileset,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  type Cesium3DTileset,
  Cartographic,
  HeightReference,
  ClassificationType,
  sampleTerrainMostDetailed,
  HeadingPitchRange,
  BoundingSphere,
  JulianDate,
  Ellipsoid,
  SceneTransforms,
  VerticalOrigin,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Asset, Installation } from '@geotwin/shared';
import { Building2, Crosshair, Layers, Mountain, Plus, Minus, Ruler } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { loadIonEnvironment } from './ion-environment';
import { loadPhotorealistic, PhotorealError, TileFailureWatch } from './photorealistic';
import { fitInView, frameOf, samePose, type LatLng, type ScreenBox } from './camera';
import { coveredByOverlays, shiftedRight, viewerFov } from './overlays';
import { placeLabels, type LabelAnchor, type LabelOffset } from './labels';
import { useLayers } from '../../hooks/data';
import { coordinates } from '../../lib/format';
import { usePointCloudLayers } from '../layers/point-cloud-layers';
import { useLidarTerrain } from '../layers/lidar-terrain-provider';
import { terrainHeight, type LidarTerrain } from '../layers/lidar-terrain';
import { usePnoaImagery } from '../layers/pnoa-imagery';
import { baseImageryLabel, PNOA_UNAVAILABLE } from '../layers/base-imagery';
import { imageryLevelFor } from '../layers/point-style';
import { useLayerView } from '../../stores/layers';
import { useMeasure } from '../../stores/measure';
// The measuring tool is only downloaded when it is first opened.
const MeasureTool = lazy(() => import('../measure/measure-tool'));
type DevWindow = Window & {
  __geotwinViewer?: Viewer;
  /** Installation labels as last placed (canvas px), for end-to-end checks. */
  __geotwinLabels?: { boxes: ScreenBox[]; blocked: ScreenBox[] };
};
const INSTALLATION_FONT = '12px sans-serif';
// Cesium's default label background padding is 7 x 5 px.
const LABEL_PAD_X = 7,
  LABEL_HEIGHT = 26;
// What floats over the map: installation labels keep clear of it.
const MAP_FURNITURE = '.map-controls, .map-top .map-tag, .map-bottom, .map-hint';
/**
 * The last flight the viewer made on its own (framing a place or the selected asset). When the
 * ground under it changes (the LiDAR terrain arrives after the first frame) it is flown again,
 * but only while the camera is still where that flight left it: a user's moves are never undone.
 */
interface AutoFlight {
  state: 'flying' | 'landed';
  redo: () => void;
  /** Where the flight left the camera: position on the ground and orientation. */
  pose?: [number, number, number, number];
}
// Position (lng, lat in radians) and orientation, but not height: Cesium may lift a camera that
// ends up below newly loaded terrain, and that is not a move by the user.
const poseOf = (v: Viewer): [number, number, number, number] => {
  const c = v.camera.positionCartographic;
  return [c.longitude, c.latitude, v.camera.heading, v.camera.pitch];
};
/** Starts a flight of the viewer's own and remembers it in `last`, so it can be flown again. */
function flyOnOwn(
  last: { current: AutoFlight | null },
  v: Viewer,
  fly: (complete: () => void) => void,
) {
  const flight: AutoFlight = { state: 'flying', redo: () => flyOnOwn(last, v, fly) };
  last.current = flight;
  fly(() => {
    if (last.current !== flight || v.isDestroyed()) return;
    flight.state = 'landed';
    flight.pose = poseOf(v);
  });
}
/** Ellipsoidal ground height (m) used to aim the camera: the LiDAR terrain, or 0 on the globe. */
type Ground = (lng: number, lat: number) => number;
const groundOf =
  (terrain: LidarTerrain | undefined): Ground =>
  (lng, lat) =>
    terrain ? terrainHeight(terrain, lng, lat) : 0;
const colors = { healthy: '#34d399', warning: '#fbbf24', critical: '#fb7185' };
// A ground asset gets a tall marker volume; one on a roof or tower top, a small one on top of it.
// Without relief there is no roof to stand on: every asset is drawn on the globe.
const assetBox = (a: Asset, relief: boolean) =>
  relief && a.mount_height_m > 0 ? new Cartesian3(6, 6, 4) : new Cartesian3(9, 9, 14);
// Oblique view that fits every point on desktop and on a portrait phone, in the part of the map
// that floating panels (the «Capas» panel) leave visible.
function flyToPoints(
  v: Viewer,
  points: LatLng[],
  duration: number,
  ground: Ground,
  complete?: () => void,
) {
  const frame = frameOf(points);
  if (!frame || v.isDestroyed()) return;
  const canvas = v.scene.canvas;
  const width = canvas.clientWidth || 1,
    height = canvas.clientHeight || 1;
  const view = fitInView(frame.radius, viewerFov(v), width, height, coveredByOverlays(v));
  const heading = 0;
  v.camera.flyToBoundingSphere(
    shiftedRight(
      new BoundingSphere(
        Cartesian3.fromDegrees(
          frame.center.lng,
          frame.center.lat,
          ground(frame.center.lng, frame.center.lat),
        ),
        frame.radius,
      ),
      heading,
      view.shift,
    ),
    {
      offset: new HeadingPitchRange(heading, CesiumMath.toRadians(-55), view.distance),
      duration,
      complete,
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
    [buildings, setBuildings] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [mapMessage, setMapMessage] = useState('');
  const [terrain, setTerrain] = useState<'ellipsoid' | 'world'>('ellipsoid');
  // Google Photorealistic 3D Tiles through Cesium ion (only offered with a token).
  const [photoreal, setPhotoreal] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const photorealRef = useRef<Cesium3DTileset | undefined>(undefined);
  const photorealOn = photoreal === 'on';
  const ionLoading = useRef<Viewer | null>(null);
  const measuring = useMeasure((s) => s.active),
    setMeasuring = useMeasure((s) => s.setActive);
  const lidarOption = useLayerView((s) => s.lidarTerrain);
  const lidar = useLidarTerrain(
    ready ? viewer.current : null,
    ready,
    lidarOption && terrain !== 'world',
  );
  // The LiDAR ground under the globe: clouds, assets and imagery share real heights.
  const lidarOn = lidarOption && terrain !== 'world' && !!lidar.terrain;
  const ground = useMemo(
    () => groundOf(lidarOn ? lidar.terrain : undefined),
    [lidarOn, lidar.terrain],
  );
  const groundRef = useRef(ground);
  // Mounting heights (a gateway 42 m up on a tower roof) only mean something on real relief:
  // over the bare ellipsoid they would float tens of metres above the map.
  const relief = terrain === 'world' || lidarOn;
  const reliefRef = useRef(relief);
  const groundLayers = (useLayers().data ?? []).some((l) => l.status === 'ready' && l.terrain_url);
  // Over the Google mesh the clouds keep their real heights too.
  usePointCloudLayers(
    ready ? viewer.current : null,
    ready,
    terrain === 'world' || lidarOn || photorealOn,
  );
  const cloudsShown = useLayerView(
    (s) => Object.entries(s.render).filter(([id, r]) => r === 'shown' && !s.hidden[id]).length,
  );
  const colorMode = useLayerView((s) => s.colorMode),
    pointMode = useLayerView((s) => s.pointMode),
    quality = useLayerView((s) => s.quality);
  // The PNOA orthophoto on top of Natural Earth; phones (quality «Baja») stop at a coarser level.
  const baseImagery = useLayerView((s) => s.baseImagery),
    setBaseImagery = useLayerView((s) => s.setBaseImagery),
    pnoa = useLayerView((s) => s.pnoa);
  usePnoaImagery(ready ? viewer.current : null, ready, imageryLevelFor(quality));
  const pnoaShown = baseImagery === 'pnoa' && pnoa.state === 'on';
  useEffect(() => () => setMeasuring(false), [setMeasuring]);
  const tooltip = useRef<HTMLDivElement>(null);
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  const buildingsRef = useRef<Awaited<ReturnType<typeof createOsmBuildingsAsync>> | undefined>(
    undefined,
  );
  const selectedRef = useRef(selectedId);
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  const installationsRef = useRef(installations),
    installationIdRef = useRef(installationId);
  useEffect(() => {
    installationsRef.current = installations;
    installationIdRef.current = installationId;
  }, [installations, installationId]);
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
        // Natural Earth ships with Cesium and needs no network: it is always underneath, so the
        // globe is never blank; the PNOA orthophoto goes on top (usePnoaImagery).
        baseLayer: ImageryLayer.fromProviderAsync(
          TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
        ),
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
      viewer.current = v;
      // Development builds expose the viewer so end-to-end tests can check what the camera frames.
      if (import.meta.env.DEV) (window as DevWindow).__geotwinViewer = v;
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
      if (import.meta.env.DEV && (window as DevWindow).__geotwinViewer === v)
        delete (window as DevWindow).__geotwinViewer;
      framed.current = false;
      buildingsRef.current = undefined;
      photorealRef.current = undefined;
      if (ionLoading.current === v) ionLoading.current = null;
    };
  }, [token]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const ids = new Set<string>();
    // Over the Google mesh, which has the roofs in it, each asset stands on the mesh at its
    // position (a roof or the ground); otherwise at its mounting height above the terrain.
    const reference = photorealOn
      ? HeightReference.RELATIVE_TO_3D_TILE
      : HeightReference.RELATIVE_TO_TERRAIN;
    const surface = relief || photorealOn;
    for (const a of assets) {
      const id = `asset:${a.id}`;
      const mount = relief && !photorealOn ? a.mount_height_m : 0;
      ids.add(id);
      const color = Color.fromCssColorString(colors[a.status]);
      const existing = v.entities.getById(id);
      if (existing) {
        existing.name = a.name;
        existing.position = new ConstantPositionProperty(
          Cartesian3.fromDegrees(a.location.lng, a.location.lat, mount),
        );
        if (existing.box) {
          existing.box.dimensions = new ConstantProperty(assetBox(a, surface));
          existing.box.heightReference = new ConstantProperty(reference);
        }
        if (existing.point) {
          existing.point.color = new ConstantProperty(color);
          existing.point.heightReference = new ConstantProperty(reference);
        }
        if (existing.box) {
          existing.box.material = new ColorMaterialProperty(color.withAlpha(0.55));
          existing.box.outlineColor = new ConstantProperty(color);
        }
        if (existing.label) {
          existing.label.text = new ConstantProperty(a.name);
          existing.label.show = new ConstantProperty(selectedId === a.id);
          existing.label.heightReference = new ConstantProperty(reference);
        }
      } else
        v.entities.add({
          id,
          name: a.name,
          // Height above the terrain: 0 on the ground, the roof for a rooftop gateway.
          position: Cartesian3.fromDegrees(a.location.lng, a.location.lat, mount),
          point: {
            heightReference: reference,
            pixelSize: 13,
            color,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Infinity,
          },
          // Demo volume standing on the ground or on the mounting point (bottom at the position).
          box: {
            heightReference: reference,
            dimensions: assetBox(a, surface),
            material: color.withAlpha(0.55),
            outline: true,
            outlineColor: color,
          },
          label: {
            heightReference: reference,
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
    // Installation areas are draped on the terrain, or also on the 3D tiles over the Google mesh.
    const classification = photorealOn ? ClassificationType.BOTH : ClassificationType.TERRAIN;
    const clamp = photorealOn ? HeightReference.CLAMP_TO_GROUND : HeightReference.CLAMP_TO_TERRAIN;
    for (const i of installations) {
      const id = `installation:${i.id}`;
      ids.add(id);
      const existing = v.entities.getById(id);
      if (existing) {
        if (existing.ellipse)
          existing.ellipse.classificationType = new ConstantProperty(classification);
        if (existing.label) existing.label.heightReference = new ConstantProperty(clamp);
      } else
        v.entities.add({
          id,
          name: i.name,
          position: Cartesian3.fromDegrees(i.location.lng, i.location.lat),
          ellipse: {
            classificationType: classification,
            semiMajorAxis: 210,
            semiMinorAxis: 210,
            material: Color.CYAN.withAlpha(0.08),
          },
          label: {
            heightReference: clamp,
            text: i.name,
            font: '12px sans-serif',
            fillColor: Color.CYAN,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#101c30'),
            // Placed after each render (see placeInstallationLabels): below the area by default.
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, 50),
            disableDepthTestDistance: Infinity,
          },
        });
    }
    for (const entity of [...v.entities.values]) if (!ids.has(entity.id)) v.entities.remove(entity);
    v.scene.requestRender();
  }, [assets, installations, selectedId, ready, relief, photorealOn]);
  // Installation labels: placed after every render so they neither overlap each other nor hide
  // under the floating controls (on a phone the control column covers the left of the map).
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const measure = document.createElement('canvas').getContext('2d');
    if (measure) measure.font = INSTALLATION_FONT;
    const widths = new Map<string, number>();
    const widthOf = (text: string) => {
      let width = widths.get(text);
      if (width === undefined) {
        width = Math.ceil(measure?.measureText(text).width ?? text.length * 7) + 2 * LABEL_PAD_X;
        widths.set(text, width);
      }
      return width;
    };
    const place = () => {
      if (v.isDestroyed()) return;
      const rect = v.scene.canvas.getBoundingClientRect();
      const shell = container.current?.parentElement;
      // The map's own controls, and panels floating over it from outside (the «Capas» panel).
      const floating = [...document.querySelectorAll('[data-map-overlay]')].filter(
        (el) => getComputedStyle(el).position === 'absolute',
      );
      const blocked = [...(shell?.querySelectorAll(MAP_FURNITURE) ?? []), ...floating].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          left: b.left - rect.left,
          right: b.right - rect.left,
          top: b.top - rect.top,
          bottom: b.bottom - rect.top,
        };
      });
      const current = installationIdRef.current;
      const ordered = [...installationsRef.current].sort(
        (a, b) => Number(b.id === current) - Number(a.id === current),
      );
      const anchors: LabelAnchor[] = [];
      const placement = new Map<string, LabelOffset>();
      for (const i of ordered) {
        const { lng, lat } = i.location;
        const at = SceneTransforms.worldToWindowCoordinates(
          v.scene,
          Cartesian3.fromDegrees(lng, lat, groundRef.current(lng, lat)),
        );
        if (at)
          anchors.push({
            id: i.id,
            x: at.x,
            y: at.y,
            width: widthOf(i.name),
            height: LABEL_HEIGHT,
          });
        else placement.set(i.id, null);
      }
      // Asset markers (13 px dots) are left uncovered whenever there is another spot.
      const markers: ScreenBox[] = [];
      for (const a of assetsRef.current) {
        const at = SceneTransforms.worldToWindowCoordinates(
          v.scene,
          Cartesian3.fromDegrees(
            a.location.lng,
            a.location.lat,
            groundRef.current(a.location.lng, a.location.lat) +
              (reliefRef.current ? a.mount_height_m : 0),
          ),
        );
        if (at) markers.push({ left: at.x - 9, right: at.x + 9, top: at.y - 9, bottom: at.y + 9 });
      }
      for (const [id, offset] of placeLabels(anchors, blocked, rect, markers))
        placement.set(id, offset);
      let changed = false;
      const now = JulianDate.now();
      for (const [id, offset] of placement) {
        const label = v.entities.getById(`installation:${id}`)?.label;
        if (!label) continue;
        if (label.show?.getValue(now) !== !!offset) {
          label.show = new ConstantProperty(!!offset);
          changed = true;
        }
        const old = label.pixelOffset?.getValue(now) as Cartesian2 | undefined;
        if (offset && (!old || old.x !== offset.x || old.y !== offset.y)) {
          label.pixelOffset = new ConstantProperty(new Cartesian2(offset.x, offset.y));
          changed = true;
        }
      }
      if (import.meta.env.DEV)
        (window as DevWindow).__geotwinLabels = {
          blocked,
          boxes: anchors.flatMap((a) => {
            const o = placement.get(a.id);
            if (!o) return [];
            const left = a.x + o.x - a.width / 2,
              top = a.y + o.y - a.height / 2;
            return [{ left, right: left + a.width, top, bottom: top + a.height }];
          }),
        };
      if (changed) v.scene.requestRender();
    };
    const remove = v.scene.postRender.addEventListener(place);
    v.scene.requestRender();
    return () => {
      remove();
    };
  }, [ready]);
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
  const autoFlight = useRef<AutoFlight | null>(null);
  useEffect(() => {
    groundRef.current = ground;
    reliefRef.current = relief;
    // The LiDAR terrain usually arrives after the first flight, which then aimed at the
    // ellipsoid (hundreds of metres under the real ground): fly it again on the real ground,
    // unless the user has moved the camera since.
    const v = viewer.current,
      flight = autoFlight.current;
    if (!v || v.isDestroyed() || !flight) return;
    if (flight.state === 'landed' && !samePose(flight.pose!, poseOf(v))) {
      autoFlight.current = null;
      return;
    }
    flight.redo();
  }, [ground, relief]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !framePoints.length) return;
    // A selected asset has its own close-up; do not pull the camera away from it.
    if (selectedRef.current && framed.current) return;
    // The first framing is instant; later ones (another place, the real ground) fly for 1 s.
    let duration = framed.current ? 1 : 0;
    flyOnOwn(autoFlight, v, (complete) => {
      flyToPoints(v, framePoints, duration, groundRef.current, complete);
      duration = 1;
    });
    framed.current = true;
  }, [framePoints, ready]);
  // Whether the selected asset is already loaded: a shared link can open before the asset list.
  const selectedLoaded = assets.some((a) => a.id === selectedId);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !selectedId || !ready || !selectedLoaded) return;
    // Fly straight to the asset position. Viewer.flyTo(entity) waits for the entity's
    // bounding sphere in a later render; with requestRenderMode that flight could stay
    // pending until an unrelated update and then start from a stale view.
    if (!v.entities.getById(`asset:${selectedId}`)?.position?.getValue(JulianDate.now())) return;
    flyOnOwn(autoFlight, v, (complete) => {
      const asset = assetsRef.current.find((a) => a.id === selectedId);
      if (!asset) return;
      const { lng, lat } = asset.location;
      const position = Cartesian3.fromDegrees(
        lng,
        lat,
        groundRef.current(lng, lat) + (reliefRef.current ? asset.mount_height_m : 0),
      );
      v.camera.flyToBoundingSphere(new BoundingSphere(position, 60), {
        duration: 1,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 650),
        complete,
      });
      v.scene.requestRender();
    });
  }, [selectedId, ready, selectedLoaded]);
  /** Shows or hides the Google mesh; the globe (and the LiDAR relief on it) does the opposite. */
  const showPhotoreal = (v: Viewer, show: boolean) => {
    const tileset = photorealRef.current;
    if (tileset) tileset.show = show;
    // The Google tiles include the ground and the buildings: no globe, no OSM buildings.
    v.scene.globe.show = !show;
    if (show && buildingsRef.current?.show) {
      buildingsRef.current.show = false;
      setBuildings('off');
    }
    setPhotoreal(show ? 'on' : 'off');
    v.scene.requestRender();
  };
  const togglePhotoreal = async () => {
    const v = viewer.current;
    if (!v || !token || photoreal === 'loading') return;
    setMapMessage('');
    // Loaded once and then only shown or hidden: every new load requests the root tile again,
    // which counts against the monthly quota of the ion account.
    if (photorealRef.current) {
      showPhotoreal(v, !photorealRef.current.show);
      return;
    }
    setPhotoreal('loading');
    try {
      const tileset = await loadPhotorealistic(() =>
        createGooglePhotorealistic3DTileset(
          // The viewer has no geocoder, so no other geocoder is used alongside these tiles.
          { onlyUsingWithGoogleGeocoder: true },
          // The provider's attribution must be visible on the map, not only behind a link.
          { showCreditsOnScreen: true },
        ),
      );
      if (v.isDestroyed()) {
        tileset.destroy();
        return;
      }
      // A refused tile request (no access, quota) or a run of failures puts the LiDAR view back.
      const watch = new TileFailureWatch();
      tileset.tileLoad.addEventListener(() => watch.loaded());
      tileset.tileFailed.addEventListener((failure: unknown) => {
        const problem = watch.failed(failure);
        if (!problem || v.isDestroyed() || !tileset.show) return;
        showPhotoreal(v, false);
        setPhotoreal('error');
        setMapMessage(new PhotorealError(problem).message);
      });
      v.scene.primitives.add(tileset);
      photorealRef.current = tileset;
      showPhotoreal(v, true);
    } catch (failure) {
      if (v.isDestroyed()) return;
      setPhotoreal('error');
      setMapMessage(
        failure instanceof Error
          ? failure.message
          : 'No se pudo cargar la capa fotorrealista de Google. Sigue la vista LiDAR.',
      );
    }
  };
  const toggleBuildings = async () => {
    const v = viewer.current;
    if (!v || !token || ionLoading.current === v) return;
    // OSM buildings and the Google mesh would draw the same buildings twice.
    if (photorealRef.current?.show) showPhotoreal(v, false);
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
        data-terrain={terrain === 'world' ? 'world' : lidarOn ? 'lidar' : 'ellipsoid'}
        data-photoreal={photoreal}
        data-buildings={buildings}
        data-pointclouds={cloudsShown}
        data-color-mode={colorMode}
        data-point-mode={pointMode}
        data-base-imagery={pnoaShown ? 'pnoa' : 'natural-earth'}
        data-pnoa={pnoa.state}
        data-pnoa-source={pnoa.source}
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
          {token ? 'ION LISTO' : 'MODO BÁSICO'} ·{' '}
          {!photorealOn && `${baseImageryLabel(baseImagery, pnoa.state, pnoa.source)} · `}
          {photorealOn
            ? 'FOTORREALISTA (GOOGLE)'
            : terrain === 'world'
              ? 'RELIEVE 3D'
              : lidarOn
                ? 'RELIEVE LIDAR'
                : 'GLOBO BÁSICO'}
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
            viewer.current && flyToPoints(viewer.current, framePoints, 1, groundRef.current)
          }
        >
          <Crosshair size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title={
            photorealOn
              ? 'Oculto con Fotorrealista: la malla de Google tapa el mapa base'
              : baseImagery === 'pnoa'
                ? 'Cambiar al atlas Natural Earth (sin conexión, poco detalle)'
                : 'Cambiar a la ortofoto PNOA'
          }
          aria-label="Alternar cartografía"
          aria-pressed={baseImagery === 'pnoa'}
          disabled={photorealOn}
          onClick={() => setBaseImagery(baseImagery === 'pnoa' ? 'natural-earth' : 'pnoa')}
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
        {token && (
          <Button
            variant="outline"
            size="icon"
            disabled={photoreal === 'loading'}
            title="Fotorrealista (Google): malla 3D de Google Photorealistic 3D Tiles a través de Cesium ion"
            aria-label="Fotorrealista (Google)"
            aria-pressed={photorealOn}
            onClick={() => void togglePhotoreal()}
          >
            <Building2 size={17} />
          </Button>
        )}
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
          <MeasureTool
            viewer={viewer.current}
            onClose={() => setMeasuring(false)}
            ground={lidarOn ? ground : undefined}
          />
        </Suspense>
      )}
      <div ref={tooltip} className="map-tooltip" style={{ display: 'none' }} aria-hidden="true">
        <span />
        <small>Haz clic para inspeccionar</small>
      </div>
      {!relief &&
        !photorealOn &&
        lidar.state !== 'loading' &&
        assets.some((a) => a.mount_height_m > 0) && (
          <div className="map-hint" role="note" data-testid="relief-hint">
            Sin relieve, los activos de cubiertas y torres se dibujan a ras del mapa.{' '}
            {groundLayers && !lidarOption
              ? 'Activa «Relieve del LiDAR» en Capas para verlos a su altura.'
              : 'Carga las hojas LiDAR en Capas para verlos a su altura.'}
          </div>
        )}
      {(mapMessage || (pnoa.state === 'error' && baseImagery === 'pnoa' && !photorealOn)) && (
        <div className="map-message" role="status" data-testid="map-message">
          {mapMessage || PNOA_UNAVAILABLE}
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
