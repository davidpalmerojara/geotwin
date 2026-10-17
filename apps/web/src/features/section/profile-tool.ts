/**
 * Tool 3 in the scene: A and B are picked on the terrain with `globe.pick(camera.getPickRay())`
 * (a CPU hit, no GPU read) and can be dragged; the line, its distance ticks, the dashed outline of
 * the section plane, the buildings' heights (E1…En) and the cursor shared with the drawer are
 * drawn as entities.
 */
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  Ellipsoid,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  PolylineOutlineMaterialProperty,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { number } from '../../lib/format';
import type { LngLat, SectionSummary } from '../../stores/section';
import { drawDimensions, type Dimension } from '../measure/dimension-lines';
import { renderUntil } from '../measure/render-until';
import { fromLine, makeLine, toLine } from './section-math';

const SIG = Color.fromCssColorString('#FFD21A'),
  SIG_INK = Color.fromCssColorString('#191500'),
  INK = Color.fromCssColorString('#0E0E0D'),
  FG = Color.fromCssColorString('#EEECE6');
const MARK_FONT = '600 12px "IBM Plex Mono", monospace';
const TICK_FONT = '400 11px "IBM Plex Mono", monospace';
/** How close (px) a press must be to A or B to drag it. */
const GRAB_PX = 16;

export interface ProfileCallbacks {
  place: (p: LngLat) => void;
  move: (which: 'a' | 'b', p: LngLat) => void;
  dragging: (on: boolean) => void;
  cursor: (s: number | null) => void;
  /** The current A and B (read when a press starts). */
  ends: () => { a: LngLat | null; b: LngLat | null };
}

export interface ProfileView {
  a: LngLat | null;
  b: LngLat | null;
  summary: SectionSummary | null;
  cursor: number | null;
}

export class ProfileScene {
  private readonly source = new CustomDataSource('perfil');
  private readonly added: Promise<unknown>;
  private readonly handler: ScreenSpaceEventHandler;
  private drag: 'a' | 'b' | null = null;
  private dragged = false;
  private preview: LngLat | null = null;
  private view: ProfileView = { a: null, b: null, summary: null, cursor: null };
  private frame = 0;
  private stopRendering: (() => void) | undefined;

  constructor(
    private readonly viewer: Viewer,
    /** Ellipsoidal height of the scene's ground (the LiDAR DTM the globe draws). */
    private readonly ground: (lng: number, lat: number) => number,
    private readonly on: ProfileCallbacks,
  ) {
    this.added = viewer.dataSources.add(this.source);
    const scene = viewer.scene;
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction(
      (e: { position: Cartesian2 }) => this.press(e.position),
      ScreenSpaceEventType.LEFT_DOWN,
    );
    this.handler.setInputAction(
      (e: { endPosition: Cartesian2 }) => this.hover(e.endPosition),
      ScreenSpaceEventType.MOUSE_MOVE,
    );
    this.handler.setInputAction(() => this.release(), ScreenSpaceEventType.LEFT_UP);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      if (this.dragged) {
        this.dragged = false;
        return;
      }
      const p = this.pick(e.position);
      if (p) this.on.place(p);
    }, ScreenSpaceEventType.LEFT_CLICK);
    scene.canvas.style.cursor = 'crosshair';
  }

  /** The terrain under a canvas pixel, in degrees. */
  private pick(position: Cartesian2): LngLat | null {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(position);
    const hit = ray ? scene.globe.pick(ray, scene) : undefined;
    if (!hit) return null;
    const c = Cartographic.fromCartesian(hit);
    return { lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) };
  }

  private screenOf(p: LngLat) {
    return SceneTransforms.worldToWindowCoordinates(
      this.viewer.scene,
      Cartesian3.fromDegrees(p.lng, p.lat, this.ground(p.lng, p.lat)),
    );
  }

  private press(position: Cartesian2) {
    const { a, b } = this.on.ends();
    for (const [which, p] of [
      ['a', a],
      ['b', b],
    ] as const) {
      if (!p) continue;
      const at = this.screenOf(p);
      if (at && Cartesian2.distance(at, position) <= GRAB_PX) {
        this.drag = which;
        this.dragged = false;
        // The camera stays still while a point is dragged.
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;
        this.on.dragging(true);
        return;
      }
    }
  }
  private release() {
    if (!this.drag) return;
    this.drag = null;
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.on.dragging(false);
  }

  private hover(position: Cartesian2) {
    const at = Cartesian2.clone(position);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const p = this.pick(at);
      if (this.drag) {
        if (p) {
          this.dragged = true;
          this.on.move(this.drag, p);
        }
        return;
      }
      const { a, b } = this.view;
      // While B is still to be placed, a dashed line follows the pointer.
      if (a && !b) {
        this.preview = p;
        this.draw();
        return;
      }
      // Near the line, the pointer moves the cursor of the drawer.
      if (a && b && p) {
        const line = makeLine(a, b);
        const at = toLine(line, p);
        if (Math.abs(at.d) < 25 && at.s >= 0 && at.s <= line.length) this.on.cursor(at.s);
      }
    });
  }

  update(view: ProfileView) {
    this.view = view;
    this.preview = view.a && !view.b ? this.preview : null;
    this.draw();
  }

  private position(p: LngLat, above = 0) {
    return Cartesian3.fromDegrees(p.lng, p.lat, this.ground(p.lng, p.lat) + above);
  }

  private draw() {
    if (this.viewer.isDestroyed()) return;
    const entities = this.source.entities;
    entities.suspendEvents();
    entities.removeAll();
    const { a, b, summary, cursor } = this.view;
    const mark = (id: string, p: LngLat, text: string) =>
      entities.add({
        id,
        position: this.position(p, 0.3),
        point: {
          pixelSize: 8,
          color: SIG,
          outlineColor: INK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text,
          font: MARK_FONT,
          fillColor: SIG_INK,
          style: LabelStyle.FILL,
          showBackground: true,
          backgroundColor: SIG,
          backgroundPadding: new Cartesian2(5, 3),
          horizontalOrigin: HorizontalOrigin.RIGHT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(-10, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    const line = a && b ? makeLine(a, b) : null;
    const along = (from: number, to: number, above: number) => {
      const out: Cartesian3[] = [];
      const steps = Math.max(1, Math.ceil((to - from) / 2));
      for (let i = 0; i <= steps; i++)
        out.push(this.position(fromLine(line!, from + ((to - from) * i) / steps), above));
      return out;
    };
    if (a) mark('perfil:A', a, 'A');
    if (b) mark('perfil:B', b, 'B');
    if (a && !b && this.preview)
      entities.add({
        id: 'perfil:guia',
        polyline: {
          positions: [this.position(a, 0.3), this.position(this.preview, 0.3)],
          width: 2,
          arcType: ArcType.NONE,
          material: new PolylineDashMaterialProperty({ color: SIG, dashLength: 12 }),
          depthFailMaterial: new PolylineDashMaterialProperty({ color: SIG.withAlpha(0.6) }),
        },
      });
    if (line) {
      // The line on the ground, every 2 m on the DTM; dashed where the cloud hides it.
      entities.add({
        id: 'perfil:linea',
        polyline: {
          positions: along(0, line.length, 0.3),
          width: 3.5,
          arcType: ArcType.NONE,
          material: new PolylineOutlineMaterialProperty({
            color: SIG,
            outlineColor: INK.withAlpha(0.85),
            outlineWidth: 1,
          }),
          depthFailMaterial: new PolylineDashMaterialProperty({
            color: SIG,
            gapColor: INK.withAlpha(0.35),
            dashLength: 10,
          }),
        },
      });
      // Distance ticks every 50 m (100 m on long lines).
      const step = line.length > 700 ? 100 : 50;
      for (let s = step; s < line.length - step / 3; s += step)
        entities.add({
          id: `perfil:marca:${s}`,
          position: this.position(fromLine(line, s), 0.3),
          label: {
            text: number(s, 0),
            font: TICK_FONT,
            fillColor: FG,
            outlineColor: INK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.TOP,
            pixelOffset: new Cartesian2(0, 8),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          point: {
            pixelSize: 4,
            color: SIG,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      // The section plane: a dashed outline up to just over the highest point.
      if (summary?.top != null) {
        const n = summary.geoid;
        const top = (p: LngLat) => Cartesian3.fromDegrees(p.lng, p.lat, summary.top! + n + 2);
        entities.add({
          id: 'perfil:plano',
          polyline: {
            positions: [this.position(a!, 0), top(a!), top(b!), this.position(b!, 0)],
            width: 1.5,
            arcType: ArcType.NONE,
            material: new PolylineDashMaterialProperty({ color: SIG, dashLength: 10 }),
            depthFailMaterial: new PolylineDashMaterialProperty({
              color: SIG.withAlpha(0.55),
              dashLength: 10,
            }),
          },
        });
        // The buildings' heights as dimension lines, with E1… and the value.
        const dims: Dimension[] = summary.buildings.map((building) => {
          const p = fromLine(line, building.at);
          const foot = Cartesian3.fromDegrees(p.lng, p.lat, building.ground + n);
          const roof = Cartesian3.fromDegrees(p.lng, p.lat, building.roof + n);
          const up = Ellipsoid.WGS84.geodeticSurfaceNormal(roof, new Cartesian3());
          return {
            kind: 'height',
            line: [foot, roof],
            ticks: [
              { at: foot, along: up },
              { at: roof, along: up },
            ],
            labels: [
              {
                at: Cartesian3.midpoint(foot, roof, new Cartesian3()),
                text: `${building.label} · ${number(building.height, 1)} m`,
                side: 'right',
              },
            ],
          };
        });
        drawDimensions(this.source, dims, 'perfil:altura');
      }
      if (cursor !== null) {
        const p = fromLine(line, Math.min(line.length, Math.max(0, cursor)));
        const height = summary?.top != null ? summary.top + summary.geoid + 2 : undefined;
        entities.add({
          id: 'perfil:cursor',
          polyline: {
            positions: [
              this.position(p, 0),
              height !== undefined
                ? Cartesian3.fromDegrees(p.lng, p.lat, height)
                : this.position(p, 40),
            ],
            width: 1.5,
            arcType: ArcType.NONE,
            material: SIG,
            depthFailMaterial: new PolylineDashMaterialProperty({ color: SIG.withAlpha(0.7) }),
          },
        });
      }
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
    cancelAnimationFrame(this.frame);
    this.stopRendering?.();
    this.handler.destroy();
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.viewer.scene.canvas.style.cursor = '';
    const source = this.source;
    void this.added.then(() => {
      if (this.viewer.isDestroyed()) return;
      this.viewer.dataSources.remove(source, true);
      this.viewer.scene.requestRender();
    });
  }
}
