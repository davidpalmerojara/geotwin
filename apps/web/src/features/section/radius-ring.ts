/**
 * Tool 5 in the scene: the ST_DWithin radius as a dashed ring on the terrain (classified on the
 * LiDAR DTM), a faint disc, the radius and count on the ring, and a thin leader from the centre to
 * each asset inside with its distance. While the tool is on, a click on the map (not on an asset)
 * makes that point the centre.
 */
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  CustomDataSource,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { number } from '../../lib/format';
import { metresPerDegree } from './section-math';
import { renderUntil } from '../measure/render-until';

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

export const radiusText = (metres: number, count: number) =>
  `r = ${metres >= 1000 ? `${number(metres / 1000, 0)} km` : `${number(metres, 0)} m`} · ${count} ${count === 1 ? 'activo dentro' : 'activos dentro'}`;

export class RadiusRing {
  private readonly source = new CustomDataSource('radio');
  private readonly added: Promise<unknown>;
  private readonly handler: ScreenSpaceEventHandler;
  private stopRendering: (() => void) | undefined;

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
  }

  update(view: RingView | null) {
    if (this.viewer.isDestroyed()) return;
    const entities = this.source.entities;
    entities.suspendEvents();
    entities.removeAll();
    if (view) {
      const ring = circle(view.center, view.metres);
      entities.add({
        id: 'radio:anillo',
        polyline: {
          positions: ring.map((p) => Cartesian3.fromDegrees(p.lng, p.lat)),
          clampToGround: true,
          classificationType: ClassificationType.TERRAIN,
          width: 2.5,
          material: new PolylineDashMaterialProperty({
            color: SIG,
            gapColor: INK.withAlpha(0.4),
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
      // The radius and count, on the ring towards the viewer (south-west).
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
    this.viewer.scene.requestRender();
    this.stopRendering?.();
    this.stopRendering = renderUntil(
      () => !this.viewer.isDestroyed() && this.viewer.scene.requestRender(),
      () => this.viewer.isDestroyed() || this.viewer.dataSourceDisplay.ready,
    );
  }

  destroy() {
    this.stopRendering?.();
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
