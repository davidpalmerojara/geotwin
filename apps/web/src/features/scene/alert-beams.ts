/**
 * Alert beams and pulses in the scene (from direction C): a glowing vertical beam rises from every
 * asset with an active alert, so it is seen from far away, and two rings spread from it until an
 * operator acknowledges the alert («Reconocer»). The beam stays until the alert is resolved.
 *
 * The rings move with a render loop of its own, at most 30 frames a second, that only runs while
 * a pulse is shown, the tab is visible and the user has not asked for less motion; then, and on a
 * renderer too slow to animate, the rings stay still.
 */
import {
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  EllipseGeometry,
  EllipsoidSurfaceAppearance,
  Ellipsoid,
  GeometryInstance,
  Material,
  PolylineGlowMaterialProperty,
  Primitive,
  ArcType,
  type Viewer,
} from 'cesium';
import { reducedMotion } from '../../lib/motion';
import { renderUntil } from '../measure/render-until';

export type AlertLevel = 'warning' | 'critical';
/** Beam length (m) above the asset, by state. */
export const BEAM_LENGTH_M: Record<AlertLevel, number> = { critical: 250, warning: 60 };
/** Beam width on screen (px). */
export const BEAM_WIDTH_PX: Record<AlertLevel, number> = { critical: 14, warning: 10 };
/** Radius of the pulse rings (m). */
export const PULSE_RADIUS_M = 18;
/** One ring every 0,8 s, each one living 1,6 s. */
export const PULSE_PERIOD_MS = 1600;
const FRAME_MS = 1000 / 30;
/** A renderer slower than this (ms a frame, several frames running) keeps the rings still. */
const SLOW_FRAME_MS = 250;
const SLOW_FRAMES = 8;
const COLORS: Record<AlertLevel, string> = { critical: '#FF5A4C', warning: '#FF9F1A' };

/**
 * The beam's two ends: from the asset's anchor up along the geodetic normal (the local vertical
 * of the WGS84 ellipsoid), 250 m for a critical alert and 60 m for a warning.
 */
export function beamPositions(anchor: Cartesian3, level: AlertLevel): [Cartesian3, Cartesian3] {
  const up = Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new Cartesian3());
  const end = Cartesian3.add(
    anchor,
    Cartesian3.multiplyByScalar(up, BEAM_LENGTH_M[level], new Cartesian3()),
    new Cartesian3(),
  );
  return [Cartesian3.clone(anchor), end];
}

/** Ring phase (0–1) of the pulse at a time; still rings sit at a fixed phase. */
export const pulsePhase = (ms: number) => (ms % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
const STILL_PHASE = 0.3;

// Two rings half a period apart spread from the centre and fade out at the edge.
const PULSE_SOURCE = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float r = distance(materialInput.st, vec2(0.5)) * 2.0;
  float alpha = 0.0;
  for (int i = 0; i < 2; i++) {
    float p = fract(u_time + float(i) * 0.5);
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(r - p));
    alpha = max(alpha, ring * (1.0 - p * 0.85));
  }
  alpha *= step(r, 1.0);
  material.diffuse = color.rgb;
  material.alpha = alpha * color.a;
  return material;
}`;

export interface BeamSpec {
  /** The asset's id. */
  id: string;
  level: AlertLevel;
  /** Whether the alert still waits to be acknowledged: the rings are shown. */
  pulse: boolean;
  /** The asset's anchor (its mark), ECEF metres. */
  anchor: Cartesian3;
}
export type PulseMotion = 'none' | 'animated' | 'static';

interface Pulse {
  primitive: Primitive;
  material: Material;
}

/** The beams and pulses of a viewer; `update` with the current list, `destroy` when done. */
export class AlertBeams {
  private source = new CustomDataSource('haces');
  private pulses = new Map<string, Pulse>();
  private keys = new Map<string, string>();
  private frame = 0;
  private last = 0;
  private renders: number[] = [];
  private slow = false;
  private stopRendering: (() => void) | undefined;
  private offRender: () => void;
  private motionQuery: MediaQueryList | undefined;
  /** DataSourceCollection.add resolves later: removal waits for it. */
  private added: Promise<unknown>;
  constructor(
    private viewer: Viewer,
    /** Called when the counts or the motion change (for the data attributes). */
    private onChange: (state: { beams: number; pulses: number; motion: PulseMotion }) => void,
  ) {
    this.added = viewer.dataSources.add(this.source);
    this.offRender = viewer.scene.postRender.addEventListener(() => this.rendered());
    document.addEventListener('visibilitychange', this.restart);
    try {
      this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.motionQuery?.addEventListener?.('change', this.restart);
    } catch {
      this.motionQuery = undefined;
    }
  }
  /** The beam entities (left out when sampling the height of the Google mesh). */
  get entities() {
    return this.source.entities.values;
  }
  get beams() {
    return this.source.entities.values.length;
  }
  get motion(): PulseMotion {
    if (!this.pulses.size) return 'none';
    return this.animating() ? 'animated' : 'static';
  }
  update(specs: BeamSpec[]) {
    if (this.viewer.isDestroyed()) return;
    const wanted = new Set(specs.map((s) => s.id));
    for (const [id] of this.keys)
      if (!wanted.has(id)) {
        this.removeBeam(id);
        this.removePulse(id);
        this.keys.delete(id);
      }
    let built = false;
    for (const spec of specs) {
      const c = Cartographic.fromCartesian(spec.anchor);
      const key = `${spec.level}:${spec.pulse}:${c.longitude.toFixed(9)}:${c.latitude.toFixed(9)}:${c.height.toFixed(1)}`;
      if (this.keys.get(spec.id) === key) continue;
      this.keys.set(spec.id, key);
      this.removeBeam(spec.id);
      this.removePulse(spec.id);
      const color = Color.fromCssColorString(COLORS[spec.level]);
      this.source.entities.add({
        id: `haz:${spec.id}`,
        polyline: {
          positions: beamPositions(spec.anchor, spec.level),
          width: BEAM_WIDTH_PX[spec.level],
          arcType: ArcType.NONE,
          material: new PolylineGlowMaterialProperty({ color, glowPower: 0.25, taperPower: 0.6 }),
        },
      });
      built = true;
      if (spec.pulse) this.addPulse(spec.id, spec.anchor, c, color);
    }
    this.restart();
    this.viewer.scene.requestRender();
    // Polylines are built asynchronously; in request-render mode keep drawing until they are.
    if (built) {
      this.stopRendering?.();
      this.stopRendering = renderUntil(
        () => !this.viewer.isDestroyed() && this.viewer.scene.requestRender(),
        () => this.viewer.isDestroyed() || this.viewer.dataSourceDisplay.ready,
      );
    }
    this.report();
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.stopRendering?.();
    this.offRender();
    document.removeEventListener('visibilitychange', this.restart);
    this.motionQuery?.removeEventListener?.('change', this.restart);
    if (this.viewer.isDestroyed()) return;
    for (const id of [...this.pulses.keys()]) this.removePulse(id);
    const { viewer, source } = this;
    void this.added.then(() => {
      if (viewer.isDestroyed()) return;
      viewer.dataSources.remove(source, true);
      viewer.scene.requestRender();
    });
  }

  private addPulse(id: string, anchor: Cartesian3, at: Cartographic, color: Color) {
    const material = new Material({
      fabric: {
        uniforms: { color: color.withAlpha(0.9), u_time: STILL_PHASE },
        source: PULSE_SOURCE,
      },
      translucent: true,
    });
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new EllipseGeometry({
          center: anchor,
          semiMajorAxis: PULSE_RADIUS_M,
          semiMinorAxis: PULSE_RADIUS_M,
          // Just above the mark, so the roof or the ground under it does not cut the rings.
          height: at.height + 0.4,
          vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        }),
        id: `pulso:${id}`,
      }),
      appearance: new EllipsoidSurfaceAppearance({ material, aboveGround: true }),
      asynchronous: false,
    });
    this.viewer.scene.primitives.add(primitive);
    this.pulses.set(id, { primitive, material });
  }
  private removePulse(id: string) {
    const pulse = this.pulses.get(id);
    if (!pulse) return;
    this.pulses.delete(id);
    if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(pulse.primitive);
  }
  private removeBeam(id: string) {
    this.source.entities.removeById(`haz:${id}`);
  }
  private animating() {
    return !!this.pulses.size && !this.slow && !document.hidden && !reducedMotion();
  }
  /** Starts or stops the loop as the pulses, the tab's visibility or the motion setting change. */
  private restart = () => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renders = [];
    if (this.animating()) this.frame = requestAnimationFrame(this.tick);
    else {
      for (const pulse of this.pulses.values()) pulse.material.uniforms.u_time = STILL_PHASE;
      if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
    }
    this.report();
  };
  private tick = (now: number) => {
    this.frame = 0;
    if (!this.animating() || this.viewer.isDestroyed()) return;
    if (now - this.last >= FRAME_MS) {
      this.last = now;
      const phase = pulsePhase(now);
      for (const pulse of this.pulses.values()) pulse.material.uniforms.u_time = phase;
      this.viewer.scene.requestRender();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  /** Frame times while animating: a renderer that cannot keep up gets still rings. */
  private rendered() {
    if (!this.frame) return;
    const now = performance.now();
    this.renders.push(now);
    if (this.renders.length <= SLOW_FRAMES) return;
    this.renders.shift();
    const first = this.renders[0]!;
    if ((now - first) / (this.renders.length - 1) > SLOW_FRAME_MS) {
      this.slow = true;
      this.restart();
    }
  }
  private reported = '';
  private report() {
    const state = { beams: this.beams, pulses: this.pulses.size, motion: this.motion };
    const key = JSON.stringify(state);
    if (key === this.reported) return;
    this.reported = key;
    this.onChange(state);
  }
}
