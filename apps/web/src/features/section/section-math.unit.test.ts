import { describe, expect, it } from 'vitest';
import {
  buildingHeights,
  cutPlanes,
  cutRings,
  dtmAt,
  fade,
  fromLine,
  isClipped,
  makeLine,
  mergeSections,
  grouped,
  percentile,
  plotScale,
  profileCsv,
  sampleDtmLine,
  toLine,
  refineOnGround,
} from './section-math';

// The A–B line of the «Estación total» mockup over Torrelago (sheet 356-4606).
const A = { lng: -4.7231281, lat: 41.5901638 },
  B = { lng: -4.726941, lat: 41.5891789 };

describe('the A–B line', () => {
  it('has the length and true bearing the API gives (336,22 m, 251,0°)', () => {
    const line = makeLine(A, B);
    expect(line.length).toBeCloseTo(336.215, 1);
    expect(line.bearing).toBeCloseTo(251.0, 0);
  });

  it('goes to and from (s, d), with d positive on the left of A→B', () => {
    const line = makeLine(A, B);
    const p = fromLine(line, 120, 1.25);
    const back = toLine(line, p);
    expect(back.s).toBeCloseTo(120, 6);
    expect(back.d).toBeCloseTo(1.25, 6);
    // A→B heads west-south-west: its left is the south side.
    expect(fromLine(line, 100, 5).lat).toBeLessThan(fromLine(line, 100, 0).lat);
    expect(toLine(line, B).s).toBeCloseTo(line.length, 6);
  });
});

describe('the DTM along A–B', () => {
  it('is sampled every metre from A to B, with B last', () => {
    const line = makeLine(A, B);
    // A tilted plane: 700 m at A, rising 1 m every 100 m towards B.
    const ground = (lng: number, lat: number) => 700 + toLine(line, { lng, lat }).s / 100;
    const dtm = sampleDtmLine(line, ground);
    expect(dtm.s.length).toBe(338); // 0, 1, …, 336 and 336,2
    expect(dtm.s[1]).toBe(1);
    expect(dtm.s.at(-1)).toBeCloseTo(336.215, 1);
    expect(dtm.h[0]).toBeCloseTo(700, 6);
    expect(dtm.h[200]).toBeCloseTo(702, 6);
    expect(dtm.h.at(-1)).toBeCloseTo(703.362, 3);
    expect(dtmAt(dtm, 245.4)).toBeCloseTo(702.454, 3);
    expect(dtmAt(dtm, -1)).toBeNull();
  });

  it('keeps the gaps of the model (null); next to one, the sample with data counts', () => {
    const line = makeLine(A, B);
    const dtm = sampleDtmLine(line, (lng, lat) =>
      toLine(line, { lng, lat }).s > 100.5 && toLine(line, { lng, lat }).s < 103.5 ? null : 701,
    );
    expect(dtm.h.slice(100, 105)).toEqual([701, null, null, null, 701]);
    expect(dtmAt(dtm, 100.5)).toBe(701);
    expect(dtmAt(dtm, 101.5)).toBeNull();
  });
});

/** A section column set with points at (s, altitude, class). */
function section(points: [number, number, number][], n = 53.1) {
  return {
    s: points.map((p) => p[0]),
    d: points.map(() => 0.2),
    h: points.map((p) => p[1] + n),
    cls: points.map((p) => p[2]),
    rgb: points.map(() => 0x808080),
    geoid_offset_m: n,
  };
}

describe('building heights', () => {
  it('are the 95th percentile of class 6 minus the DTM, one per building', () => {
    const line = makeLine(A, B);
    const dtm = sampleDtmLine(line, () => 701.26);
    const tower: [number, number, number][] = [];
    // A tower from 235 to 258 m: walls from the ground up and a roof at 742,3 m with a few
    // antennas above it (the 5 % the percentile leaves out).
    for (let i = 0; i < 200; i++) tower.push([235 + (23 * i) / 199, 701.3 + (i % 40), 6]);
    for (let i = 0; i < 100; i++) tower.push([236 + (21 * i) / 99, 742.32, 6]);
    for (let i = 0; i < 6; i++) tower.push([240 + i, 748 + i, 6]);
    // A low block from 12 to 42 m, and trees and ground that do not count.
    const block: [number, number, number][] = [];
    for (let i = 0; i < 60; i++) block.push([12 + i / 2, 729.4, 6]);
    const other: [number, number, number][] = [
      [60, 708, 5],
      [61, 709, 5],
      [62, 701.2, 2],
      // A single class 6 point (a parked van misclassified) is not a building.
      [150, 703, 6],
    ];
    const points = mergeSections([section([...tower, ...other]), section(block, 53.12)]);
    const buildings = buildingHeights(points, dtm);
    expect(buildings.map((b) => b.label)).toEqual(['E1', 'E2']);
    const [low, high] = buildings;
    expect(low!.s0).toBeCloseTo(12, 6);
    expect(low!.s1).toBeCloseTo(41.5, 6);
    expect(low!.height).toBeCloseTo(729.4 - 701.26, 3);
    expect(high!.roof).toBeCloseTo(742.32, 2);
    expect(high!.height).toBeCloseTo(41.06, 2);
    expect(high!.s0).toBeCloseTo(235, 6);
    expect(high!.s1).toBeCloseTo(258, 6);
  });

  it('keep the two wings of a block together, split at a street', () => {
    const line = makeLine(A, B);
    const dtm = sampleDtmLine(line, () => 700);
    const wing = (from: number): [number, number, number][] =>
      Array.from({ length: 30 }, (_, i) => [from + i * 0.3, 738, 6]);
    // 88–97 m and 103–112 m: a 6 m patio between two wings; then a street of 30 m.
    const points = mergeSections([section([...wing(88), ...wing(103), ...wing(142)])]);
    expect(buildingHeights(points, dtm).map((b) => [b.label, b.s0, Math.round(b.s1)])).toEqual([
      ['E1', 88, 112],
      ['E2', 142, 151],
    ]);
  });

  it('use the nearest-rank percentile', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBeNaN();
  });
});

describe('merging and exporting', () => {
  it('groups counts by thousands, as the mockups do', () => {
    expect(grouped(8287)).toBe('8.287');
    expect(grouped(412)).toBe('412');
  });

  it('merges layers by s, as altitudes with each layer’s N', () => {
    const merged = mergeSections([section([[5, 700, 2]], 53), section([[2, 710, 6]], 54)]);
    expect([...merged.s]).toEqual([2, 5]);
    expect([...merged.z]).toEqual([710, 700]);
    expect([...merged.cls]).toEqual([6, 2]);
  });

  it('writes CSV with «;» and a decimal comma, the DTM under each point', () => {
    const line = makeLine(A, B);
    const dtm = sampleDtmLine(line, () => 701.3 + 53.1);
    const points = mergeSections([
      { ...section([[245.4, 742.4, 6]]), d: [-0.75], rgb: [0xd8c8b0] },
    ]);
    const ground = sampleDtmLine(line, () => 701.3);
    expect(dtm.h[0]).toBeCloseTo(754.4, 6);
    const csv = profileCsv(points, ground);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('distancia_m;desvio_m;cota_m;suelo_mdt_m;sobre_suelo_m;clase;color');
    expect(row).toBe('245,40;-0,75;742,40;701,30;41,10;6;#D8C8B0');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('the plot', () => {
  it('is 1:1: the line fills the width unless the heights would not fit', () => {
    // 336 m in 1100 px is 3,27 px/m; 58 m of height fit in 200 px at that scale.
    expect(plotScale(1100, 200, 336.2, 58)).toBeCloseTo(3.272, 3);
    // 120 m of height would not: both axes shrink together.
    expect(plotScale(1100, 200, 336.2, 120)).toBeCloseTo(200 / 120, 6);
  });

  it('fades points with their distance from the plane', () => {
    expect(fade(0, 1.5)).toBe(1);
    expect(fade(1.5, 1.5)).toBeCloseTo(0.3, 6);
    expect(fade(-0.75, 1.5)).toBeCloseTo(0.65, 6);
  });
});

describe('the cut', () => {
  const L = 336.2,
    half = 1.5,
    depth = 400;

  it('clips the box in front of the slab, on the camera side', () => {
    const { front, slab } = cutRings(L, half, 1, depth);
    expect(front).toEqual([
      [0, 1.5],
      [L, 1.5],
      [L, 400],
      [0, 400],
    ]);
    expect(slab).toEqual([
      [0, -1.5],
      [L, -1.5],
      [L, 1.5],
      [0, 1.5],
    ]);
    expect(cutRings(L, half, -1, depth).front[2]).toEqual([L, -400]);
  });

  it('gets the plane signs right for the WebGL 1 fallback', () => {
    for (const side of [1, -1] as const) {
      const front = cutPlanes('front', L, half, side, depth);
      // In front of the line (camera side), anywhere up: clipped.
      expect(isClipped(front, [100, side * 20, 30])).toBe(true);
      expect(isClipped(front, [100, side * 399, -5])).toBe(true);
      // The slab itself, behind it, beyond A or B, or too far: kept.
      expect(isClipped(front, [100, side * 1.4, 30])).toBe(false);
      expect(isClipped(front, [100, -side * 20, 30])).toBe(false);
      expect(isClipped(front, [-5, side * 20, 30])).toBe(false);
      expect(isClipped(front, [L + 5, side * 20, 30])).toBe(false);
      expect(isClipped(front, [100, side * 401, 30])).toBe(false);
    }
    const hide = cutPlanes('hide', L, half, 1, depth);
    expect(isClipped(hide, [100, 0.5, 40])).toBe(false);
    expect(isClipped(hide, [100, -1.4, 0])).toBe(false);
    expect(isClipped(hide, [100, 2, 0])).toBe(true);
    expect(isClipped(hide, [100, -2, 0])).toBe(true);
    expect(isClipped(hide, [-1, 0, 0])).toBe(true);
    expect(isClipped(hide, [L + 1, 0, 0])).toBe(true);
  });
});

describe('refineOnGround', () => {
  // A ray going down at 30° over a ground that rises 1 m every 10 m along it.
  const ray = (t: number) => ({ along: t * Math.cos(Math.PI / 6), height: 300 - t * 0.5 });
  const ground = (along: number) => 700 - 400 + along * 0.1;
  const gap = (t: number) => ray(t).height - ground(ray(t).along);
  it("moves the globe's hit onto the bilinear ground model", () => {
    // The drawn terrain (a coarser tile) put the hit 8 m short of the model's surface.
    let truth = 0;
    for (let lo = 0, hi = 2000, i = 0; i < 80; i++) {
      truth = (lo + hi) / 2;
      if (gap(truth) > 0) lo = truth;
      else hi = truth;
    }
    const t = refineOnGround(gap, truth - 8);
    expect(Math.abs(gap(t))).toBeLessThanOrEqual(0.05);
    expect(t).toBeCloseTo(truth, 1);
  });
  it('keeps the hit when it is already on the ground or the steps do not settle', () => {
    expect(refineOnGround(() => 0.01, 420)).toBe(420);
    expect(refineOnGround(() => Number.NaN, 420)).toBe(420);
    // Flat gap (a ray along the ground): no slope to follow.
    expect(refineOnGround(() => 3, 420)).toBe(420);
    // A step that would move the point further than allowed.
    expect(refineOnGround((t) => (t - 900) * 0.01, 420)).toBe(420);
  });
});
