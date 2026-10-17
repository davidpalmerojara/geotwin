import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { SECTION_LIMITS, type Section } from '@geotwin/shared';
import { isSafeKey, type Storage } from '@geotwin/storage';
import { AppError } from '../errors.js';

/**
 * Vertical section of a point-cloud layer along A–B, read on the server from the layer's own
 * 3D Tiles (`.pnts`).
 *
 * Why here and not in the browser: Cesium keeps point positions on the GPU only, the tiles a view
 * has loaded depend on its level of detail (the profile would change with the camera), and fetching
 * every tile the slab crosses at every level costs several MB per profile. The server already
 * stores the tiles: it walks `tileset.json`, skips tiles whose bounding box misses the slab and
 * returns only the points inside, complete and deterministic.
 *
 * Slab geometry: A, B and every point are taken to their footprint on the WGS 84 ellipsoid
 * (longitude and latitude, height 0) and expressed in the east-north plane tangent at the middle
 * of A–B. `s` is the distance from A along A→B and `d` the signed distance from the line (positive
 * to the left of A→B). A point belongs to the slab when 0 ≤ s ≤ |AB| and |d| ≤ half. Over 2 km the
 * tangent plane departs from the ellipsoid by less than a millimetre in distance.
 */

const A_WGS84 = 6378137;
const F_WGS84 = 1 / 298.257223563;
const E2 = F_WGS84 * (2 - F_WGS84);
const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];
export type LonLat = [number, number];
/** Column-major 4×4 matrix, as in 3D Tiles. */
// prettier-ignore
export type Mat4 = [number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
type Box = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type Six = [number, number, number, number, number, number];

export function geodeticToEcef(lonDeg: number, latDeg: number, h: number): Vec3 {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const n = A_WGS84 / Math.sqrt(1 - E2 * sinLat * sinLat);
  return [
    (n + h) * Math.cos(lat) * Math.cos(lon),
    (n + h) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + h) * sinLat,
  ];
}

/** Longitude and latitude in radians and the ellipsoidal height; sub-millimetre near the ground. */
export function ecefToGeodetic(x: number, y: number, z: number) {
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 4; i++) {
    const sinLat = Math.sin(lat);
    const n = A_WGS84 / Math.sqrt(1 - E2 * sinLat * sinLat);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return { lon, lat, h };
}

export interface Slab {
  a: LonLat;
  b: LonLat;
  half: number;
  length: number;
  bearing: number;
  origin: Vec3;
  east: Vec3;
  north: Vec3;
  /** A in the tangent plane (east, north). */
  ae: number;
  an: number;
  /** Unit vector A→B in the tangent plane. */
  te: number;
  tn: number;
}

export function makeSlab(a: LonLat, b: LonLat, half: number): Slab {
  const lon0 = ((a[0] + b[0]) / 2) * DEG;
  const lat0 = ((a[1] + b[1]) / 2) * DEG;
  const origin = geodeticToEcef(lon0 / DEG, lat0 / DEG, 0);
  const east: Vec3 = [-Math.sin(lon0), Math.cos(lon0), 0];
  const north: Vec3 = [
    -Math.sin(lat0) * Math.cos(lon0),
    -Math.sin(lat0) * Math.sin(lon0),
    Math.cos(lat0),
  ];
  const plane = (p: Vec3): [number, number] => {
    const v: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [
      v[0] * east[0] + v[1] * east[1] + v[2] * east[2],
      v[0] * north[0] + v[1] * north[1] + v[2] * north[2],
    ];
  };
  const [ae, an] = plane(geodeticToEcef(a[0], a[1], 0));
  const [be, bn] = plane(geodeticToEcef(b[0], b[1], 0));
  const length = Math.hypot(be - ae, bn - an);
  const te = length > 0 ? (be - ae) / length : 1;
  const tn = length > 0 ? (bn - an) / length : 0;
  const bearing = (((Math.atan2(te, tn) / DEG) % 360) + 360) % 360;
  return { a, b, half, length, bearing, origin, east, north, ae, an, te, tn };
}

/** Exact slab coordinates of an ECEF point: s along A→B, d from the line, h ellipsoidal. */
export function slabCoords(slab: Slab, x: number, y: number, z: number) {
  const { lon, lat, h } = ecefToGeodetic(x, y, z);
  // Footprint on the ellipsoid: step back along the ellipsoid normal by h.
  const cosLat = Math.cos(lat);
  const fx = x - h * cosLat * Math.cos(lon) - slab.origin[0];
  const fy = y - h * cosLat * Math.sin(lon) - slab.origin[1];
  const fz = z - h * Math.sin(lat) - slab.origin[2];
  const e = fx * slab.east[0] + fy * slab.east[1] + fz * slab.east[2] - slab.ae;
  const n = fx * slab.north[0] + fy * slab.north[1] + fz * slab.north[2] - slab.an;
  return { s: e * slab.te + n * slab.tn, d: n * slab.te - e * slab.tn, h };
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = [...IDENTITY] as Mat4;
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  return out;
}
export function transformPoint(m: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

interface BoundingVolume {
  box?: number[];
  sphere?: number[];
  region?: number[];
}
/** True when the tile's bounding volume may hold points of the slab (conservative). */
export function volumeMayCrossSlab(volume: BoundingVolume, world: Mat4, slab: Slab, margin = 1) {
  const corners: Vec3[] = [];
  if (volume.box?.length === 12) {
    const [cx, cy, cz, x0, x1, x2, y0, y1, y2, z0, z1, z2] = volume.box as Box;
    for (const i of [-1, 1])
      for (const j of [-1, 1])
        for (const k of [-1, 1])
          corners.push(
            transformPoint(
              world,
              cx + i * x0 + j * y0 + k * z0,
              cy + i * x1 + j * y1 + k * z1,
              cz + i * x2 + j * y2 + k * z2,
            ),
          );
  } else if (volume.sphere?.length === 4) {
    const [cx, cy, cz, r] = volume.sphere as [number, number, number, number];
    const scale = Math.max(
      Math.hypot(world[0], world[1], world[2]),
      Math.hypot(world[4], world[5], world[6]),
      Math.hypot(world[8], world[9], world[10]),
    );
    const c = transformPoint(world, cx, cy, cz);
    const { s, d } = slabCoords(slab, c[0], c[1], c[2]);
    const radius = r * scale + margin;
    return s >= -radius && s <= slab.length + radius && Math.abs(d) <= slab.half + radius;
  } else if (volume.region?.length === 6) {
    const [w, south, e, north, hMin, hMax] = volume.region as Six;
    for (const lon of [w, e])
      for (const lat of [south, north])
        for (const h of [hMin, hMax]) corners.push(geodeticToEcef(lon / DEG, lat / DEG, h));
  } else return true;
  let sMin = Infinity;
  let sMax = -Infinity;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const [x, y, z] of corners) {
    const { s, d } = slabCoords(slab, x, y, z);
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
  }
  return (
    sMax >= -margin &&
    sMin <= slab.length + margin &&
    dMax >= -slab.half - margin &&
    dMin <= slab.half + margin
  );
}

export interface PntsPoints {
  count: number;
  /** Local position of point i (before the tile transform), RTC centre included. */
  position(i: number): Vec3;
  rgb(i: number): number;
  classification(i: number): number;
}

const COMPONENT: Record<string, [number, (v: DataView, o: number) => number]> = {
  BYTE: [1, (v, o) => v.getInt8(o)],
  UNSIGNED_BYTE: [1, (v, o) => v.getUint8(o)],
  SHORT: [2, (v, o) => v.getInt16(o, true)],
  UNSIGNED_SHORT: [2, (v, o) => v.getUint16(o, true)],
  INT: [4, (v, o) => v.getInt32(o, true)],
  UNSIGNED_INT: [4, (v, o) => v.getUint32(o, true)],
  FLOAT: [4, (v, o) => v.getFloat32(o, true)],
  DOUBLE: [8, (v, o) => v.getFloat64(o, true)],
};
type Ref = { byteOffset: number; componentType?: string; type?: string };
const isRef = (value: unknown): value is Ref =>
  typeof value === 'object' && value !== null && typeof (value as Ref).byteOffset === 'number';

/** Reads a 3D Tiles 1.0 point-cloud tile: positions, colours and the per-point class. */
export function parsePnts(buffer: Buffer): PntsPoints {
  if (buffer.length < 28 || buffer.toString('latin1', 0, 4) !== 'pnts')
    throw new Error('Not a pnts tile');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const ftJsonLength = view.getUint32(12, true);
  const ftBinLength = view.getUint32(16, true);
  const btJsonLength = view.getUint32(20, true);
  const btBinLength = view.getUint32(24, true);
  const ftJson = JSON.parse(buffer.toString('utf8', 28, 28 + ftJsonLength).trim() || '{}');
  const ftBin = 28 + ftJsonLength;
  const btJsonStart = ftBin + ftBinLength;
  const btJson = btJsonLength
    ? JSON.parse(buffer.toString('utf8', btJsonStart, btJsonStart + btJsonLength).trim() || '{}')
    : {};
  const btBin = btJsonStart + btJsonLength;
  if (btBin + btBinLength > buffer.length) throw new Error('Truncated pnts tile');
  const count = Number(ftJson.POINTS_LENGTH) || 0;

  let rtc: Vec3 = [0, 0, 0];
  if (Array.isArray(ftJson.RTC_CENTER)) rtc = ftJson.RTC_CENTER as Vec3;
  else if (isRef(ftJson.RTC_CENTER)) {
    const o = ftBin + ftJson.RTC_CENTER.byteOffset;
    rtc = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
  }
  let position: (i: number) => Vec3;
  if (isRef(ftJson.POSITION)) {
    const base = ftBin + ftJson.POSITION.byteOffset;
    position = (i) => {
      const o = base + i * 12;
      return [
        view.getFloat32(o, true) + rtc[0],
        view.getFloat32(o + 4, true) + rtc[1],
        view.getFloat32(o + 8, true) + rtc[2],
      ];
    };
  } else if (isRef(ftJson.POSITION_QUANTIZED)) {
    const base = ftBin + ftJson.POSITION_QUANTIZED.byteOffset;
    const offset = ftJson.QUANTIZED_VOLUME_OFFSET as Vec3;
    const scale = ftJson.QUANTIZED_VOLUME_SCALE as Vec3;
    if (!Array.isArray(offset) || !Array.isArray(scale))
      throw new Error('Quantized positions without their volume');
    position = (i) => {
      const o = base + i * 6;
      return [
        (view.getUint16(o, true) / 65535) * scale[0] + offset[0] + rtc[0],
        (view.getUint16(o + 2, true) / 65535) * scale[1] + offset[1] + rtc[1],
        (view.getUint16(o + 4, true) / 65535) * scale[2] + offset[2] + rtc[2],
      ];
    };
  } else throw new Error('pnts tile without positions');

  let rgb: (i: number) => number = () => 0xbab6ac;
  if (isRef(ftJson.RGB)) {
    const base = ftBin + ftJson.RGB.byteOffset;
    rgb = (i) =>
      (buffer[base + i * 3]! << 16) | (buffer[base + i * 3 + 1]! << 8) | buffer[base + i * 3 + 2]!;
  } else if (isRef(ftJson.RGBA)) {
    const base = ftBin + ftJson.RGBA.byteOffset;
    rgb = (i) =>
      (buffer[base + i * 4]! << 16) | (buffer[base + i * 4 + 1]! << 8) | buffer[base + i * 4 + 2]!;
  } else if (isRef(ftJson.RGB565)) {
    const base = ftBin + ftJson.RGB565.byteOffset;
    rgb = (i) => {
      const v = view.getUint16(base + i * 2, true);
      const r = Math.round((((v >> 11) & 31) * 255) / 31);
      const g = Math.round((((v >> 5) & 63) * 255) / 63);
      const b = Math.round(((v & 31) * 255) / 31);
      return (r << 16) | (g << 8) | b;
    };
  } else if (Array.isArray(ftJson.CONSTANT_RGBA)) {
    const [r, g, b] = ftJson.CONSTANT_RGBA as [number, number, number, number];
    rgb = () => (r << 16) | (g << 8) | b;
  }

  // Classification lives in the batch table, per point or per batch (BATCH_ID).
  let batchId: (i: number) => number = (i) => i;
  if (isRef(ftJson.BATCH_ID)) {
    const [size, read] =
      COMPONENT[ftJson.BATCH_ID.componentType ?? 'UNSIGNED_SHORT'] ?? COMPONENT.UNSIGNED_SHORT!;
    const base = ftBin + ftJson.BATCH_ID.byteOffset;
    batchId = (i) => read(view, base + i * size);
  }
  let classification: (i: number) => number = () => 0;
  const cls = btJson.classification ?? btJson.Classification;
  if (Array.isArray(cls)) classification = (i) => Number(cls[batchId(i)]) || 0;
  else if (isRef(cls)) {
    const [size, read] =
      COMPONENT[cls.componentType ?? 'UNSIGNED_BYTE'] ?? COMPONENT.UNSIGNED_BYTE!;
    const base = btBin + cls.byteOffset;
    classification = (i) => read(view, base + batchId(i) * size);
  }
  return { count, position, rgb, classification };
}

interface TileJson {
  boundingVolume?: BoundingVolume;
  transform?: number[];
  refine?: string;
  content?: { uri?: string; url?: string };
  children?: TileJson[];
}

export class SectionTooLargeError extends AppError {
  constructor(max: number) {
    super(
      413,
      'SECTION_TOO_LARGE',
      `La franja tiene más de ${max.toLocaleString('es-ES')} puntos. Acorta A–B o estrecha el corte.`,
    );
  }
}

async function readAll(body: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Every point of the layer's tiles that falls inside the slab, sorted by s. */
export async function computeSection(
  storage: Storage,
  tilesetKey: string,
  slab: Slab,
  maxPoints: number,
) {
  const root = posix.dirname(tilesetKey);
  const keyFor = (dir: string, uri: string) => {
    const key = posix.normalize(posix.join(dir, decodeURIComponent(uri.split('?')[0] ?? '')));
    if (!key.startsWith(`${root}/`) || !isSafeKey(key))
      throw new Error(`Tile outside the layer: ${uri}`);
    return key;
  };
  const read = async (key: string) => {
    const object = await storage.get(key);
    if (!object) throw new Error(`Missing tile ${key}`);
    return readAll(object.body);
  };
  // Content tiles to read, with their world matrix. A REPLACE tile with children is a coarser copy
  // of what its children hold (py3dtiles' root preview), so only ADD contents and leaves count.
  const contents: { key: string; world: Mat4 }[] = [];
  const walk = async (tile: TileJson, parent: Mat4, dir: string, refine: string) => {
    const world = tile.transform?.length === 16 ? multiply(parent, tile.transform as Mat4) : parent;
    const mode = (tile.refine ?? refine).toUpperCase();
    if (tile.boundingVolume && !volumeMayCrossSlab(tile.boundingVolume, world, slab, slab.half + 1))
      return;
    const uri = tile.content?.uri ?? tile.content?.url;
    const hasChildren = Boolean(tile.children?.length);
    if (uri) {
      const key = keyFor(dir, uri);
      if (key.endsWith('.json')) {
        const nested = JSON.parse((await read(key)).toString('utf8')) as { root: TileJson };
        await walk(nested.root, world, posix.dirname(key), mode);
      } else if (mode === 'ADD' || !hasChildren) contents.push({ key, world });
    }
    for (const child of tile.children ?? []) await walk(child, world, dir, mode);
  };
  const tileset = JSON.parse((await read(tilesetKey)).toString('utf8')) as { root: TileJson };
  await walk(tileset.root, IDENTITY, root, 'REPLACE');

  const s: number[] = [];
  const d: number[] = [];
  const h: number[] = [];
  const cls: number[] = [];
  const rgb: number[] = [];
  const margin = 2; // the linear pre-filter is within ~0.2 m of the exact footprint over 2 km
  const take = (points: PntsPoints, world: Mat4) => {
    // Linear pre-filter: the tangent-plane coordinates of the point itself, an affine map of
    // its local position; the exact footprint is computed only for candidates near the slab.
    const { origin, east, north, te, tn, ae, an, half, length } = slab;
    const row = (axis: Vec3): [number, number, number, number] => [
      axis[0] * world[0] + axis[1] * world[1] + axis[2] * world[2],
      axis[0] * world[4] + axis[1] * world[5] + axis[2] * world[6],
      axis[0] * world[8] + axis[1] * world[9] + axis[2] * world[10],
      axis[0] * (world[12] - origin[0]) +
        axis[1] * (world[13] - origin[1]) +
        axis[2] * (world[14] - origin[2]),
    ];
    const re = row(east);
    const rn = row(north);
    for (let i = 0; i < points.count; i++) {
      const [x, y, z] = points.position(i);
      const e = re[0] * x + re[1] * y + re[2] * z + re[3] - ae;
      const n = rn[0] * x + rn[1] * y + rn[2] * z + rn[3] - an;
      const sl = e * te + n * tn;
      const dl = n * te - e * tn;
      if (sl < -margin || sl > length + margin || Math.abs(dl) > half + margin) continue;
      const p = transformPoint(world, x, y, z);
      const exact = slabCoords(slab, p[0], p[1], p[2]);
      if (exact.s < 0 || exact.s > length || Math.abs(exact.d) > half) continue;
      if (s.length >= maxPoints) throw new SectionTooLargeError(maxPoints);
      s.push(exact.s);
      d.push(exact.d);
      h.push(exact.h);
      cls.push(points.classification(i));
      rgb.push(points.rgb(i));
    }
  };
  for (let i = 0; i < contents.length; i += 8) {
    const batch = contents.slice(i, i + 8);
    const buffers = await Promise.all(batch.map((c) => read(c.key)));
    buffers.forEach((buffer, j) => take(parsePnts(buffer), batch[j]!.world));
  }
  const order = s.map((_, i) => i).sort((x, y) => s[x]! - s[y]! || d[x]! - d[y]!);
  const cm = (v: number) => Math.round(v * 100) / 100;
  return {
    tiles: contents.length,
    s: order.map((i) => cm(s[i]!)),
    d: order.map((i) => cm(d[i]!)),
    h: order.map((i) => cm(h[i]!)),
    cls: order.map((i) => cls[i]!),
    rgb: order.map((i) => rgb[i]!),
  };
}

export function parseLonLat(text: string): LonLat | null {
  const [lon = NaN, lat = NaN] = text.split(',').map((v) => Number(v.trim()));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

/** Checks A, B and the length; throws the 400 the API answers with. */
export function slabFromQuery(query: { a: string; b: string; half: number }) {
  const a = parseLonLat(query.a);
  const b = parseLonLat(query.b);
  if (!a || !b)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'A y B van como lon,lat en grados (longitud −180 a 180, latitud −90 a 90).',
    );
  const slab = makeSlab(a, b, query.half);
  if (slab.length < 1)
    throw new AppError(400, 'VALIDATION_ERROR', 'A y B están a menos de 1 m: separa los puntos.');
  if (slab.length > SECTION_LIMITS.maxLengthM)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `La línea A–B mide ${(slab.length / 1000).toFixed(2).replace('.', ',')} km; el máximo es 2 km.`,
    );
  return slab;
}

/** Longitude/latitude box of the slab, to skip layers it cannot touch. */
export function slabBounds(slab: Slab): [number, number, number, number] {
  const pad = slab.half + 1;
  const lat = ((slab.a[1] + slab.b[1]) / 2) * DEG;
  const dLat = pad / 111_132;
  const dLon = pad / (111_320 * Math.cos(lat));
  return [
    Math.min(slab.a[0], slab.b[0]) - dLon,
    Math.min(slab.a[1], slab.b[1]) - dLat,
    Math.max(slab.a[0], slab.b[0]) + dLon,
    Math.max(slab.a[1], slab.b[1]) + dLat,
  ];
}

export interface CacheEntry {
  etag: string;
  json: Buffer;
  /** gzip of `json`, made on the first request that accepts it. */
  gz?: Buffer;
  points: number;
}
/** Small in-memory LRU of serialised sections, bounded by entries and by points. */
export class SectionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<CacheEntry>>();
  private points = 0;
  constructor(
    private readonly maxEntries = 48,
    private readonly maxPoints = 2_000_000,
  ) {}
  get size() {
    return this.entries.size;
  }
  async get(key: string, build: () => Promise<Section>): Promise<CacheEntry> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const running = this.pending.get(key);
    if (running) return running;
    const promise = build()
      .then((section) => {
        const entry: CacheEntry = {
          etag: `"${createHash('sha1').update(key).digest('hex').slice(0, 24)}"`,
          json: Buffer.from(JSON.stringify(section)),
          points: section.count,
        };
        this.entries.set(key, entry);
        this.points += entry.points;
        while (
          this.entries.size > this.maxEntries ||
          (this.points > this.maxPoints && this.entries.size > 1)
        ) {
          const [oldest, value] = this.entries.entries().next().value!;
          this.entries.delete(oldest);
          this.points -= value.points;
        }
        return entry;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
