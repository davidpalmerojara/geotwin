/**
 * The profile A–B as pure functions (no Cesium, tested in Node): the line on the ground, the DTM
 * along it, the merged points of the layers' sections, building heights, the CSV export and the
 * geometry of the cut. Same frame as the API (`GET /api/layers/:id/section`): `s` is the distance
 * from A along A→B and `d` the distance from the line, positive to the left of A→B.
 */
import type { Section } from '@geotwin/shared';
import { number } from '../../lib/format';
import type { LngLat } from '../../stores/section';

const A_WGS84 = 6378137;
const E2 = 0.00669437999014;
const DEG = Math.PI / 180;

/** Metres per degree of longitude and latitude at a latitude (WGS 84). */
export function metresPerDegree(lat: number) {
  const sin = Math.sin(lat * DEG);
  const w = Math.sqrt(1 - E2 * sin * sin);
  return {
    lng: ((A_WGS84 * Math.cos(lat * DEG)) / w) * DEG,
    lat: ((A_WGS84 * (1 - E2)) / (w * w * w)) * DEG,
  };
}

/** A local east-north frame at A, enough for lines of a few kilometres (error under 1 cm). */
export interface Line {
  a: LngLat;
  b: LngLat;
  length: number;
  /** Unit vector A→B (east, north). */
  te: number;
  tn: number;
  /** Bearing of A→B from north, clockwise, in degrees. */
  bearing: number;
  scale: { lng: number; lat: number };
}
export function makeLine(a: LngLat, b: LngLat): Line {
  const scale = metresPerDegree((a.lat + b.lat) / 2);
  const e = (b.lng - a.lng) * scale.lng,
    n = (b.lat - a.lat) * scale.lat;
  const length = Math.hypot(e, n);
  const te = length ? e / length : 1,
    tn = length ? n / length : 0;
  const bearing = (((Math.atan2(te, tn) / DEG) % 360) + 360) % 360;
  return { a, b, length, te, tn, bearing, scale };
}
/** s (along A→B) and d (left of A→B) of a point on the ground. */
export function toLine(line: Line, p: LngLat) {
  const e = (p.lng - line.a.lng) * line.scale.lng,
    n = (p.lat - line.a.lat) * line.scale.lat;
  return { s: e * line.te + n * line.tn, d: n * line.te - e * line.tn };
}
/** The ground point at distance s along A→B and d to its left. */
export function fromLine(line: Line, s: number, d = 0): LngLat {
  const e = s * line.te - d * line.tn,
    n = s * line.tn + d * line.te;
  return { lng: line.a.lng + e / line.scale.lng, lat: line.a.lat + n / line.scale.lat };
}

export interface DtmLine {
  /** Distances from A (every `step` metres, and B). */
  s: number[];
  /** Ground height there (whatever `ground` returns: ellipsoidal or orthometric), or null. */
  h: (number | null)[];
}
/** The ground model along A–B every `step` metres (1 m: half the DTM cell), B included. */
export function sampleDtmLine(
  line: Line,
  ground: (lng: number, lat: number) => number | null,
  step = 1,
): DtmLine {
  const s: number[] = [],
    h: (number | null)[] = [];
  const n = Math.floor(line.length / step + 1e-9);
  for (let i = 0; i <= n; i++) s.push(i * step);
  if (line.length - s.at(-1)! > 1e-6) s.push(line.length);
  for (const at of s) {
    const p = fromLine(line, at);
    const v = ground(p.lng, p.lat);
    h.push(v === null || !Number.isFinite(v) ? null : v);
  }
  return { s, h };
}
/** The DTM line at any s, linear between samples; null where it has no data. */
export function dtmAt(dtm: DtmLine, s: number) {
  const { s: xs, h } = dtm;
  if (!xs.length || s < xs[0]! - 1e-9 || s > xs.at(-1)! + 1e-9) return null;
  let lo = 0,
    hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const h0 = h[lo],
    h1 = h[hi];
  if (h0 == null || h1 == null) return h0 ?? h1 ?? null;
  const span = xs[hi]! - xs[lo]!;
  const t = span > 0 ? (s - xs[lo]!) / span : 0;
  return h0 + (h1 - h0) * Math.min(1, Math.max(0, t));
}

/** The points of every layer's section along one line, as orthometric altitudes, sorted by s. */
export interface ProfilePoints {
  count: number;
  s: Float64Array;
  d: Float32Array;
  /** Altitude (h − N of its layer). */
  z: Float32Array;
  cls: Uint8Array;
  rgb: Uint32Array;
}
export function mergeSections(
  sections: Pick<Section, 's' | 'd' | 'h' | 'cls' | 'rgb' | 'geoid_offset_m'>[],
): ProfilePoints {
  const total = sections.reduce((n, x) => n + x.s.length, 0);
  const order: [number, number][] = [];
  sections.forEach((x, k) => x.s.forEach((_, i) => order.push([k, i])));
  order.sort(([k1, i1], [k2, i2]) => sections[k1]!.s[i1]! - sections[k2]!.s[i2]!);
  const out: ProfilePoints = {
    count: total,
    s: new Float64Array(total),
    d: new Float32Array(total),
    z: new Float32Array(total),
    cls: new Uint8Array(total),
    rgb: new Uint32Array(total),
  };
  order.forEach(([k, i], j) => {
    const x = sections[k]!;
    out.s[j] = x.s[i]!;
    out.d[j] = x.d[i]!;
    out.z[j] = x.h[i]! - (x.geoid_offset_m ?? 0);
    out.cls[j] = x.cls[i]!;
    out.rgb[j] = x.rgb[i]!;
  });
  return out;
}

/** The 95th percentile (nearest rank) of some values. */
export function percentile(values: number[], p: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export interface Building {
  label: string;
  /** Where along A–B (m). */
  s0: number;
  s1: number;
  /** The roof: 95th percentile of the class 6 altitudes. */
  roof: number;
  /** The DTM (altitude) under it: the median of the DTM line between s0 and s1. */
  ground: number;
  height: number;
  /** Where the roof is reached, for the dimension: the s of the highest point under the p95. */
  at: number;
}
const BUILDING = 6;
/**
 * Buildings crossed by the line: the class 6 (building) points grouped along s (a gap of more
 * than `gap` metres, a street, starts a new building; a patio or a gap between two wings of one
 * block is narrower); groups shorter than 3 m or with fewer than 15 points are left out.
 * Height = roof (p95 of the group's altitudes) minus the DTM under it.
 */
export function buildingHeights(
  points: Pick<ProfilePoints, 'count' | 's' | 'z' | 'cls'>,
  dtm: DtmLine,
  gap = 8,
): Building[] {
  const groups: number[][] = [];
  let current: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < points.count; i++) {
    if (points.cls[i] !== BUILDING) continue;
    const s = points.s[i]!;
    if (s - last > gap && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(i);
    last = s;
  }
  if (current.length) groups.push(current);
  const buildings: Building[] = [];
  for (const group of groups) {
    const s0 = points.s[group[0]!]!,
      s1 = points.s[group.at(-1)!]!;
    if (s1 - s0 < 3 || group.length < 15) continue;
    const z = group.map((i) => points.z[i]!);
    const roof = percentile(z, 95);
    const under: number[] = [];
    for (let k = 0; k < dtm.s.length; k++) {
      const v = dtm.h[k];
      if (dtm.s[k]! >= s0 && dtm.s[k]! <= s1 && v != null) under.push(v);
    }
    if (!under.length) {
      const v = dtmAt(dtm, (s0 + s1) / 2);
      if (v != null) under.push(v);
    }
    if (!under.length) continue;
    const ground = percentile(under, 50);
    let at = s0,
      best = -Infinity;
    for (const i of group)
      if (points.z[i]! <= roof && points.z[i]! > best) {
        best = points.z[i]!;
        at = points.s[i]!;
      }
    buildings.push({ label: '', s0, s1, roof, ground, height: roof - ground, at });
  }
  return buildings.map((b, i) => ({ ...b, label: `E${i + 1}` }));
}

const csvNumber = (v: number | null, digits: number) =>
  v === null || !Number.isFinite(v) ? '' : v.toFixed(digits).replace('.', ',');
const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`;
/**
 * The profile as CSV for a spreadsheet in Spanish: «;» between fields and a decimal comma.
 * Altitudes are orthometric; the ground is the DTM line under each point.
 */
export function profileCsv(points: ProfilePoints, dtm: DtmLine) {
  const rows = ['distancia_m;desvio_m;cota_m;suelo_mdt_m;sobre_suelo_m;clase;color'];
  for (let i = 0; i < points.count; i++) {
    const s = points.s[i]!,
      z = points.z[i]!;
    const ground = dtmAt(dtm, s);
    rows.push(
      [
        csvNumber(s, 2),
        csvNumber(points.d[i]!, 2),
        csvNumber(z, 2),
        csvNumber(ground, 2),
        csvNumber(ground === null ? null : z - ground, 2),
        String(points.cls[i]),
        hex(points.rgb[i]!),
      ].join(';'),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** ASPRS classes, as the profile names them. */
export const CLASS_NAMES: Record<number, string> = {
  1: 'sin clasificar',
  2: 'suelo',
  3: 'vegetación baja',
  4: 'vegetación media',
  5: 'vegetación alta',
  6: 'edificación',
  7: 'ruido',
  9: 'agua',
  17: 'puente',
};
export const className = (cls: number) => `${cls} · ${CLASS_NAMES[cls] ?? 'otra clase'}`;

/** «245,4 m»: one decimal and a decimal comma. */
export const metres = (m: number, digits = 1) => `${number(m, digits)} m`;
/** «8.287»: counts always grouped by thousands, as the mockups write them. */
export const grouped = (n: number) => {
  const digits = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${digits}` : digits;
};

/** The vertical window of the plot: from just under the ground to the top of the points. */
export function heightRange(points: Pick<ProfilePoints, 'count' | 'z'>, dtm: DtmLine) {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of dtm.h)
    if (v != null) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  for (let i = 0; i < points.count; i++) {
    lo = Math.min(lo, points.z[i]!);
    hi = Math.max(hi, points.z[i]!);
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 50 };
  return { lo: Math.floor(lo - 2), hi: Math.ceil(hi + 3) };
}

/**
 * Pixels per metre of the plot. 1:1 means the same scale on both axes: the line fills the width
 * unless the heights would not fit at 1:1, then both shrink. The exaggeration multiplies only the
 * vertical scale (the plot then scrolls vertically if it has to).
 */
export function plotScale(width: number, height: number, length: number, span: number) {
  if (length <= 0 || width <= 0) return 1;
  return Math.max(0.05, Math.min(width / length, span > 0 ? height / span : Infinity));
}

/** Round steps for an axis: 1, 2 or 5 × 10ⁿ, about `px` pixels apart. */
export function axisStep(pxPerUnit: number, px = 80) {
  const raw = px / pxPerUnit;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= raw) ?? raw;
}

/** Fading of a point with its distance from the plane: 1 on it, 0,3 at the edge of the slab. */
export function fade(d: number, half: number) {
  return 1 - 0.7 * Math.min(1, Math.abs(d) / Math.max(half, 1e-6));
}

/**
 * The cut in the line's frame: x along A→B, y to its left, z up; metres from A. `side` is +1 when
 * the camera is on the left of A→B (the part to clip lies there), −1 otherwise.
 * - front: the box in front of the slab, from the slab's near edge to `depth` metres away;
 * - slab: the slab itself (|y| ≤ half, 0 ≤ x ≤ length).
 */
export function cutRings(length: number, half: number, side: 1 | -1, depth: number) {
  const near = side * half,
    far = side * depth;
  return {
    front: [
      [0, near],
      [length, near],
      [length, far],
      [0, far],
    ] as [number, number][],
    slab: [
      [0, -half],
      [length, -half],
      [length, half],
      [0, half],
    ] as [number, number][],
  };
}

/** A clipping plane as Cesium reads it: n·p + distance < 0 is the clipped side. */
export interface Plane {
  normal: [number, number, number];
  distance: number;
}
/**
 * Planes for the WebGL 1 fallback (ClippingPlaneCollection), in the line's frame.
 * - front: four planes facing out of the box, union off (a point is clipped only when it is
 *   outside every plane, that is inside the box);
 * - hide: four planes facing into the slab, union on (clipped when outside any: off the slab).
 */
export function cutPlanes(
  mode: 'front' | 'hide',
  length: number,
  half: number,
  side: 1 | -1,
  depth: number,
): { planes: Plane[]; union: boolean } {
  if (mode === 'hide')
    return {
      union: true,
      planes: [
        { normal: [0, 1, 0], distance: half }, // y ≥ −half
        { normal: [0, -1, 0], distance: half }, // y ≤ half
        { normal: [1, 0, 0], distance: 0 }, // x ≥ 0
        { normal: [-1, 0, 0], distance: length }, // x ≤ length
      ],
    };
  // Outward normals of the box side·[half, depth] × [0, length].
  return {
    union: false,
    planes: [
      { normal: [0, -side, 0], distance: half }, // keeps side·y ≤ half (the slab and beyond)
      { normal: [0, side, 0], distance: -depth }, // keeps side·y ≥ depth
      { normal: [-1, 0, 0], distance: 0 }, // keeps x ≤ 0
      { normal: [1, 0, 0], distance: -length }, // keeps x ≥ length
    ],
  };
}
/** Whether a point (line frame) is clipped by the planes, with Cesium's rule. */
export function isClipped(set: { planes: Plane[]; union: boolean }, p: [number, number, number]) {
  const outside = set.planes.map(
    (q) => q.normal[0] * p[0] + q.normal[1] * p[1] + q.normal[2] * p[2] + q.distance < 0,
  );
  return set.union ? outside.some(Boolean) : outside.every(Boolean);
}

/**
 * Where a ray meets the ground model, refined from a first guess: `gap(t)` is the height of the
 * ray's point at distance `t` above the ground under it (negative below). Secant steps from the
 * globe's own hit `t0` (the drawn terrain, a coarser level of detail than the bilinear DTM) to
 * where the gap is under `tolerance` metres. Returns `t0` when the steps do not settle (a ray
 * grazing a slope), so a pick is never moved further off than the globe put it.
 */
export function refineOnGround(
  gap: (t: number) => number,
  t0: number,
  tolerance = 0.05,
  maxShift = 50,
) {
  let a = t0,
    fa = gap(a);
  if (!Number.isFinite(fa)) return t0;
  if (Math.abs(fa) <= tolerance) return a;
  // A second point a metre further along gives the slope of the gap.
  let b = t0 + 1,
    fb = gap(b);
  for (let i = 0; i < 8; i++) {
    if (!Number.isFinite(fb) || fb === fa) return t0;
    const c = b - (fb * (b - a)) / (fb - fa);
    if (!Number.isFinite(c) || Math.abs(c - t0) > maxShift) return t0;
    [a, fa] = [b, fb];
    b = c;
    fb = gap(b);
    if (Math.abs(fb) <= tolerance) return b;
  }
  return t0;
}
