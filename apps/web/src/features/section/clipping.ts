/**
 * Cesium side of the cut (tool 4): the clipping collections for each LiDAR tileset, the point
 * shader that dims what is off the slab, and the frame of the A–B line. The geometry itself
 * (rings and planes in the line's frame) is in section-math.ts, tested in Node.
 */
import {
  Cartesian3,
  Cartesian4,
  ClippingPlane,
  ClippingPlaneCollection,
  ClippingPolygon,
  ClippingPolygonCollection,
  CustomShader,
  Matrix3,
  Matrix4,
  Plane,
  Transforms,
  UniformType,
  type Cesium3DTileset,
  type Scene,
} from 'cesium';
import { ROUND_POINTS_GLSL } from '../layers/point-style';
import { cutPlanes, cutRings, fromLine, type Line } from './section-math';

/**
 * The line's frame in ECEF: origin at A on the ellipsoid, x along A→B, y to its left, z up (the
 * local east-north-up frame turned to the line).
 */
export function lineFrame(line: Line) {
  const origin = Cartesian3.fromDegrees(line.a.lng, line.a.lat, 0);
  const enu = Transforms.eastNorthUpToFixedFrame(origin);
  // Columns: x = (te, tn, 0), y = (−tn, te, 0), z = (0, 0, 1) in east-north-up.
  const turn = Matrix4.fromRotationTranslation(
    new Matrix3(line.te, -line.tn, 0, line.tn, line.te, 0, 0, 0, 1),
  );
  return Matrix4.multiply(enu, turn, new Matrix4());
}

/** A ring of (s, d) in the line's frame as positions on the ellipsoid. */
export function ringPositions(line: Line, ring: [number, number][]) {
  return ring.map(([s, d]) => {
    const p = fromLine(line, s, d);
    return Cartesian3.fromDegrees(p.lng, p.lat, 0);
  });
}

/**
 * The model matrix a ClippingPlaneCollection needs so its planes are read in the line's frame.
 * Cesium places a tileset's clipping planes relative to `clippingPlanesOriginMatrix`, which is
 * private (not in Cesium.d.ts) and may change without notice: this is the only place that reads it.
 */
export function clippingPlanesMatrix(
  tileset: Pick<Cesium3DTileset, 'boundingSphere'>,
  frame: Matrix4,
) {
  const origin = (tileset as unknown as { clippingPlanesOriginMatrix?: Matrix4 })
    .clippingPlanesOriginMatrix;
  if (!origin) return Matrix4.clone(frame);
  return Matrix4.multiply(Matrix4.inverse(origin, new Matrix4()), frame, new Matrix4());
}

export type ClipMode = 'front' | 'dim' | 'hide';
export interface CutGeometry {
  line: Line;
  half: number;
  /** +1: the camera (and the part to clip) is on the left of A→B. */
  side: 1 | -1;
  /** How far the clipped box reaches from the line, in metres. */
  depth: number;
}

/** Whether this scene can clip with polygons (it needs WebGL 2). */
export const polygonsSupported = (scene: Scene) => ClippingPolygonCollection.isSupported(scene);

/**
 * Puts the cut on a tileset: with polygons (exact, WebGL 2) the box in front of the slab, or for
 * «Ocultar» the slab itself kept with `inverse`; without WebGL 2, the same with planes.
 */
export function applyClipping(
  tileset: Cesium3DTileset,
  mode: ClipMode,
  geometry: CutGeometry,
  usePolygons: boolean,
) {
  const { line, half, side, depth } = geometry;
  if (usePolygons) {
    const rings = cutRings(line.length, half, side, depth);
    const hide = mode === 'hide';
    tileset.clippingPolygons = new ClippingPolygonCollection({
      polygons: [
        new ClippingPolygon({ positions: ringPositions(line, hide ? rings.slab : rings.front) }),
      ],
      inverse: hide,
    });
    return;
  }
  const set = cutPlanes(mode === 'hide' ? 'hide' : 'front', line.length, half, side, depth);
  tileset.clippingPlanes = new ClippingPlaneCollection({
    planes: set.planes.map((p) => new ClippingPlane(new Cartesian3(...p.normal), p.distance)),
    unionClippingRegions: set.union,
    modelMatrix: clippingPlanesMatrix(tileset, lineFrame(line)),
    edgeWidth: 0,
  });
}
export function removeClipping(tileset: Cesium3DTileset) {
  if (tileset.isDestroyed()) return;
  tileset.clippingPolygons = undefined as unknown as ClippingPolygonCollection;
  tileset.clippingPlanes = undefined as unknown as ClippingPlaneCollection;
}

/**
 * The round-points shader with the slab: points off it (farther than `half` from the plane of
 * A–B, or beyond A or B) are dimmed to 38 % when `u_cutDim` is 1. The planes are given in eye
 * coordinates and updated before every frame: a world-space test in the shader would use 32-bit
 * ECEF positions (about 0,5 m steps at the Earth's radius) and draw a jagged slab edge.
 */
export const CUT_POINTS_GLSL = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float r2 = dot(offset, offset) * 4.0;
  if (r2 > 1.0) discard;
  material.diffuse *= 1.0 - 0.18 * r2;
  vec3 p = fsInput.attributes.positionEC;
  float across = dot(u_cutAcross.xyz, p) + u_cutAcross.w;
  float along = dot(u_cutAlong.xyz, p) + u_cutAlong.w;
  bool outside = abs(across) > u_cutHalf || along < 0.0 || along > u_cutLength;
  if (u_cutDim > 0.5 && outside) material.diffuse *= 0.38;
}
`;
export function cutShader() {
  return new CustomShader({
    uniforms: {
      u_cutAcross: { type: UniformType.VEC4, value: new Cartesian4(0, 0, 1, 0) },
      u_cutAlong: { type: UniformType.VEC4, value: new Cartesian4(1, 0, 0, 0) },
      u_cutHalf: { type: UniformType.FLOAT, value: 1.5 },
      u_cutLength: { type: UniformType.FLOAT, value: 1 },
      u_cutDim: { type: UniformType.FLOAT, value: 0 },
    },
    fragmentShaderText: CUT_POINTS_GLSL,
  });
}
export const roundShader = () => new CustomShader({ fragmentShaderText: ROUND_POINTS_GLSL });

/**
 * The slab's two planes (across: normal to the left of A→B through A; along: normal along A→B
 * through A) in world coordinates, as (normal, distance).
 */
export function slabPlanes(line: Line) {
  const frame = lineFrame(line);
  const origin = Matrix4.getTranslation(frame, new Cartesian3());
  const rotation = Matrix4.getMatrix3(frame, new Matrix3());
  const along = Matrix3.getColumn(rotation, 0, new Cartesian3());
  const across = Matrix3.getColumn(rotation, 1, new Cartesian3());
  return {
    across: new Plane(across, -Cartesian3.dot(across, origin)),
    along: new Plane(along, -Cartesian3.dot(along, origin)),
  };
}
const toVec4 = (plane: Plane, out: Cartesian4) =>
  Cartesian4.fromElements(plane.normal.x, plane.normal.y, plane.normal.z, plane.distance, out);
/** Writes the slab into a cut shader for this frame's view matrix. */
export function updateCutShader(
  shader: CustomShader,
  planes: ReturnType<typeof slabPlanes>,
  view: Matrix4,
  slab: { half: number; length: number; dim: boolean },
) {
  const across = Plane.transform(planes.across, view, new Plane(Cartesian3.UNIT_Z, 0));
  const along = Plane.transform(planes.along, view, new Plane(Cartesian3.UNIT_Z, 0));
  shader.setUniform('u_cutAcross', toVec4(across, new Cartesian4()));
  shader.setUniform('u_cutAlong', toVec4(along, new Cartesian4()));
  shader.setUniform('u_cutHalf', slab.half);
  shader.setUniform('u_cutLength', slab.length);
  shader.setUniform('u_cutDim', slab.dim ? 1 : 0);
}
