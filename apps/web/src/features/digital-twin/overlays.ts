/**
 * The HUD floats over the scene: plates and panels marked `data-map-overlay` hide parts of it
 * along every edge. Every camera framing aims so its target lands in the part left visible.
 */
import {
  BoundingSphere,
  Cartesian3,
  Cartesian4,
  Matrix4,
  PerspectiveFrustum,
  Transforms,
  type Viewer,
} from 'cesium';
import { coveredEdges, type Edges } from './camera';
import { overlayBoxes, sceneBlockers } from '../hud/dom';

export { overlayBoxes, sceneBlockers };

/** Pixels of each edge of the canvas hidden by the HUD. */
export function coveredByOverlays(viewer: Viewer): Edges {
  return coveredEdges(viewer.scene.canvas.getBoundingClientRect(), overlayBoxes());
}

/** Cesium's field of view (the wider screen axis), with its default as a fallback. */
export function viewerFov(viewer: Viewer) {
  const frustum = viewer.camera.frustum;
  return frustum instanceof PerspectiveFrustum && frustum.fov ? frustum.fov : Math.PI / 3;
}

/**
 * The sphere moved `right` metres towards the right of a camera looking with this heading and
 * `forward` metres along the ground away from it.
 */
export function shiftedOnGround(
  sphere: BoundingSphere,
  heading: number,
  right: number,
  forward = 0,
) {
  if (!right && !forward) return sphere;
  const enu = Transforms.eastNorthUpToFixedFrame(sphere.center);
  const east = Matrix4.getColumn(enu, 0, new Cartesian4()),
    north = Matrix4.getColumn(enu, 1, new Cartesian4());
  const c = Math.cos(heading),
    s = Math.sin(heading);
  // Right of the camera: (cos h, −sin h) in east-north; ahead of it: (sin h, cos h).
  const e = c * right + s * forward,
    n = -s * right + c * forward;
  const offset = new Cartesian3(
    e * east.x + n * north.x,
    e * east.y + n * north.y,
    e * east.z + n * north.z,
  );
  return new BoundingSphere(Cartesian3.add(sphere.center, offset, new Cartesian3()), sphere.radius);
}

/** The sphere moved `metres` towards the right of a camera looking with this heading. */
export const shiftedRight = (sphere: BoundingSphere, heading: number, metres: number) =>
  shiftedOnGround(sphere, heading, metres);

/**
 * A target `lift` metres above the line of sight on screen is that far divided by the sine of
 * the pitch further along the ground (pitch −90° looks straight down).
 */
export const liftToGround = (lift: number, pitch: number) =>
  lift / Math.max(0.2, Math.abs(Math.sin(pitch)));
