// Pure camera-framing maths, kept free of Cesium so it can be unit-tested in Node.
export interface LatLng {
  lat: number;
  lng: number;
}
const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * Centre and radius (metres) of a circle that contains every point, padded so that
 * markers, labels and installation areas near the edge stay inside the view.
 * By default the padding grows with the frame (30 %, between 200 and 450 m): the whole
 * network keeps room for its labels (about 160 px wide, centred on the marker) and one
 * installation (a 210 m area) fills the view.
 */
export function frameOf(points: LatLng[], paddingM?: number, minRadiusM = 300) {
  if (!points.length) return undefined;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
  const radius = Math.max(...points.map((p) => distanceM(center, p)));
  const padding = paddingM ?? Math.min(450, Math.max(200, radius * 0.3));
  return { center, radius: Math.max(minRadiusM, radius + padding) };
}
/**
 * Camera distance that fits a sphere of `radius` in a perspective frustum.
 * Cesium's `fov` spans the wider screen axis, so on a portrait phone the
 * horizontal angle is the narrow one and decides the distance.
 */
export function fitDistance(radius: number, fov: number, aspectRatio: number, margin = 1.15) {
  return fitInView(radius, fov, aspectRatio, 1, 0, margin).distance;
}

/** Tangent of half the horizontal and vertical field of view of Cesium's `fov`. */
function halfTangents(fov: number, width: number, height: number) {
  const aspect = width / height;
  const fovy = aspect <= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
  const y = Math.tan(fovy / 2);
  return { x: y * aspect, y };
}

/**
 * Metres to aim the camera to the right of a target `distance` away so the target lands in the
 * middle of the part of the canvas that a panel `covered` px wide on the right leaves visible.
 */
export function aimShift(
  distance: number,
  fov: number,
  width: number,
  height: number,
  covered: number,
) {
  if (!covered || !width || !height) return 0;
  return (distance * halfTangents(fov, width, height).x * covered) / width;
}

/**
 * Fits a sphere in the visible part of a `width` x `height` canvas whose right `covered` px are
 * hidden by a floating panel: the camera distance for the narrower visible angle and how far to
 * aim to the right of the sphere so it sits centred in what is left.
 */
export function fitInView(
  radius: number,
  fov: number,
  width: number,
  height: number,
  covered = 0,
  margin = 1.15,
) {
  const hidden = Math.max(0, Math.min(covered, width / 2));
  const half = halfTangents(fov, width, height);
  const narrow = Math.min(Math.atan((half.x * (width - hidden)) / width), Math.atan(half.y));
  const distance = (radius / Math.sin(narrow)) * margin;
  return { distance, shift: aimShift(distance, fov, width, height, hidden) };
}

export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/**
 * Pixels on the right of the canvas hidden by panels floating over the map. Only panels that
 * start in the right half and cover at least a quarter of its height count: a collapsed header
 * is a thin strip that the framing margin already leaves room for.
 */
export function coveredRight(canvas: ScreenBox, overlays: ScreenBox[]) {
  const width = canvas.right - canvas.left,
    height = canvas.bottom - canvas.top;
  let covered = 0;
  for (const box of overlays) {
    const overlap = Math.min(box.bottom, canvas.bottom) - Math.max(box.top, canvas.top);
    if (box.left <= canvas.left + width / 2 || box.left >= canvas.right) continue;
    if (overlap < height / 4) continue;
    covered = Math.max(covered, canvas.right - box.left);
  }
  return covered;
}

/**
 * Whether two camera poses [longitude, latitude, heading, pitch] (radians) are the same: about
 * 0.5 m on the ground and 0.05° of rotation. Height is left out on purpose, as Cesium lifts a
 * camera that ends up below newly loaded terrain without the user moving it.
 */
export function samePose(a: readonly number[], b: readonly number[]) {
  const turn = (x: number) => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
  return (
    a.length === b.length &&
    a.every((x, i) => (i < 2 ? Math.abs(x - b[i]!) < 1e-7 : turn(x - b[i]!) < 1e-3))
  );
}
