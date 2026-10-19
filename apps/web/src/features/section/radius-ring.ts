/**
 * Tool 5 in the scene: the ST_DWithin radius as a dashed ring on the LiDAR DTM (dimmer where the
 * clouds are in front of it), a faint disc classified on the terrain, the radius and count on the
 * ring, and a thin leader from the centre to each asset inside with its distance. While the tool
 * is on, a click on the map (not on an asset) makes that point the centre.
 */
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  CustomDataSource,
  HorizontalOrigin,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { number } from '../../lib/format';
import { metresPerDegree } from './section-math';
import { renderUntil } from '../measure/render-until';
import { clearForRedraw } from '../measure/entities';
import { overlayBoxes, platesKey, whenSteady } from '../hud/dom';
import { addSceneLabels } from '../scene/scene-marks';
import {
  DISTANCE_OFFSET,
  DISTANCE_PAD,
  RING_ANCHORS,
  RING_LABEL_LIFT,
  distanceLabelBox,
  distanceSide,
  distanceText,
  ringAnchorOffset,
  ringLabelBox,
  type DistanceSide,
  type RingAnchor,
} from './radius-label';
const SIG = Color.fromCssColorString('#FFD21A'),
  INK = Color.fromCssColorString('#0E0E0D'),
  FG = Color.fromCssColorString('#EEECE6');

export interface RingView {
  center: { lng: number; lat: number };
  metres: number;
  items: { id: string; lng: number; lat: number; distance_m: number; mount: number }[];
}

/** Points of a circle of `metres` around a centre on the ground (degrees), closed. */
export function circle(center: { lng: number; lat: number }, metres: number, n = 128) {
  const scale = metresPerDegree(center.lat);
  const out: { lng: number; lat: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({
      lng: center.lng + (Math.sin(t) * metres) / scale.lng,
      lat: center.lat + (Math.cos(t) * metres) / scale.lat,
    });
  }
  return out;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
type Screen = { x: number; y: number } | null;

/** Whether the segment a–b crosses the box (Liang–Barsky clipping). */
export function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: Box) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Where the radius label goes on the ring: of the ring's points on screen (null when behind the
 * camera), the one nearest the bottom of the view (towards the viewer) where the label box, against
 * that point by one of RING_ANCHORS (above it first, then below, then off a corner), stays inside
 * the view, clear of the plates and of the ring's own dashes (`path`, the ring on screen: where the
 * ring runs steeply or at a slant on screen a box centred above it would be crossed by it). Failing
 * that, one clear of the plates only; failing that, the lowest inside the view. Returns the point's
 * index and the anchor, or null when no point is on screen.
 */
export function labelSpot(
  points: Screen[],
  text: string,
  view: { width: number; height: number },
  plates: Box[],
  margin = 8,
  path: Screen[] = [],
): { index: number; anchor: RingAnchor } | null {
  type Spot = { index: number; anchor: RingAnchor; y: number };
  let best: Spot | null = null,
    plain: Spot | null = null,
    fallback: Spot | null = null;
  const crossed = (box: Box) =>
    path.some((p, i) => {
      const q = path[i + 1];
      return !!p && !!q && segmentHitsBox(p, q, box);
    });
  const lower = (spot: Spot | null, y: number) => !spot || y > spot.y;
  // A plain loop, not forEach: the type checker follows assignments made in it.
  for (const [index, p] of points.entries()) {
    if (!p) continue;
    for (const anchor of RING_ANCHORS) {
      const box = ringLabelBox(p, text, anchor);
      const inside =
        box.left >= margin &&
        box.top >= margin &&
        box.right <= view.width - margin &&
        box.bottom <= view.height - margin;
      if (!inside) continue;
      const spot = { index, anchor, y: p.y };
      if (lower(fallback, p.y)) fallback = spot;
      const clear = plates.every(
        (r) =>
          box.right + margin <= r.left ||
          box.left - margin >= r.right ||
          box.bottom + margin <= r.top ||
          box.top - margin >= r.bottom,
      );
      if (!clear) continue;
      if (lower(plain, p.y)) plain = spot;
      if (lower(best, p.y) && !crossed(box)) best = spot;
    }
  }
  const spot: Spot | null = best ?? plain ?? fallback;
  return spot ? { index: spot.index, anchor: spot.anchor } : null;
}

export const radiusText = (metres: number, count: number) =>
  `r = ${metres >= 1000 ? `${number(metres / 1000, 0)} km` : `${number(metres, 0)} m`} · ${count} ${count === 1 ? 'activo dentro' : 'activos dentro'}`;

export class RadiusRing {
  private readonly source = new CustomDataSource('radio');
  private readonly added: Promise<unknown>;
  private readonly handler: ScreenSpaceEventHandler;
  private stopRendering: (() => void) | undefined;
  private view: RingView | null = null;
  /** Where each distance label hangs (the end of its leader) and on which side, for `valueBoxes`. */
  private ends: { id: string; at: Cartesian3; metres: number; side: DistanceSide }[] = [];
  /** How the radius label sits against its point on the ring. */
  private anchor: RingAnchor = 'above';
  private cancelSteady: (() => void) | undefined;
  private readonly plates: MutationObserver;
  private readonly removeMoveEnd: () => void;
  private readonly removeLabels: () => void;

  constructor(
    private readonly viewer: Viewer,
    private readonly host: HTMLElement,
    private readonly ground: (lng: number, lat: number) => number,
    onPoint: (p: { lng: number; lat: number }) => void,
  ) {
    this.added = viewer.dataSources.add(this.source);
    const scene = viewer.scene;
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      // Assets and installations are selected by the viewer; anywhere else sets the centre.
      const picked: unknown = scene.pick(e.position);
      const id =
        typeof picked === 'object' && picked && 'id' in picked
          ? String((picked.id as { id?: unknown })?.id ?? '')
          : '';
      if (id.startsWith('asset:') || id.startsWith('installation:')) return;
      const ray = viewer.camera.getPickRay(e.position);
      const hit = ray ? scene.globe.pick(ray, scene) : undefined;
      if (!hit) return;
      const c = Cartographic.fromCartesian(hit);
      onPoint({ lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) });
    }, ScreenSpaceEventType.LEFT_CLICK);
    // The labels move to a visible spot whenever the camera stops, and again once the plates have
    // settled (a card docking, a panel opening) and whenever one opens or closes.
    this.removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => this.placeSoon());
    this.plates = new MutationObserver(() => this.placeSoon());
    const hud = document.querySelector('.hud');
    if (hud) this.plates.observe(hud, { childList: true, subtree: true });
    // The installation labels, the tags and the edge chips keep off the distances and the radius.
    this.removeLabels = addSceneLabels(() => this.valueBoxes());
  }

  /** The distance labels and the radius label on screen (canvas px), as drawn now. */
  private valueBoxes() {
    const view = this.view,
      viewer = this.viewer;
    if (!view || viewer.isDestroyed()) return [];
    const scene = viewer.scene;
    const boxes = this.ends.flatMap(({ at, metres, side }) => {
      const p = side === 'hidden' ? undefined : SceneTransforms.worldToWindowCoordinates(scene, at);
      return p ? [distanceLabelBox(p, metres, side)] : [];
    });
    const ring = this.source.entities
      .getById('radio:etiqueta')
      ?.position?.getValue(JulianDate.now());
    const p = ring ? SceneTransforms.worldToWindowCoordinates(scene, ring) : undefined;
    if (p) boxes.push(ringLabelBox(p, radiusText(view.metres, view.items.length), this.anchor));
    return boxes;
  }

  /** Places the labels now and once more when the plates have stopped moving. */
  private placeSoon() {
    this.placeLabel();
    this.cancelSteady?.();
    this.cancelSteady = whenSteady(platesKey, () => this.placeLabel(), 300, 3000);
  }

  /**
   * Puts the radius label on the ring where it is on screen and clear of the plates and of the
   * ring's dashes, and each distance on the side of its leader that is in sight (or hides it).
   */
  private placeLabel() {
    const view = this.view,
      viewer = this.viewer;
    const label = this.source.entities.getById('radio:etiqueta');
    if (!view || !label || viewer.isDestroyed()) return;
    const ring = circle(view.center, view.metres, 36).slice(0, -1);
    const positions = ring.map((p) =>
      Cartesian3.fromDegrees(p.lng, p.lat, this.ground(p.lng, p.lat) + 1),
    );
    const canvas = viewer.scene.canvas;
    const frame = canvas.getBoundingClientRect();
    const size = { width: canvas.clientWidth, height: canvas.clientHeight };
    const text = radiusText(view.metres, view.items.length);
    const points = positions.map((p) => {
      const w = SceneTransforms.worldToWindowCoordinates(viewer.scene, p);
      return w ? { x: w.x, y: w.y } : null;
    });
    // The ring itself on screen (a point every 2,5°), which the label must not sit across.
    const path = circle(view.center, view.metres, 144).map((p) => {
      const w = SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        Cartesian3.fromDegrees(p.lng, p.lat, this.ground(p.lng, p.lat) + 0.5),
      );
      return w ? { x: w.x, y: w.y } : null;
    });
    const plates = overlayBoxes(document).map((r) => ({
      left: r.left - frame.left,
      right: r.right - frame.left,
      top: r.top - frame.top,
      bottom: r.bottom - frame.top,
    }));
    const spot = labelSpot(points, text, size, plates, 8, path);
    if (spot) {
      this.anchor = spot.anchor;
      const o = ringAnchorOffset(spot.anchor);
      label.position = new ConstantPositionProperty(positions[spot.index]);
      if (label.label) {
        label.label.horizontalOrigin = new ConstantProperty(
          o.horizontal === 'left'
            ? HorizontalOrigin.LEFT
            : o.horizontal === 'right'
              ? HorizontalOrigin.RIGHT
              : HorizontalOrigin.CENTER,
        );
        label.label.verticalOrigin = new ConstantProperty(
          o.vertical === 'top' ? VerticalOrigin.TOP : VerticalOrigin.BOTTOM,
        );
        label.label.pixelOffset = new ConstantProperty(new Cartesian2(o.x, o.y));
      }
    }
    // The distances: right of the leader's end, else left of it, else hidden (the panel lists them).
    for (const end of this.ends) {
      const entity = this.source.entities.getById(`radio:distancia:${end.id}`);
      if (!entity?.label) continue;
      const at = SceneTransforms.worldToWindowCoordinates(viewer.scene, end.at);
      end.side = distanceSide(at ? { x: at.x, y: at.y } : null, end.metres, size, plates);
      entity.label.show = new ConstantProperty(end.side !== 'hidden');
      if (end.side === 'hidden') continue;
      const left = end.side === 'left';
      entity.label.horizontalOrigin = new ConstantProperty(
        left ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT,
      );
      entity.label.pixelOffset = new ConstantProperty(
        new Cartesian2(left ? -DISTANCE_OFFSET.x : DISTANCE_OFFSET.x, DISTANCE_OFFSET.y),
      );
    }
    viewer.scene.requestRender();
  }

  update(view: RingView | null) {
    if (this.viewer.isDestroyed()) return;
    const entities = this.source.entities;
    clearForRedraw(entities);
    this.ends = [];
    if (view) {
      // The ring follows the DTM (a point every 5 m or so, at the bilinear height of the ground
      // model the globe draws) instead of being classified on the terrain: the point clouds stand
      // on that ground and would hide a classified line. Where something is in front of it, it is
      // drawn dimmer instead of disappearing.
      const n = Math.min(720, Math.max(128, Math.round((2 * Math.PI * view.metres) / 5)));
      const ring = circle(view.center, view.metres, n);
      entities.add({
        id: 'radio:anillo',
        polyline: {
          positions: ring.map((p) =>
            Cartesian3.fromDegrees(p.lng, p.lat, this.ground(p.lng, p.lat) + 0.5),
          ),
          arcType: ArcType.NONE,
          width: 2.5,
          material: new PolylineDashMaterialProperty({
            color: SIG,
            gapColor: INK.withAlpha(0.4),
            dashLength: 14,
          }),
          depthFailMaterial: new PolylineDashMaterialProperty({
            color: SIG.withAlpha(0.55),
            dashLength: 14,
          }),
        },
      });
      entities.add({
        id: 'radio:disco',
        position: Cartesian3.fromDegrees(view.center.lng, view.center.lat),
        ellipse: {
          semiMajorAxis: view.metres,
          semiMinorAxis: view.metres,
          classificationType: ClassificationType.TERRAIN,
          material: SIG.withAlpha(0.05),
        },
      });
      // The radius and count, on the ring: south-west at first, then wherever it is on screen and
      // clear of the plates (placeLabel).
      const at = circle(view.center, view.metres, 8)[5]!;
      this.anchor = 'above';
      entities.add({
        id: 'radio:etiqueta',
        position: Cartesian3.fromDegrees(at.lng, at.lat, this.ground(at.lng, at.lat) + 1),
        label: {
          text: radiusText(view.metres, view.items.length),
          font: '500 12px "IBM Plex Mono", monospace',
          fillColor: FG,
          style: LabelStyle.FILL,
          showBackground: true,
          backgroundColor: INK,
          backgroundPadding: new Cartesian2(7, 4),
          horizontalOrigin: HorizontalOrigin.CENTER,
          // Just above the ring, so the dashes do not run through the text.
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -RING_LABEL_LIFT),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      const centre = Cartesian3.fromDegrees(
        view.center.lng,
        view.center.lat,
        this.ground(view.center.lng, view.center.lat) + 1,
      );
      for (const item of view.items) {
        const end = Cartesian3.fromDegrees(
          item.lng,
          item.lat,
          this.ground(item.lng, item.lat) + item.mount + 1,
        );
        this.ends.push({ id: item.id, at: end, metres: item.distance_m, side: 'right' });
        entities.add({
          id: `radio:guia:${item.id}`,
          polyline: {
            positions: [centre, end],
            width: 1,
            arcType: ArcType.NONE,
            material: SIG.withAlpha(0.7),
            depthFailMaterial: new PolylineDashMaterialProperty({ color: SIG.withAlpha(0.45) }),
          },
        });
        entities.add({
          id: `radio:distancia:${item.id}`,
          position: end,
          label: {
            text: distanceText(item.distance_m),
            font: '500 11px "IBM Plex Mono", monospace',
            fillColor: FG,
            style: LabelStyle.FILL,
            showBackground: true,
            backgroundColor: INK,
            backgroundPadding: new Cartesian2(DISTANCE_PAD.x, DISTANCE_PAD.y),
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(DISTANCE_OFFSET.x, DISTANCE_OFFSET.y),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      this.host.dataset.radius = String(view.metres);
      this.host.dataset.radiusCount = String(view.items.length);
    } else {
      delete this.host.dataset.radius;
      delete this.host.dataset.radiusCount;
    }
    entities.resumeEvents();
    this.view = view;
    this.placeSoon();
    this.viewer.scene.requestRender();
    this.stopRendering?.();
    this.stopRendering = renderUntil(
      () => !this.viewer.isDestroyed() && this.viewer.scene.requestRender(),
      () => this.viewer.isDestroyed() || this.viewer.dataSourceDisplay.ready,
    );
  }

  destroy() {
    this.stopRendering?.();
    this.cancelSteady?.();
    this.plates.disconnect();
    this.removeMoveEnd();
    this.removeLabels();
    this.handler.destroy();
    delete this.host.dataset.radius;
    delete this.host.dataset.radiusCount;
    if (this.viewer.isDestroyed()) return;
    const source = this.source;
    void this.added.then(() => {
      if (this.viewer.isDestroyed()) return;
      this.viewer.dataSources.remove(source, true);
      this.viewer.scene.requestRender();
    });
  }
}
