import { describe, expect, it } from 'vitest';
import type { DtmMeta } from '@geotwin/shared';
import {
  BLEND_M,
  buildTerrain,
  decodeDtm,
  FAR_END_M,
  fillNearest,
  FAR_START_M,
  insidePolygon,
  sampleGrid,
  terrainHeight,
  TERRAIN_SINK_M,
  tileHeights,
} from './lidar-terrain';

// A small synthetic DTM: 11 x 11 nodes over 0.01° x 0.01° near Laguna de Duero, h = 750 m rising
// 1 m per node eastwards, 1 cm steps.
function grid(west = -4.73, south = 41.57, nodata: number[] = [], rise = 1) {
  const width = 11,
    height = 11;
  const meta: DtmMeta = {
    version: 1,
    encoding: 'uint16le',
    heights: 'ellipsoidal',
    width,
    height,
    west,
    south,
    east: west + 0.01,
    north: south + 0.01,
    offset: 740,
    scale: 0.01,
    nodata: 65535,
    min: 750,
    max: 760,
    cell_m: 100,
    footprint: [
      [west, south],
      [west + 0.01, south],
      [west + 0.01, south + 0.01],
      [west, south + 0.01],
    ],
    ground_points: 1000,
    measured_fraction: 0.9,
    data: 'dtm.bin',
  };
  const buffer = new ArrayBuffer(width * height * 2);
  const view = new DataView(buffer);
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      view.setUint16(i * 2, nodata.includes(i) ? 65535 : Math.round((10 + c * rise) / 0.01), true);
    }
  return { meta, buffer };
}
const metresPerDegLng = 111_132 * Math.cos((41.575 * Math.PI) / 180);

describe('LiDAR ground model as terrain', () => {
  it('decodes uint16 steps into heights and keeps no-data as NaN', () => {
    const { meta, buffer } = grid(-4.73, 41.57, [0]);
    const dtm = decodeDtm(meta, buffer);
    expect(Number.isNaN(dtm.heights[0])).toBe(true);
    expect(dtm.heights[1]).toBeCloseTo(751, 5);
    expect(dtm.heights[10]).toBeCloseTo(760, 5);
    // The filled copy used at the edges has no gaps.
    expect(dtm.filled[0]).toBeCloseTo(751, 5);
    expect(() => decodeDtm(meta, new ArrayBuffer(10))).toThrow(/bytes/);
  });

  it('samples bilinearly between nodes, with row 0 at the north edge', () => {
    const { meta, buffer } = grid();
    const dtm = decodeDtm(meta, buffer);
    expect(sampleGrid(dtm, -4.73, 41.58)).toBeCloseTo(750, 4);
    expect(sampleGrid(dtm, -4.7295, 41.575)).toBeCloseTo(750.5, 4);
    expect(sampleGrid(dtm, -4.72, 41.57)).toBeCloseTo(760, 4);
    expect(sampleGrid(dtm, -4.71, 41.575)).toBeNaN();
  });

  it('uses the DTM inside its footprint and blends into a flat base outside it', () => {
    const { meta, buffer } = grid();
    const terrain = buildTerrain([decodeDtm(meta, buffer)])!;
    expect(terrain.base).toBeCloseTo(755, 0);
    expect(terrainHeight(terrain, -4.725, 41.575)).toBeCloseTo(755, 4);
    // Just east of the edge: still the edge height (760 m); BLEND_M further: the base.
    expect(terrainHeight(terrain, -4.72 + 1 / metresPerDegLng, 41.575)).toBeCloseTo(760, 1);
    expect(terrainHeight(terrain, -4.72 + (BLEND_M + 10) / metresPerDegLng, 41.575)).toBeCloseTo(
      terrain.base,
      3,
    );
    // Halfway through the blend the height lies between both, with no step.
    const mid = terrainHeight(terrain, -4.72 + BLEND_M / 2 / metresPerDegLng, 41.575);
    expect(mid).toBeGreaterThan(terrain.base);
    expect(mid).toBeLessThan(760);
  });

  it('fades the base back to the ellipsoid far from the data', () => {
    const { meta, buffer } = grid();
    const terrain = buildTerrain([decodeDtm(meta, buffer)])!;
    const at = (m: number) => terrainHeight(terrain, -4.72 + m / metresPerDegLng, 41.575);
    expect(at(FAR_START_M - 1000)).toBeCloseTo(terrain.base, 3);
    const half = at((FAR_START_M + FAR_END_M) / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(terrain.base);
    expect(at(FAR_END_M + 1000)).toBe(0);
  });

  it('lets a neighbour win where a grid box has no data (the rotated UTM corner)', () => {
    const a = grid(-4.73, 41.57, [10]); // north-east node of A has no data
    const b = grid(-4.72, 41.57, [], 0); // flat neighbour to the east: 750 m
    const dtmA = decodeDtm(a.meta, a.buffer);
    // A's footprint stops short of its box's east edge, as a UTM square does in lng/lat.
    dtmA.footprint = [
      [-4.73, 41.57],
      [-4.7205, 41.57],
      [-4.7205, 41.58],
      [-4.73, 41.58],
    ];
    const terrain = buildTerrain([dtmA, decodeDtm(b.meta, b.buffer)])!;
    expect(insidePolygon(-4.7201, 41.5799, dtmA.footprint)).toBe(false);
    expect(terrainHeight(terrain, -4.72, 41.5799)).toBeCloseTo(750, 3);
    expect(terrainHeight(terrain, -4.725, 41.575)).toBeCloseTo(755, 3);
  });

  it('continues a rotated footprint smoothly across all its edges (no values from far along a row)', () => {
    // A UTM square seen in lng/lat is turned by the meridian convergence (about 1° here): turned
    // 4° to make the effect plain. Ground: a plane rising 2 cm per metre eastwards, 1 cm north.
    const width = 121,
      height = 121,
      west = -4.73,
      south = 41.57,
      span = 0.012;
    const lat0 = south + span / 2,
      lng0 = west + span / 2;
    const mLng = 111_132 * Math.cos((lat0 * Math.PI) / 180);
    const turn = (4 * Math.PI) / 180,
      half = 380;
    const toLngLat = (x: number, y: number): [number, number] => [
      lng0 + (x * Math.cos(turn) - y * Math.sin(turn)) / mLng,
      lat0 + (x * Math.sin(turn) + y * Math.cos(turn)) / 111_132,
    ];
    const plane = (lng: number, lat: number) =>
      750 + 0.02 * (lng - lng0) * mLng + 0.01 * (lat - lat0) * 111_132;
    const footprint = [
      toLngLat(-half, -half),
      toLngLat(half, -half),
      toLngLat(half, half),
      toLngLat(-half, half),
    ];
    const meta: DtmMeta = {
      ...grid().meta,
      width,
      height,
      west,
      south,
      east: west + span,
      north: south + span,
      offset: 700,
      cell_m: 8,
      footprint,
    };
    const buffer = new ArrayBuffer(width * height * 2);
    const view = new DataView(buffer);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const lng = west + (span * c) / (width - 1),
          lat = south + span - (span * r) / (height - 1);
        const inside = insidePolygon(lng, lat, footprint);
        view.setUint16(
          (r * width + c) * 2,
          inside ? Math.round((plane(lng, lat) - 700) / 0.01) : 65535,
          true,
        );
      }
    const dtm = decodeDtm(meta, buffer);
    expect(dtm.filled.every(Number.isFinite)).toBe(true);
    // Nothing to fill from: stays empty.
    expect(fillNearest(new Float32Array([NaN, NaN]), { ...meta, width: 2, height: 1 })).toEqual(
      new Float32Array([NaN, NaN]),
    );
    const terrain = buildTerrain([dtm])!;
    // Across each edge: 1 m inside against 1 m and 30 m outside, at 40 places per edge.
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ] as const;
    let worst = 0,
      worstFar = 0;
    for (let e = 0; e < 4; e++) {
      const [ax, ay] = corners[e]!,
        [bx, by] = corners[(e + 1) % 4]!;
      const length = Math.hypot(bx - ax, by - ay);
      const nx = (by - ay) / length,
        ny = -(bx - ax) / length; // outward normal of a counter-clockwise square
      for (let k = 1; k < 40; k++) {
        const x = ax + ((bx - ax) * k) / 40,
          y = ay + ((by - ay) * k) / 40;
        const at = (m: number) => terrainHeight(terrain, ...toLngLat(x + nx * m, y + ny * m));
        const edge = plane(...toLngLat(x, y));
        worst = Math.max(worst, Math.abs(at(1) - at(-1)), Math.abs(at(1) - edge));
        // 30 m out the blend towards the base has barely started (smoothstep of 30/BLEND_M).
        worstFar = Math.max(worstFar, Math.abs(at(30) - at(-1)));
      }
    }
    // With 8 m cells on a 2 cm/m slope the bilinear error alone is about 0.15 m. The old fill
    // along rows gave 1.0 m and 8.9 m here.
    expect(worst).toBeLessThan(0.3);
    expect(worstFar).toBeLessThan(0.5);
  });

  it('builds heightmap tiles north to south, sunk below the ground, and flat when far away', () => {
    const { meta, buffer } = grid();
    const terrain = buildTerrain([decodeDtm(meta, buffer)])!;
    const tile = tileHeights(terrain, { west: -4.73, south: 41.57, east: -4.72, north: 41.58 }, 3);
    expect(tile).toHaveLength(9);
    expect(tile[0]).toBeCloseTo(750 - TERRAIN_SINK_M, 3); // north-west
    expect(tile[2]).toBeCloseTo(760 - TERRAIN_SINK_M, 3); // north-east
    expect(tile[4]).toBeCloseTo(755 - TERRAIN_SINK_M, 3);
    const far = tileHeights(terrain, { west: 10, south: 50, east: 11, north: 51 }, 3);
    expect([...far].every((v) => v === 0)).toBe(true);
  });

  it('has no terrain without grids', () => {
    expect(buildTerrain([])).toBeUndefined();
  });
});
