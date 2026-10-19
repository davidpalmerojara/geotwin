// Workers and imagery assets are served from /cesium/ in dev and production.
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Cartesian3,
  Cartesian2,
  Color,
  Viewer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  Entity,
  ConstantProperty,
  ConstantPositionProperty,
  ImageryLayer,
  TileMapServiceImageryProvider,
  buildModuleUrl,
  Ion,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  Cesium3DTileset,
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
import { loadIonEnvironment } from './ion-environment';
import {
  GOOGLE_PHOTOREALISTIC_ASSET,
  loadPhotorealistic,
  PHOTOREAL_START_TIMEOUT_MS,
  PhotorealError,
  TileFailureWatch,
  topContentFailed,
  type PhotorealProblem,
  type TileState,
} from './photorealistic';
import {
  aimOffsets,
  fitInView,
  flyOnOwn,
  frameOf,
  samePose,
  type AutoFlight,
  type LatLng,
  type Pose,
  type ScreenBox,
} from './camera';
import {
  coveredByOverlays,
  liftToGround,
  sceneBlockers,
  shiftedOnGround,
  viewerFov,
} from './overlays';
import { placeLabels, type LabelAnchor, type LabelOffset } from './labels';
import { createSceneApi } from './scene-api';
import AssetTags from '../scene/asset-tags';
import { useLayers } from '../../hooks/data';
import { usePointCloudLayers } from '../layers/point-cloud-layers';
import { renderUntil } from '../measure/render-until';
import { dimensionLabelBoxes } from '../measure/dimension-lines';
import { sceneMarks } from '../scene/scene-marks';
import { useLidarTerrain } from '../layers/lidar-terrain-provider';
import { terrainHeight, type LidarTerrain } from '../layers/lidar-terrain';
import { usePnoaImagery } from '../layers/pnoa-imagery';
import { effectiveBase } from '../layers/base-imagery';
import { imageryLevelFor } from '../layers/point-style';
import { useLayerView } from '../../stores/layers';
import { measuring } from '../../stores/measure';
import { useScene } from '../../stores/viewer';
import { flightSeconds } from '../../lib/motion';
import { overlayBoxes, platesKey, whenSteady } from '../hud/dom';
import { outOfSight } from '../hud/placement';
type DevWindow = Window & {
  __geotwinViewer?: Viewer;
  /** Installation labels as last placed (canvas px), for end-to-end checks. */
  __geotwinLabels?: { boxes: ScreenBox[]; blocked: ScreenBox[] };
};
const INSTALLATION_FONT = '500 12px "IBM Plex Sans Condensed", sans-serif';
// Cesium's default label background padding is 7 x 5 px.
const LABEL_PAD_X = 7,
  LABEL_HEIGHT = 26;
// Position (lng, lat in radians) and orientation, but not height: Cesium may lift a camera that
// ends up below newly loaded terrain, and that is not a move by the user.
const poseOf = (v: Viewer): Pose => {
  const c = v.camera.positionCartographic;
  return [c.longitude, c.latitude, v.camera.heading, v.camera.pitch];
};
/** Ellipsoidal ground height (m) used to aim the camera: the LiDAR terrain, or 0 on the globe. */
type Ground = (lng: number, lat: number) => number;
const groundOf =
  (terrain: LidarTerrain | undefined): Ground =>
  (lng, lat) =>
    terrain ? terrainHeight(terrain, lng, lat) : 0;
// Status colours of the «Estación total» palette: operational in light grey, amber for a
// warning, red for a critical asset (the HUD adds the shape and the word).
const colors = { healthy: '#EEECE6', warning: '#FF9F1A', critical: '#FF5A4C' };
const FRAME_PITCH = CesiumMath.toRadians(-55);
// Oblique view that fits every point in the part of the scene that the HUD's plates leave
// visible, on every edge.
function flyToPoints(
  v: Viewer,
  points: LatLng[],
  duration: number,
  ground: Ground,
  complete?: () => void,
  cancel?: () => void,
) {
  const frame = frameOf(points);
  if (!frame || v.isDestroyed()) return;
  const canvas = v.scene.canvas;
  const width = canvas.clientWidth || 1,
    height = canvas.clientHeight || 1;
  const view = fitInView(frame.radius, viewerFov(v), width, height, coveredByOverlays(v));
  const heading = 0;
  v.camera.flyToBoundingSphere(
    shiftedOnGround(
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
      liftToGround(view.lift, FRAME_PITCH),
    ),
    {
      offset: new HeadingPitchRange(heading, FRAME_PITCH, view.distance),
      duration: flightSeconds(duration),
      complete,
      cancel,
    },
  );
  v.scene.requestRender();
}
interface Props {
  assets: Asset[];
  installations: Installation[];
  installationId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInstallation: (id: string) => void;
}
function CesiumView({
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
    [buildings, setBuildings] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [mapMessage, setMapMessage] = useState('');
  const [terrain, setTerrain] = useState<'ellipsoid' | 'world'>('ellipsoid');
  // Google Photorealistic 3D Tiles through Cesium ion (only offered with a token).
  const [photoreal, setPhotoreal] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const photorealRef = useRef<Cesium3DTileset | undefined>(undefined);
  const stopPhotorealFrames = useRef<(() => void) | undefined>(undefined);
  // The loaded tileset's failure watch, and the timer that gives up when no tile ever arrives.
  const photorealGuard = useRef<
    { watch: TileFailureWatch; fail: (problem: PhotorealProblem) => void } | undefined
  >(undefined);
  const photorealTimer = useRef<number | undefined>(undefined);
  const photorealOn = photoreal === 'on';
  const ionLoading = useRef<Viewer | null>(null);
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
  // The PNOA orthophoto; phones (quality «Baja») stop at a coarser level. Under it there is only
  // the dark ground of the globe, unless the Natural Earth atlas is chosen.
  const baseImagery = useLayerView((s) => s.baseImagery),
    pnoa = useLayerView((s) => s.pnoa);
  usePnoaImagery(ready ? viewer.current : null, ready, imageryLevelFor(quality));
  // Under the Google mesh the globe, and the PNOA layer on it, are hidden (see usePnoaImagery).
  const base = effectiveBase(baseImagery, pnoa.state);
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
    // Cesium writes its credits here; the credits plate of the HUD adopts the element.
    const credits = document.createElement('div');
    credits.className = 'scene-credits';
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
        // No base layer: the dark ground of the globe is the neutral base. The PNOA orthophoto
        // goes on top (usePnoaImagery) and the Natural Earth atlas only when chosen.
        baseLayer: false,
        creditContainer: credits,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
      viewer.current = v;
      // Development builds expose the viewer so end-to-end tests can check what the camera frames.
      if (import.meta.env.DEV) (window as DevWindow).__geotwinViewer = v;
      setTerrain('ellipsoid');
      setBuildings('off');
      v.scene.backgroundColor = Color.fromCssColorString('#0E0E0D');
      v.scene.globe.baseColor = Color.fromCssColorString('#1d2420');
      v.scene.globe.enableLighting = false;
      v.scene.globe.depthTestAgainstTerrain = true;
      handler = new ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((movement: { position: Cartesian2 }) => {
        // While measuring, clicks add measurement points instead of selecting.
        if (measuring()) return;
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
        if (measuring()) {
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
        tip.style.left = `${Math.max(8, Math.min(pointer.x + 15, width - 220))}px`;
        tip.style.top = `${pointer.y + 15}px`;
        tip.style.display = '';
      };
      useScene.getState().set({ credits });
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
      if (useScene.getState().credits === credits) useScene.getState().set({ credits: null });
      credits.remove();
      if (import.meta.env.DEV && (window as DevWindow).__geotwinViewer === v)
        delete (window as DevWindow).__geotwinViewer;
      framed.current = false;
      buildingsRef.current = undefined;
      photorealRef.current = undefined;
      photorealGuard.current = undefined;
      window.clearTimeout(photorealTimer.current);
      useLayerView.getState().setPhotoreal(false);
      stopPhotorealFrames.current?.();
      if (ionLoading.current === v) ionLoading.current = null;
    };
  }, [token]);
  // The Natural Earth atlas, added the first time it is chosen and then only shown or hidden.
  const atlas = useRef<ImageryLayer | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const wanted = base === 'natural-earth';
    if (!atlas.current && wanted) {
      atlas.current = ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
      );
      v.imageryLayers.add(atlas.current, 0);
    }
    if (atlas.current) atlas.current.show = wanted;
    v.scene.requestRender();
  }, [base, ready]);
  useEffect(
    () => () => {
      atlas.current = null;
    },
    [],
  );
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const ids = new Set<string>();
    // Over the Google mesh, which has the roofs in it, each asset stands on the mesh at its
    // position (a roof or the ground); otherwise at its mounting height above the terrain.
    const reference = photorealOn
      ? HeightReference.RELATIVE_TO_3D_TILE
      : HeightReference.RELATIVE_TO_TERRAIN;
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
        if (existing.point) {
          existing.point.color = new ConstantProperty(color);
          existing.point.heightReference = new ConstantProperty(reference);
        }
      } else
        v.entities.add({
          id,
          name: a.name,
          // Height above the terrain: 0 on the ground, the roof for a rooftop gateway. The point
          // records where the asset stands; it is drawn by the scene's marks and tags (DOM, see
          // features/scene/asset-tags.tsx), so the point itself stays hidden.
          position: Cartesian3.fromDegrees(a.location.lng, a.location.lat, mount),
          point: {
            show: false,
            heightReference: reference,
            pixelSize: 13,
            color,
            outlineColor: Color.fromCssColorString('#0E0E0D'),
            outlineWidth: 2,
            disableDepthTestDistance: Infinity,
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
            material: Color.fromCssColorString('#EEECE6').withAlpha(0.06),
          },
          label: {
            heightReference: clamp,
            text: i.name,
            font: INSTALLATION_FONT,
            fillColor: Color.fromCssColorString('#EEECE6'),
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#0E0E0D'),
            // Placed after each render (see placeInstallationLabels): below the area by default.
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, 50),
            disableDepthTestDistance: Infinity,
          },
        });
    }
    for (const entity of [...v.entities.values]) if (!ids.has(entity.id)) v.entities.remove(entity);
    v.scene.requestRender();
  }, [assets, installations, ready, relief, photorealOn]);
  const labelBoxes = useRef<ScreenBox[]>([]);
  // The same boxes by installation (canvas pixels): the edge chips leave out what is labelled.
  const labelById = useRef(new Map<string, ScreenBox>());
  // Installation labels: placed after every render so they neither overlap each other nor hide
  // under the plates of the HUD.
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
      // The plates of the HUD floating over the scene.
      const blocked = [
        ...sceneBlockers().map((b) => ({
          left: b.left - rect.left,
          right: b.right - rect.left,
          top: b.top - rect.top,
          bottom: b.bottom - rect.top,
        })),
        // The values of a measurement or a profile being read.
        ...dimensionLabelBoxes(),
      ];
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
      // A and B, the line and the outline of a profile are soft obstacles too.
      markers.push(...sceneMarks());
      // Kept the HUD's inset from the edges of the view, like the plates (--m: 12 px, 10 on a
      // phone).
      const hud = document.querySelector('.hud-phone') ?? document.documentElement;
      const inset = Number.parseFloat(getComputedStyle(hud).getPropertyValue('--m')) || 12;
      for (const [id, offset] of placeLabels(anchors, blocked, rect, markers, { inset }))
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
      labelById.current = new Map();
      const boxes = anchors.flatMap((a) => {
        const o = placement.get(a.id);
        if (!o) return [];
        const left = a.x + o.x - a.width / 2,
          top = a.y + o.y - a.height / 2;
        const box = { left, right: left + a.width, top, bottom: top + a.height };
        labelById.current.set(a.id, box);
        return [box];
      });
      // The asset tags keep clear of these labels.
      labelBoxes.current = boxes;
      if (import.meta.env.DEV) (window as DevWindow).__geotwinLabels = { blocked, boxes };
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
    flyOnOwn(autoFlight, v, poseOf, (complete, cancel) => {
      flyToPoints(v, framePoints, duration, groundRef.current, complete, cancel);
      duration = 1;
    });
    framed.current = true;
  }, [framePoints, ready]);
  // Whether the selected asset is already loaded: a shared link can open before the asset list.
  const selectedLoaded = assets.some((a) => a.id === selectedId);
  // Once per selection: the asset's card (and a sheet's list) arrive after the flight has been
  // aimed, and a card docked over the asset would hide it. When the plates have settled and the
  // asset is under one, the flight is aimed again with them counted.
  const reaimed = useRef<string | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !selectedId || !ready || !selectedLoaded) return;
    reaimed.current = null;
    let stopWaiting: (() => void) | undefined;
    const checkFraming = () => {
      stopWaiting?.();
      if (reaimed.current === selectedId) return;
      stopWaiting = whenSteady(platesKey, () => {
        const flight = autoFlight.current,
          asset = assetsRef.current.find((a) => a.id === selectedId);
        if (v.isDestroyed() || selectedRef.current !== selectedId || !asset) return;
        // Never over a camera the user has moved since.
        if (!flight || flight.state !== 'landed' || !samePose(flight.pose!, poseOf(v))) return;
        const { lng, lat } = asset.location;
        const world = Cartesian3.fromDegrees(
          lng,
          lat,
          groundRef.current(lng, lat) + (reliefRef.current ? asset.mount_height_m : 0),
        );
        const at = SceneTransforms.worldToWindowCoordinates(v.scene, world);
        const rect = v.scene.canvas.getBoundingClientRect();
        const point = at ? { x: rect.left + at.x, y: rect.top + at.y } : null;
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        if (!outOfSight(point, viewport, overlayBoxes(), 24)) return;
        reaimed.current = selectedId;
        flight.redo();
      });
    };
    // Fly straight to the asset position. Viewer.flyTo(entity) waits for the entity's
    // bounding sphere in a later render; with requestRenderMode that flight could stay
    // pending until an unrelated update and then start from a stale view.
    if (!v.entities.getById(`asset:${selectedId}`)?.position?.getValue(JulianDate.now())) return;
    flyOnOwn(autoFlight, v, poseOf, (complete, cancel) => {
      const asset = assetsRef.current.find((a) => a.id === selectedId);
      if (!asset) return;
      const { lng, lat } = asset.location;
      const position = Cartesian3.fromDegrees(
        lng,
        lat,
        groundRef.current(lng, lat) + (reliefRef.current ? asset.mount_height_m : 0),
      );
      // Aimed so the asset lands in the middle of what the plates leave visible.
      const pitch = CesiumMath.toRadians(-45);
      const canvas = v.scene.canvas;
      const aim = aimOffsets(
        650,
        viewerFov(v),
        canvas.clientWidth,
        canvas.clientHeight,
        coveredByOverlays(v),
      );
      const sphere = shiftedOnGround(
        new BoundingSphere(position, 60),
        0,
        aim.shift,
        liftToGround(aim.lift, pitch),
      );
      v.camera.flyToBoundingSphere(sphere, {
        duration: flightSeconds(1),
        offset: new HeadingPitchRange(0, pitch, 650),
        complete: () => {
          complete();
          checkFraming();
        },
        cancel,
      });
      v.scene.requestRender();
    });
    return () => stopWaiting?.();
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
    // The PNOA layer (and its credit) goes with the globe: see usePnoaImagery.
    useLayerView.getState().setPhotoreal(show);
    v.scene.requestRender();
    // Shown and nothing loaded yet: give up after a while (no answer is also a failure).
    window.clearTimeout(photorealTimer.current);
    const guard = photorealGuard.current;
    if (show && guard && !guard.watch.started)
      photorealTimer.current = window.setTimeout(() => {
        const problem = guard.watch.timedOut();
        if (problem) guard.fail(problem);
      }, PHOTOREAL_START_TIMEOUT_MS);
    // In request-render mode the mesh can stop half loaded until something else draws a frame
    // (a camera flight used to): keep drawing until its tiles are in.
    stopPhotorealFrames.current?.();
    stopPhotorealFrames.current =
      show && tileset
        ? renderUntil(
            () => !v.isDestroyed() && v.scene.requestRender(),
            () => v.isDestroyed() || !tileset.show || tileset.tilesLoaded,
            { maxMs: 30000 },
          )
        : undefined;
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
      // Cesium3DTileset.fromIonAssetId asks ion on every load, so a click after a failure
      // really retries: Cesium's createGooglePhotorealistic3DTileset keeps the first answer for
      // the page's life, a failed one included. The options are that helper's own. The viewer
      // has no geocoder, so no other geocoder is used alongside these tiles.
      const tileset = await loadPhotorealistic(() =>
        Cesium3DTileset.fromIonAssetId(GOOGLE_PHOTOREALISTIC_ASSET, {
          cacheBytes: 1536 * 1024 * 1024,
          maximumCacheOverflowBytes: 1024 * 1024 * 1024,
          enableCollision: true,
          // The provider's attribution must be visible on the map, not only behind a link.
          showCreditsOnScreen: true,
        }),
      );
      if (v.isDestroyed()) {
        tileset.destroy();
        return;
      }
      // A refused tile request (no access, quota), a failed top tile, a run of failures, or no
      // tile at all after PHOTOREAL_START_TIMEOUT_MS puts the LiDAR view back (TileFailureWatch).
      // The tileset is dropped: a failed tile is never asked again, so the next click starts
      // over from ion instead of showing an empty layer.
      const watch = new TileFailureWatch();
      const fail = (problem: PhotorealProblem) => {
        if (v.isDestroyed() || photorealRef.current !== tileset || !tileset.show) return;
        showPhotoreal(v, false);
        photorealRef.current = undefined;
        photorealGuard.current = undefined;
        setPhotoreal('error');
        setMapMessage(new PhotorealError(problem).message);
        // Not while the tileset may be in the middle of its own update.
        window.setTimeout(() => {
          if (!v.isDestroyed() && !tileset.isDestroyed()) v.scene.primitives.remove(tileset);
        }, 0);
      };
      tileset.tileLoad.addEventListener(() => {
        watch.loaded();
        window.clearTimeout(photorealTimer.current);
      });
      tileset.tileFailed.addEventListener((failure: unknown) => {
        const top = topContentFailed(tileset.root as unknown as TileState);
        const problem = watch.failed(failure, top);
        if (problem) fail(problem);
      });
      v.scene.primitives.add(tileset);
      photorealRef.current = tileset;
      photorealGuard.current = { watch, fail };
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
            duration: flightSeconds(1),
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
  // What the HUD shows about the scene: relief, Google, ion, notes.
  const reliefHint =
    !relief && !photorealOn && lidar.state !== 'loading' && assets.some((a) => a.mount_height_m > 0)
      ? `Sin relieve, los activos de cubiertas y torres se dibujan a ras del mapa. ${
          groundLayers && !lidarOption
            ? 'Activa «Relieve del LiDAR» en Capas para verlos a su altura.'
            : 'Carga las hojas LiDAR en Capas para verlos a su altura.'
        }`
      : '';
  const terrainMode = terrain === 'world' ? 'world' : lidarOn ? 'lidar' : 'ellipsoid';
  useEffect(() => {
    useScene.getState().set({
      terrain: terrainMode,
      lidar: lidarOn ? lidar.terrain : undefined,
      relief,
      photoreal,
      buildings,
      mapMessage,
      reliefHint,
    });
  }, [terrainMode, lidarOn, lidar.terrain, relief, photoreal, buildings, mapMessage, reliefHint]);
  // The actions the plates call: always the latest closures.
  const actions = useRef({ togglePhotoreal, toggleBuildings, framePoints });
  useEffect(() => {
    actions.current = { togglePhotoreal, toggleBuildings, framePoints };
  });
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    useScene.getState().set({
      api: createSceneApi(v, {
        ground: (lng, lat) => groundRef.current(lng, lat),
        labelBox: (id) => labelById.current.get(id) ?? null,
        home: () => flyToPoints(v, actions.current.framePoints, 1, groundRef.current),
        togglePhotoreal: () => void actions.current.togglePhotoreal(),
        toggleBuildings: () => void actions.current.toggleBuildings(),
      }),
    });
    return () => useScene.getState().set({ api: null });
  }, [ready]);
  if (error)
    return (
      <div className="state-box scene-error">
        <strong>El visor necesita WebGL</strong>
        <p>{error}</p>
        <p>Los activos y las alertas siguen disponibles en el menú GeoTwin.</p>
      </div>
    );
  return (
    <div className="scene">
      <div
        ref={container}
        className="cesium-host"
        data-testid="cesium-view"
        data-ready={ready}
        data-terrain={terrainMode}
        data-photoreal={photoreal}
        data-buildings={buildings}
        data-pointclouds={cloudsShown}
        data-color-mode={colorMode}
        data-point-mode={pointMode}
        data-base-imagery={photorealOn ? 'google' : base}
        data-pnoa={pnoa.state}
        data-pnoa-source={pnoa.source}
        tabIndex={0}
        role="application"
        aria-label="Escena 3D. Flechas para desplazarse; + y - para acercar o alejar."
        onKeyDown={onMapKey}
      />
      {ready && viewer.current && (
        <AssetTags
          viewer={viewer.current}
          assets={assets}
          selectedId={selectedId}
          relief={relief && !photorealOn}
          photoreal={photorealOn}
          ground={ground}
          labelBoxes={labelBoxes}
          onSelect={onSelect}
        />
      )}
      <div ref={tooltip} className="scene-tooltip" style={{ display: 'none' }} aria-hidden="true">
        <span />
        <small>Haz clic para ver su ficha</small>
      </div>
    </div>
  );
}

// Memoized: the HUD around it re-renders for its own reasons (a sheet, a panel), the scene need not.
export default memo(CesiumView);
