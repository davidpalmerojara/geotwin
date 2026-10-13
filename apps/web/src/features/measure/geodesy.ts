/**
 * Measurement maths on the WGS84 ellipsoid, for points picked in the 3D scene (ECEF, metres).
 * Kept free of any viewer state so it can be checked against GeographicLib values.
 */
import {
  Cartesian3,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
  Matrix4,
  Transforms,
} from 'cesium';

const ellipsoid = Ellipsoid.WGS84;

/** Straight-line length through the points in 3D (sum of chord segments). */
export function distance3d(points: Cartesian3[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Cartesian3.distance(points[i - 1]!, points[i]!);
  return total;
}

/** Length along the ellipsoid surface (geodesics between the points' horizontal positions). */
export function groundDistance(points: Cartesian3[], closed = false) {
  const carto = points.map((p) => ellipsoid.cartesianToCartographic(p, new Cartographic()));
  if (closed && carto.length > 2) carto.push(carto[0]!);
  let total = 0;
  const geodesic = new EllipsoidGeodesic(undefined, undefined, ellipsoid);
  for (let i = 1; i < carto.length; i++) {
    const a = carto[i - 1]!,
      b = carto[i]!;
    // Vincenty is undefined for coincident points; their distance is zero anyway.
    if (Math.abs(a.latitude - b.latitude) < 1e-12 && Math.abs(a.longitude - b.longitude) < 1e-12)
      continue;
    geodesic.setEndPoints(a, b);
    total += geodesic.surfaceDistance;
  }
  return total;
}

/** Ellipsoidal height of the last point minus the first (equal to the orthometric difference
 *  to the centimetre within a 1 km tile, where the geoid is nearly flat). */
export function heightDifference(points: Cartesian3[]) {
  if (points.length < 2) return 0;
  const first = ellipsoid.cartesianToCartographic(points[0]!);
  const last = ellipsoid.cartesianToCartographic(points.at(-1)!);
  return last.height - first.height;
}

/**
 * Horizontal area of the polygon on the ellipsoid: vertices brought down to h = 0 (so the area
 * does not depend on the heights picked), projected onto the local tangent plane (east-north) at
 * their centroid, then the shoelace formula. Within a few kilometres this matches the geodesic
 * area on the ellipsoid to better than 0.001 %.
 */
export function horizontalArea(picked: Cartesian3[]) {
  if (picked.length < 3) return 0;
  const points = picked.map((p) => {
    const c = ellipsoid.cartesianToCartographic(p);
    return Cartesian3.fromRadians(c.longitude, c.latitude, 0, ellipsoid);
  });
  const centroid = Cartesian3.multiplyByScalar(
    points.reduce((sum, p) => Cartesian3.add(sum, p, sum), new Cartesian3()),
    1 / points.length,
    new Cartesian3(),
  );
  // Project the centroid onto the surface so the tangent plane is horizontal there.
  const origin = ellipsoid.scaleToGeodeticSurface(centroid, new Cartesian3()) ?? centroid;
  const toLocal = Matrix4.inverseTransformation(
    Transforms.eastNorthUpToFixedFrame(origin, ellipsoid),
    new Matrix4(),
  );
  const local = points.map((p) => Matrix4.multiplyByPoint(toLocal, p, new Cartesian3()));
  let twice = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i]!,
      b = local[(i + 1) % local.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

export interface MeasureResult {
  points: number;
  distance3d: number;
  ground: number;
  height: number;
  area: number;
  perimeter: number;
}
export function measure(points: Cartesian3[], mode: 'distance' | 'area'): MeasureResult {
  return {
    points: points.length,
    distance3d: mode === 'distance' ? distance3d(points) : 0,
    ground: mode === 'distance' ? groundDistance(points) : 0,
    height: mode === 'distance' ? heightDifference(points) : 0,
    area: mode === 'area' ? horizontalArea(points) : 0,
    perimeter: mode === 'area' && points.length > 2 ? groundDistance(points, true) : 0,
  };
}

const fixed = (value: number, digits: number) =>
  value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Lengths with the precision a pick can support: points are about 0.45 m apart in PNOA cob3
 * (5 pts/m²), so centimetres only below 10 m, decimetres up to 1 km, metres beyond.
 */
export function formatLength(m: number) {
  const abs = Math.abs(m);
  if (abs >= 1000) return `${fixed(m / 1000, 3)} km`;
  return `${fixed(m, abs < 10 ? 2 : 1)} m`;
}
export function formatHeight(m: number) {
  const sign = m > 0.005 ? '+' : m < -0.005 ? '−' : '±';
  return `${sign}${formatLength(Math.abs(m))}`;
}
export function formatArea(m2: number) {
  if (m2 >= 1e6) return `${fixed(m2 / 1e6, 3)} km²`;
  if (m2 >= 1e4) return `${fixed(m2, 0)} m² (${fixed(m2 / 1e4, 2)} ha)`;
  return `${fixed(m2, m2 < 100 ? 2 : 1)} m²`;
}

/**
 * The points moved vertically onto the ground model: same horizontal position, height from
 * `ground` (longitude and latitude in degrees in, ellipsoidal metres out). A click lands on
 * whatever is drawn first (a tree crown, a car, a fence); this measures the ground under it.
 */
export function snapToGround(points: Cartesian3[], ground: (lng: number, lat: number) => number) {
  const degrees = 180 / Math.PI;
  return points.map((p) => {
    const c = ellipsoid.cartesianToCartographic(p, new Cartographic());
    const h = ground(c.longitude * degrees, c.latitude * degrees);
    return Cartesian3.fromRadians(c.longitude, c.latitude, h, ellipsoid);
  });
}
