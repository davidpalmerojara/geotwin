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
  CustomDataSource,
  HorizontalOrigin,
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
import { overlayBoxes } from '../hud/dom';

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
/**
 * Where the radius label goes on the ring: of the candidate points (screen positions, or null
 * when behind the camera), the one nearest the bottom of the view (towards the viewer) whose label
 * box stays inside the view and clear of the plates; if none is clear, the lowest one inside the
 * view. Returns the index, or -1 when no point is on screen.
 */
export function labelSpot(
  points: ({ x: number; y: number } | null)[],
  label: { width: number; height: number },
  view: { width: number; height: number },
  plates: Box[],
  margin = 8,
) {
  let best = -1,
    fallback = -1;
  points.forEach((p, i) => {
    if (!p) return;
    const box = {
      left: p.x - label.width / 2,
      right: p.x + label.width / 2,
      top: p.y - label.height / 2,
      bottom: p.y + label.height / 2,
    };
    const inside =
      box.left >= margin &&
      box.top >= margin &&
      box.right <= view.width - margin &&
      box.bottom <= view.height - margin;
    if (!inside) return;
    if (fallback < 0 || p.y > points[fallback]!.y) fallback = i;
    const clear = plates.every(
      (r) =>
        box.right + margin <= r.left ||
        box.left - margin >= r.right ||
        box.bottom + margin <= r.top ||
        box.top - margin >= r.bottom,
    );
    if (clear && (best < 0 || p.y > points[best]!.y)) best = i;
  });
  return best >= 0 ? best : fallback;
}

export const radiusText = (metres: number, count: number) =>
  `r = ${metres >= 1000 ? `${number(metres / 1000, 0)} km` : `${number(metres, 0)} m`} · ${count} ${count === 1 ? 'activo dentro' : 'activos dentro'}`;

export class RadiusRing {
  private readonly source = new CustomDataSource('radio');
  private readonly added: Promise<unknown>;
  private readonly handler: ScreenSpaceEventHandler;
  private stopRendering: (() => void) | undefined;
  private view: RingView | null = null;
  private readonly removeMoveEnd: () => void;

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
    // The label moves along the ring to a visible spot whenever the camera stops.
    this.removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => this.placeLabel());
  }

  /** Puts the radius label on the ring where it is on screen and clear of the plates. */
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
    const points = positions.map((p) => {
      const w = SceneTransforms.worldToWindowCoordinates(viewer.scene, p);
      return w ? { x: w.x, y: w.y } : null;
    });
    const text = radiusText(view.metres, view.items.length);
    const plates = overlayBoxes(document).map((r) => ({
      left: r.left - frame.left,
      right: r.right - frame.left,
      top: r.top - frame.top,
      bottom: r.bottom - frame.top,
    }));
    const i = labelSpot(
      points,
      { width: text.length * 7.3 + 14, height: 24 },
      { width: canvas.clientWidth, height: canvas.clientHeight },
      plates,
    );
    if (i < 0) return;
    label.position = new ConstantPositionProperty(positions[i]);
    viewer.scene.requestRender();
  }

  update(view: RingView | null) {
    if (this.viewer.isDestroyed()) return;
    const entities = this.source.entities;
    entities.suspendEvents();
    entities.removeAll();
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
          verticalOrigin: VerticalOrigin.CENTER,
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
            text: `${number(item.distance_m, 0)} m`,
            font: '500 11px "IBM Plex Mono", monospace',
            fillColor: FG,
            style: LabelStyle.FILL,
            showBackground: true,
            backgroundColor: INK,
            backgroundPadding: new Cartesian2(5, 2),
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(10, -10),
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
    this.placeLabel();
    this.viewer.scene.requestRender();
    this.stopRendering?.();
    this.stopRendering = renderUntil(
      () => !this.viewer.isDestroyed() && this.viewer.scene.requestRender(),
      () => this.viewer.isDestroyed() || this.viewer.dataSourceDisplay.ready,
    );
  }

  destroy() {
    this.stopRendering?.();
    this.removeMoveEnd();
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
