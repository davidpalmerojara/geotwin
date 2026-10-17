/**
 * Tool 4, Corte: everything in front of the A–B line is clipped on every LiDAR tileset (also on
 * the ones that load later), the floor of the clipped box gets a 10 m grid on the terrain, and
 * the points off the slab can be dimmed («Atenuar») or hidden («Ocultar»). While a cut lasts the
 * Google mesh (it would hide the cut) and eye-dome lighting (it draws halos along clipped edges)
 * are switched off, and switched back on when it ends.
 */
import {
  Cartesian2,
  ClassificationType,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  GridMaterialProperty,
  GroundPrimitive,
  PolygonHierarchy,
  type Cesium3DTileset,
  type CustomShader,
  type Viewer,
} from 'cesium';
import { cloudTilesets, onCloudTilesets } from '../layers/point-cloud-layers';
import { useLayerView } from '../../stores/layers';
import { useScene } from '../../stores/viewer';
import type { CutMode } from '../../stores/section';
import { cutRings, toLine, type Line } from './section-math';
import {
  applyClipping,
  cutShader,
  polygonsSupported,
  removeClipping,
  ringPositions,
  roundShader,
  slabPlanes,
  updateCutShader,
  type CutGeometry,
} from './clipping';
import { renderUntil } from '../measure/render-until';

const FLOOR = Color.fromCssColorString('#EEECE6');

export class CutTool {
  private readonly floor = new CustomDataSource('corte');
  private readonly added: Promise<unknown>;
  private readonly shaders = new Map<Cesium3DTileset, CustomShader>();
  private readonly offs: (() => void)[] = [];
  private geometry: CutGeometry | null = null;
  private mode: Exclude<CutMode, 'off'> = 'front';
  private planes: ReturnType<typeof slabPlanes> | null = null;
  private restore = { photoreal: false, edl: false };
  private stopRendering: (() => void) | undefined;
  readonly polygons: boolean;

  constructor(
    private readonly viewer: Viewer,
    private readonly host: HTMLElement,
  ) {
    this.polygons = polygonsSupported(viewer.scene);
    this.added = viewer.dataSources.add(this.floor);
    this.offs.push(onCloudTilesets(() => this.applyAll()));
    this.offs.push(
      viewer.scene.preRender.addEventListener(() => {
        if (!this.planes || !this.geometry) return;
        for (const shader of this.shaders.values())
          updateCutShader(shader, this.planes, viewer.camera.viewMatrix, {
            half: this.geometry.half,
            length: this.geometry.line.length,
            dim: this.mode === 'dim',
          });
      }),
    );
    // The part to clip is the camera's side of the line: it follows the camera when it stops.
    this.offs.push(
      viewer.camera.moveEnd.addEventListener(() => {
        if (!this.geometry) return;
        const next = this.geometryFor(this.geometry.line, this.geometry.half);
        if (next.side !== this.geometry.side || next.depth > this.geometry.depth * 1.5) {
          this.geometry = next;
          this.applyAll();
          this.drawFloor();
        }
      }),
    );
    // Off while the cut lasts: the Google mesh would hide it, EDL halos the clipped edges.
    const scene = useScene.getState();
    if (scene.photoreal === 'on' && scene.api) {
      this.restore.photoreal = true;
      scene.api.togglePhotoreal();
    }
    const view = useLayerView.getState();
    if (view.edl) {
      this.restore.edl = true;
      view.setEdl(false);
    }
  }

  private geometryFor(line: Line, half: number): CutGeometry {
    const camera = this.viewer.camera.positionCartographic;
    const at = toLine(line, {
      lng: (camera.longitude * 180) / Math.PI,
      lat: (camera.latitude * 180) / Math.PI,
    });
    const side: 1 | -1 = at.d >= 0 ? 1 : -1;
    // Far enough to reach past the camera, so nothing in front of the line is left to hide it.
    const depth = Math.min(4000, Math.max(250, Math.abs(at.d) + 250, line.length * 0.6));
    return { line, half, side, depth };
  }

  /** Sets (or moves) the cut; with no line yet, nothing is clipped. */
  update(line: Line | null, half: number, mode: Exclude<CutMode, 'off'>) {
    this.mode = mode;
    this.geometry = line ? this.geometryFor(line, half) : null;
    this.planes = line ? slabPlanes(line) : null;
    this.applyAll();
    this.drawFloor();
    this.host.dataset.cut = mode;
  }

  private applyAll() {
    for (const tileset of cloudTilesets.values()) {
      if (tileset.isDestroyed()) continue;
      if (!this.geometry) {
        removeClipping(tileset);
        continue;
      }
      applyClipping(tileset, this.mode, this.geometry, this.polygons);
      if (!this.shaders.has(tileset)) {
        const shader = cutShader();
        this.shaders.set(tileset, shader);
        tileset.customShader = shader;
      }
    }
    for (const tileset of [...this.shaders.keys()])
      if (tileset.isDestroyed() || ![...cloudTilesets.values()].includes(tileset))
        this.shaders.delete(tileset);
    this.viewer.scene.requestRender();
  }

  /** A 10 m grid on the terrain over the clipped box (a light tint where materials are not supported). */
  private drawFloor() {
    this.floor.entities.removeAll();
    const g = this.geometry;
    if (!g || this.mode === 'hide') {
      this.viewer.scene.requestRender();
      return;
    }
    const ring = cutRings(g.line.length, g.half, g.side, g.depth).front;
    const grid = GroundPrimitive.supportsMaterials(this.viewer.scene);
    this.floor.entities.add({
      id: 'corte:suelo',
      polygon: {
        hierarchy: new PolygonHierarchy(ringPositions(g.line, ring)),
        classificationType: ClassificationType.TERRAIN,
        // Turned with the line, so the cells run along A–B.
        stRotation: Math.atan2(g.line.tn, g.line.te),
        material: grid
          ? new GridMaterialProperty({
              color: FLOOR.withAlpha(0.32),
              cellAlpha: 0.06,
              lineCount: new Cartesian2(
                Math.max(1, Math.round(g.line.length / 10)),
                Math.max(1, Math.round(g.depth / 10)),
              ),
              lineThickness: new Cartesian2(1, 1),
            })
          : new ColorMaterialProperty(FLOOR.withAlpha(0.08)),
      },
    });
    this.viewer.scene.requestRender();
    this.stopRendering?.();
    this.stopRendering = renderUntil(
      () => !this.viewer.isDestroyed() && this.viewer.scene.requestRender(),
      () => this.viewer.isDestroyed() || this.viewer.dataSourceDisplay.ready,
    );
  }

  destroy() {
    this.offs.forEach((off) => off());
    this.stopRendering?.();
    delete this.host.dataset.cut;
    if (this.viewer.isDestroyed()) return;
    for (const tileset of cloudTilesets.values()) {
      if (tileset.isDestroyed()) continue;
      removeClipping(tileset);
      if (this.shaders.has(tileset)) tileset.customShader = roundShader();
    }
    const floor = this.floor;
    void this.added.then(() => {
      if (!this.viewer.isDestroyed()) {
        this.viewer.dataSources.remove(floor, true);
        this.viewer.scene.requestRender();
      }
    });
    const scene = useScene.getState();
    if (this.restore.photoreal && scene.photoreal !== 'on') scene.api?.togglePhotoreal();
    if (this.restore.edl) useLayerView.getState().setEdl(true);
    this.viewer.scene.requestRender();
  }
}
