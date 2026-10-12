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
 */
export function frameOf(points: LatLng[], paddingM = 250, minRadiusM = 400) {
  if (!points.length) return undefined;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
  const radius = Math.max(...points.map((p) => distanceM(center, p)));
  return { center, radius: Math.max(minRadiusM, radius + paddingM) };
}
/**
 * Camera distance that fits a sphere of `radius` in a perspective frustum.
 * Cesium's `fov` spans the wider screen axis, so on a portrait phone the
 * horizontal angle is the narrow one and decides the distance.
 */
export function fitDistance(radius: number, fov: number, aspectRatio: number, margin = 1.15) {
  const fovy = aspectRatio <= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspectRatio);
  const fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspectRatio);
  const narrow = Math.min(fovx, fovy);
  return (radius / Math.sin(narrow / 2)) * margin;
}
