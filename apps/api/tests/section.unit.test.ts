import { describe, expect, it } from 'vitest';
import {
  ecefToGeodetic,
  geodeticToEcef,
  IDENTITY,
  makeSlab,
  multiply,
  parsePnts,
  SectionCache,
  slabCoords,
  slabFromQuery,
  volumeMayCrossSlab,
  type Mat4,
} from '../src/modules/layers/section.js';

// The A–B line of the «Estación total» mockup over Torrelago (sheet 356-4606).
const A: [number, number] = [-4.7231281, 41.5901638];
const B: [number, number] = [-4.726941, 41.5891789];

function pnts(feature: object, featureBin: Buffer, batch: object | null, batchBin: Buffer) {
  const json = (value: object, from: number) => {
    let text = JSON.stringify(value);
    while ((from + text.length) % 8) text += ' ';
    return Buffer.from(text);
  };
  const ft = json(feature, 28);
  const bt = batch ? json(batch, 28 + ft.length + featureBin.length) : Buffer.alloc(0);
  const header = Buffer.alloc(28);
  header.write('pnts', 0, 'latin1');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28 + ft.length + featureBin.length + bt.length + batchBin.length, 8);
  header.writeUInt32LE(ft.length, 12);
  header.writeUInt32LE(featureBin.length, 16);
  header.writeUInt32LE(bt.length, 20);
  header.writeUInt32LE(batchBin.length, 24);
  return Buffer.concat([header, ft, featureBin, bt, batchBin]);
}

describe('section geometry', () => {
  it('round-trips geodetic and ECEF coordinates to the millimetre', () => {
    const [x, y, z] = geodeticToEcef(A[0], A[1], 752.4);
    const back = ecefToGeodetic(x, y, z);
    expect((back.lon * 180) / Math.PI).toBeCloseTo(A[0], 9);
    expect((back.lat * 180) / Math.PI).toBeCloseTo(A[1], 9);
    expect(back.h).toBeCloseTo(752.4, 3);
  });

  it('measures A–B on the ellipsoid and gives its true bearing', () => {
    const slab = makeSlab(A, B, 1.5);
    // 336,22 m (the UTM grid distance is 336,17 m; scale factor 0,99985 there).
    expect(slab.length).toBeCloseTo(336.215, 2);
    // Grid bearing 252,2° minus the meridian convergence (about 1,1° at 4,7° W).
    expect(slab.bearing).toBeCloseTo(251.0, 0);
  });

  it('puts s along A→B and d positive to the left, whatever the height', () => {
    const slab = makeSlab(A, B, 1.5);
    const atA = slabCoords(slab, ...geodeticToEcef(A[0], A[1], 0));
    expect(atA.s).toBeCloseTo(0, 3);
    expect(atA.d).toBeCloseTo(0, 3);
    const atB = slabCoords(slab, ...geodeticToEcef(B[0], B[1], 750));
    expect(atB.s).toBeCloseTo(slab.length, 3);
    expect(atB.h).toBeCloseTo(750, 3);
    // A→B heads west-south-west: north of the line is on its right, so d < 0.
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] as const;
    const north = slabCoords(slab, ...geodeticToEcef(mid[0], mid[1] + 1 / 111_000, 700));
    expect(north.d).toBeLessThan(-0.9);
    const south = slabCoords(slab, ...geodeticToEcef(mid[0], mid[1] - 1 / 111_000, 700));
    expect(south.d).toBeGreaterThan(0.9);
    // Two metres apart on the ground, two metres apart in the plane.
    expect(Math.hypot(north.s - south.s, north.d - south.d)).toBeCloseTo(2, 2);
  });

  it('rejects bad points, A on top of B and lines over 2 km', () => {
    expect(() => slabFromQuery({ a: '-4.72,41.58', b: '-4.72,41.58', half: 1.5 })).toThrow(
      /menos de 1 m/,
    );
    expect(() => slabFromQuery({ a: '-4.70,41.58', b: '-4.73,41.58', half: 1.5 })).toThrow(
      /2,50 km; el máximo es 2 km/,
    );
    expect(() => slabFromQuery({ a: '-190,41.58', b: '-4.73,41.58', half: 1.5 })).toThrow(
      /lon,lat/,
    );
    expect(slabFromQuery({ a: ` ${A.join(', ')}`, b: B.join(','), half: 2 }).half).toBe(2);
  });

  it('keeps tiles whose box may cross the slab and drops the far ones', () => {
    const slab = makeSlab(A, B, 1.5);
    const [x, y, z] = geodeticToEcef((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 720);
    const at = (dx: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x + dx, y, z, 1];
    const box = { box: [0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5] };
    expect(volumeMayCrossSlab(box, at(0), slab)).toBe(true);
    expect(volumeMayCrossSlab(box, at(400), slab)).toBe(false);
    expect(volumeMayCrossSlab({ sphere: [0, 0, 0, 8] }, at(0), slab)).toBe(true);
    expect(volumeMayCrossSlab({ sphere: [0, 0, 0, 8] }, at(400), slab)).toBe(false);
    // A scaled child transform (py3dtiles writes one) scales its box too.
    const scaled = multiply(at(0), [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1]);
    expect(
      volumeMayCrossSlab({ box: [3, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1] }, scaled, slab),
    ).toBe(volumeMayCrossSlab(box, at(300), slab));
    expect(multiply(IDENTITY, at(5))).toEqual(at(5));
  });
});

describe('pnts reader', () => {
  it('reads float positions, RGB and the per-point class of py3dtiles tiles', () => {
    const positions = Buffer.alloc(24);
    [1, 2, 3, -4, 5.5, 6].forEach((v, i) => positions.writeFloatLE(v, i * 4));
    const rgb = Buffer.from([255, 0, 0, 0, 128, 255]);
    const bin = Buffer.concat([positions, rgb, Buffer.alloc(2)]);
    const tile = parsePnts(
      pnts(
        {
          POINTS_LENGTH: 2,
          POSITION: { byteOffset: 0 },
          RGB: { byteOffset: 24 },
          RTC_CENTER: [10, 20, 30],
        },
        bin,
        { classification: { byteOffset: 0, componentType: 'UNSIGNED_BYTE', type: 'SCALAR' } },
        Buffer.from([6, 2, 0, 0, 0, 0, 0, 0]),
      ),
    );
    expect(tile.count).toBe(2);
    expect(tile.position(0)).toEqual([11, 22, 33]);
    expect(tile.position(1)).toEqual([6, 25.5, 36]);
    expect(tile.rgb(0)).toBe(0xff0000);
    expect(tile.rgb(1)).toBe(0x0080ff);
    expect(tile.classification(0)).toBe(6);
    expect(tile.classification(1)).toBe(2);
  });

  it('dequantises POSITION_QUANTIZED and follows BATCH_ID to the class', () => {
    const q = Buffer.alloc(12);
    [0, 0, 0, 65535, 32768, 65535].forEach((v, i) => q.writeUInt16LE(v, i * 2));
    const batchIds = Buffer.from([1, 0]);
    const tile = parsePnts(
      pnts(
        {
          POINTS_LENGTH: 2,
          POSITION_QUANTIZED: { byteOffset: 0 },
          QUANTIZED_VOLUME_OFFSET: [100, 200, 300],
          QUANTIZED_VOLUME_SCALE: [10, 10, 10],
          BATCH_ID: { byteOffset: 12, componentType: 'UNSIGNED_BYTE' },
          BATCH_LENGTH: 2,
          CONSTANT_RGBA: [10, 20, 30, 255],
        },
        Buffer.concat([q, batchIds, Buffer.alloc(2)]),
        { classification: [5, 9] },
        Buffer.alloc(0),
      ),
    );
    expect(tile.position(0)).toEqual([100, 200, 300]);
    expect(tile.position(1)[0]).toBeCloseTo(110, 6);
    expect(tile.position(1)[1]).toBeCloseTo(205, 3);
    expect(tile.classification(0)).toBe(9);
    expect(tile.classification(1)).toBe(5);
    expect(tile.rgb(1)).toBe(0x0a141e);
  });

  it('refuses something that is not a point-cloud tile', () => {
    expect(() => parsePnts(Buffer.from('b3dm and more bytes than the header...'))).toThrow(/pnts/);
  });
});

describe('section cache', () => {
  const section = (count: number) => ({
    layer_id: '00000000-0000-4000-8000-000000000001',
    a: A,
    b: B,
    half_m: 1.5,
    length_m: 336.22,
    bearing_deg: 251,
    geoid_offset_m: 53.1,
    count,
    s: [],
    d: [],
    h: [],
    cls: [],
    rgb: [],
  });

  it('builds once per key, shares a running build and evicts the oldest', async () => {
    const cache = new SectionCache(2, 100);
    let builds = 0;
    const build = (n: number) => async () => {
      builds++;
      return section(n);
    };
    const [one, same] = await Promise.all([cache.get('a', build(1)), cache.get('a', build(1))]);
    expect(one).toBe(same);
    expect(builds).toBe(1);
    expect(one.etag).toMatch(/^"[0-9a-f]{24}"$/);
    await cache.get('b', build(1));
    await cache.get('a', build(1)); // touch a: b is now the oldest
    await cache.get('c', build(1));
    expect(cache.size).toBe(2);
    await cache.get('a', build(1));
    expect(builds).toBe(3);
    await cache.get('b', build(1));
    expect(builds).toBe(4);
    // Bounded by points too.
    await cache.get('big', build(150));
    expect(cache.size).toBe(1);
  });
});
