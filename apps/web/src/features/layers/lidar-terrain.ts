/**
 * Terrain from the layers' ground models (DTM, built by the worker from ASPRS class 2). Pure
 * maths, no Cesium: the viewer wraps `tileHeights` in a CustomHeightmapTerrainProvider.
 *
 * Inside a layer's footprint the height is its DTM (bilinear). Around the covered area the ground
 * blends over BLEND_M into a flat "base" at the median DTM height, so the globe does not drop
 * hundreds of metres at the edge of the data (Valladolid sits on a plateau: a plane is a fair
 * stand-in nearby). Far away the base fades back to the ellipsoid (h = 0) between FAR_START_M
 * and FAR_END_M. Only the covered area is real; the rest is a visual placeholder.
 */
import type { DtmMeta } from '@geotwin/shared';

export const BLEND_M = 400;
export const FAR_START_M = 30_000;
export const FAR_END_M = 60_000;
/**
 * The terrain is drawn this much below the measured ground so the cloud's own ground points are
 * not hidden by the smooth surface (it differs from single points by a few centimetres).
 */
export const TERRAIN_SINK_M = 0.25;
const M_PER_DEG_LAT = 111_132;

export interface DtmGrid {
  meta: DtmMeta;
  /** Heights in metres, row 0 north; NaN where the grid has no data. */
  heights: Float32Array;
  /** Same grid with every gap filled from its row neighbours, for clamped edge sampling. */
  filled: Float32Array;
  /** Footprint corners (lng, lat) in order: the area really measured. */
  footprint: [number, number][];
}

/** Decodes a DTM (metadata and its uint16 little-endian heights). */
export function decodeDtm(meta: DtmMeta, data: ArrayBuffer): DtmGrid {
  const n = meta.width * meta.height;
  if (data.byteLength !== n * 2)
    throw new Error(`DTM de ${data.byteLength} bytes; se esperaban ${n * 2}`);
  const view = new DataView(data);
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = view.getUint16(i * 2, true);
    heights[i] = v === meta.nodata ? NaN : meta.offset + v * meta.scale;
  }
  return {
    meta,
    heights,
    filled: fillRows(heights, meta.width, meta.height),
    footprint: meta.footprint,
  };
}

/** Copies `heights` with each NaN replaced by the nearest value in its row (or column). */
function fillRows(heights: Float32Array, width: number, height: number) {
  const out = Float32Array.from(heights);
  for (let r = 0; r < height; r++) fillLine(out, r * width, 1, width);
  for (let c = 0; c < width; c++) fillLine(out, c, width, height);
  return out;
}
function fillLine(a: Float32Array, start: number, step: number, count: number) {
  let last = NaN;
  const forward: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = a[start + i * step]!;
    if (Number.isFinite(v)) last = v;
    forward.push(last);
  }
  last = NaN;
  for (let i = count - 1; i >= 0; i--) {
    const at = start + i * step;
    const v = a[at]!;
    if (Number.isFinite(v)) {
      last = v;
      continue;
    }
    const f = forward[i]!;
    a[at] =
      Number.isFinite(f) && Number.isFinite(last) ? (f + last) / 2 : Number.isFinite(f) ? f : last;
  }
}

/** Bilinear sample of a grid at (lng, lat); NaN outside the grid or where it has no data. */
export function sampleGrid(grid: DtmGrid, lng: number, lat: number, source = grid.heights) {
  const { west, east, south, north, width, height } = grid.meta;
  const gx = ((lng - west) / (east - west)) * (width - 1);
  const gy = ((north - lat) / (north - south)) * (height - 1);
  // A hair of tolerance: points on the edge must not fall out through rounding.
  if (gx < -1e-6 || gy < -1e-6 || gx > width - 1 + 1e-6 || gy > height - 1 + 1e-6) return NaN;
  const fx = Math.min(Math.max(gx, 0), width - 1),
    fy = Math.min(Math.max(gy, 0), height - 1);
  const x0 = Math.min(Math.floor(fx), width - 2),
    y0 = Math.min(Math.floor(fy), height - 2);
  const tx = fx - x0,
    ty = fy - y0;
  const i = y0 * width + x0;
  const corners = [
    [source[i]!, (1 - tx) * (1 - ty)],
    [source[i + 1]!, tx * (1 - ty)],
    [source[i + width]!, (1 - tx) * ty],
    [source[i + width + 1]!, tx * ty],
  ] as const;
  let sum = 0,
    weight = 0;
  for (const [v, w] of corners)
    if (Number.isFinite(v)) {
      sum += v * w;
      weight += w;
    }
  // Next to a gap, the valid corners carry the value (no NaN holes along the footprint edge).
  return weight > 1e-6 ? sum / weight : NaN;
}

/** Point in convex-or-not polygon (ray casting) in lng/lat. */
export function insidePolygon(lng: number, lat: number, polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!,
      [xj, yj] = polygon[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Approximate distance in metres from (lng, lat) to a grid's bounding box (0 inside). */
export function distanceToGrid(grid: DtmGrid, lng: number, lat: number) {
  const { west, east, south, north } = grid.meta;
  const dLng = lng < west ? west - lng : lng > east ? lng - east : 0;
  const dLat = lat < south ? south - lat : lat > north ? lat - north : 0;
  const mLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLng * mLng, dLat * M_PER_DEG_LAT);
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export interface LidarTerrain {
  grids: DtmGrid[];
  /** Height of the plane around the covered area: the median of the DTM heights. */
  base: number;
  /** Union of the grids' boxes (degrees). */
  extent: { west: number; south: number; east: number; north: number };
}

export function buildTerrain(grids: DtmGrid[]): LidarTerrain | undefined {
  if (!grids.length) return undefined;
  const sample: number[] = [];
  for (const g of grids) {
    const step = Math.max(1, Math.floor(g.heights.length / 4000));
    for (let i = 0; i < g.heights.length; i += step) {
      const v = g.heights[i]!;
      if (Number.isFinite(v)) sample.push(v);
    }
  }
  sample.sort((a, b) => a - b);
  const base = sample.length ? sample[Math.floor(sample.length / 2)]! : 0;
  return {
    grids,
    base,
    extent: {
      west: Math.min(...grids.map((g) => g.meta.west)),
      south: Math.min(...grids.map((g) => g.meta.south)),
      east: Math.max(...grids.map((g) => g.meta.east)),
      north: Math.max(...grids.map((g) => g.meta.north)),
    },
  };
}

/** Ellipsoidal height of the terrain at (lng, lat), in metres (before TERRAIN_SINK_M). */
export function terrainHeight(terrain: LidarTerrain, lng: number, lat: number) {
  let nearest: DtmGrid | undefined,
    distance = Infinity;
  for (const grid of terrain.grids) {
    const d = distanceToGrid(grid, lng, lat);
    if (d === 0 && insidePolygon(lng, lat, grid.footprint)) {
      const v = sampleGrid(grid, lng, lat);
      if (Number.isFinite(v)) return v;
    }
    if (d < distance) {
      distance = d;
      nearest = grid;
    }
  }
  if (!nearest) return 0;
  // Outside every footprint: the closest grid's edge, blended into the base plane.
  if (distance < BLEND_M * 1.5) {
    const { west, east, south, north } = nearest.meta;
    const edge = sampleGrid(
      nearest,
      Math.min(east, Math.max(west, lng)),
      Math.min(north, Math.max(south, lat)),
      nearest.filled,
    );
    const outside = Math.max(distance, distanceOutside(nearest, lng, lat));
    const w = smoothstep(outside / BLEND_M);
    return Number.isFinite(edge) ? edge * (1 - w) + terrain.base * w : terrain.base;
  }
  return terrain.base * (1 - smoothstep((distance - FAR_START_M) / (FAR_END_M - FAR_START_M)));
}

/** Metres from (lng, lat) to the grid's footprint when it lies in the box but not the footprint. */
function distanceOutside(grid: DtmGrid, lng: number, lat: number) {
  if (insidePolygon(lng, lat, grid.footprint)) return 0;
  const mLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  const fp = grid.footprint;
  for (let i = 0; i < fp.length; i++) {
    const [ax, ay] = fp[i]!,
      [bx, by] = fp[(i + 1) % fp.length]!;
    const px = (lng - ax) * mLng,
      py = (lat - ay) * M_PER_DEG_LAT;
    const vx = (bx - ax) * mLng,
      vy = (by - ay) * M_PER_DEG_LAT;
    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(px - t * vx, py - t * vy));
  }
  return best;
}

/**
 * Heights for one heightmap tile: `size` x `size` samples from the north-west corner, row by row,
 * edges included (what Cesium's HeightmapTerrainData expects). Angles in degrees.
 */
export function tileHeights(
  terrain: LidarTerrain,
  rect: { west: number; south: number; east: number; north: number },
  size: number,
) {
  const out = new Float32Array(size * size);
  // Far from everything: flat ellipsoid, no per-sample work.
  const { extent } = terrain;
  const dLng = Math.max(0, extent.west - rect.east, rect.west - extent.east);
  const dLat = Math.max(0, extent.south - rect.north, rect.south - extent.north);
  const midLat = Math.max(Math.abs(rect.south), Math.abs(rect.north));
  const roughDistance = Math.hypot(
    dLng * M_PER_DEG_LAT * Math.cos((Math.min(midLat, 89) * Math.PI) / 180),
    dLat * M_PER_DEG_LAT,
  );
  if (roughDistance > FAR_END_M) return out;
  for (let r = 0; r < size; r++) {
    const lat = rect.north - ((rect.north - rect.south) * r) / (size - 1);
    for (let c = 0; c < size; c++) {
      const lng = rect.west + ((rect.east - rect.west) * c) / (size - 1);
      const h = terrainHeight(terrain, lng, lat);
      out[r * size + c] = h > 0 ? h - TERRAIN_SINK_M : h;
    }
  }
  return out;
}
