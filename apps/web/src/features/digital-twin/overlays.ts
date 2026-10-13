/**
 * Panels that float over the right of the map (marked `data-map-overlay`, like «Capas») hide
 * part of the view. Every camera framing aims so its target lands in the part left visible.
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
import { coveredRight } from './camera';

/** Pixels on the right of the canvas hidden by floating panels; 0 when they flow below it. */
export function coveredByOverlays(viewer: Viewer) {
  const canvas = viewer.scene.canvas.getBoundingClientRect();
  const boxes = [...document.querySelectorAll('[data-map-overlay]')]
    .filter((overlay) => getComputedStyle(overlay).position === 'absolute')
    .map((overlay) => overlay.getBoundingClientRect());
  return coveredRight(canvas, boxes);
}

/** Cesium's field of view (the wider screen axis), with its default as a fallback. */
export function viewerFov(viewer: Viewer) {
  const frustum = viewer.camera.frustum;
  return frustum instanceof PerspectiveFrustum && frustum.fov ? frustum.fov : Math.PI / 3;
}

/** The sphere moved `metres` towards the right of a camera looking with this heading. */
export function shiftedRight(sphere: BoundingSphere, heading: number, metres: number) {
  if (!metres) return sphere;
  const enu = Transforms.eastNorthUpToFixedFrame(sphere.center);
  const east = Matrix4.getColumn(enu, 0, new Cartesian4()),
    north = Matrix4.getColumn(enu, 1, new Cartesian4());
  const right = new Cartesian3(
    Math.cos(heading) * east.x - Math.sin(heading) * north.x,
    Math.cos(heading) * east.y - Math.sin(heading) * north.y,
    Math.cos(heading) * east.z - Math.sin(heading) * north.z,
  );
  return new BoundingSphere(
    Cartesian3.add(
      sphere.center,
      Cartesian3.multiplyByScalar(right, metres, new Cartesian3()),
      new Cartesian3(),
    ),
    sphere.radius,
  );
}
