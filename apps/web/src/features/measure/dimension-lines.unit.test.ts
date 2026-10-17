import { describe, expect, it } from 'vitest';
import {
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from 'cesium';
import { measureDimensions, mountDimension, mountText } from './dimension-lines';

// Torrelago: the foot and the roof of the south tower, and a point 100 m east of the foot.
const lng = -4.72565,
  lat = 41.58786;
const foot = Cartesian3.fromDegrees(lng, lat, 750);
const roof = Cartesian3.fromDegrees(lng, lat, 791.7);
// Exact offsets in the local east-north-up frame of the foot.
const enu = Transforms.eastNorthUpToFixedFrame(foot);
const local = (e: number, n: number, u: number) =>
  Matrix4.multiplyByPoint(enu, new Cartesian3(e, n, u), new Cartesian3());
const east = local(100, 0, 0);
const north = local(0, 100, 10);
const carto = (p: Cartesian3) => Cartographic.fromCartesian(p);

describe('distance dimensions', () => {
  it('draw the line through the points with a tick at each one', () => {
    const [d] = measureDimensions([foot, east], 'distance');
    expect(d!.kind).toBe('distance');
    expect(d!.line).toEqual([foot, east]);
    expect(d!.ticks.map((t) => t.at)).toEqual([foot, east]);
    // Ticks cut across the line: their axis is the line's direction.
    const along = Cartesian3.normalize(
      Cartesian3.subtract(east, foot, new Cartesian3()),
      new Cartesian3(),
    );
    expect(Cartesian3.dot(d!.ticks[0]!.along, along)).toBeCloseTo(1, 9);
  });
  it('put each segment length at its middle and the total at the last point', () => {
    const [d] = measureDimensions([foot, east, north], 'distance');
    expect(d!.labels).toHaveLength(3);
    const [first, second, total] = d!.labels;
    expect(
      Cartesian3.distance(first!.at, Cartesian3.midpoint(foot, east, new Cartesian3())),
    ).toBeLessThan(1e-6);
    expect(first!.text).toMatch(/^100,0 m$/);
    expect(second!.text).toMatch(/^\d{3},\d m$/);
    expect(total!.text).toMatch(/^total \d{3},\d m$/);
    expect(total!.at).toBe(north);
    expect(d!.labels.every((l) => !/\d\.\d/.test(l.text))).toBe(true);
  });
  it('a single segment shows its length once', () => {
    const [d] = measureDimensions([foot, east], 'distance');
    expect(d!.labels.map((l) => l.text)).toEqual(['100,0 m']);
  });
  it('add the height difference as a vertical dimension at the higher point', () => {
    const dims = measureDimensions([foot, north], 'distance');
    const height = dims.find((d) => d.kind === 'height')!;
    expect(height.labels[0]!.text).toBe('desnivel +10,0 m');
    expect(height.labels[0]!.side).toBe('right');
    const [bottom, top] = height.line;
    expect(carto(top!).height).toBeCloseTo(760, 2);
    expect(carto(bottom!).height).toBeCloseTo(750, 6);
    expect(CesiumMath.toDegrees(carto(bottom!).latitude)).toBeCloseTo(
      CesiumMath.toDegrees(carto(north).latitude),
      9,
    );
    // Downhill the sign changes and the dimension stays at the higher point.
    const down = measureDimensions([north, foot], 'distance').find((d) => d.kind === 'height')!;
    expect(down.labels[0]!.text).toBe('desnivel −10,0 m');
    expect(carto(down.line[1]!).height).toBeCloseTo(760, 2);
  });
  it('skip a height difference under a metre', () => {
    const flat = local(100, 0, 0.6);
    expect(measureDimensions([foot, flat], 'distance').map((d) => d.kind)).toEqual(['distance']);
  });
  it('skip the vertical dimension when the line already is one (the tower)', () => {
    const dims = measureDimensions([foot, roof], 'distance');
    expect(dims.map((d) => d.kind)).toEqual(['distance']);
    expect(dims[0]!.labels[0]!.text).toBe('41,7 m');
  });
  it('draw nothing before the second point', () => {
    expect(measureDimensions([foot], 'distance')).toEqual([]);
    expect(measureDimensions([], 'area')).toEqual([]);
  });
});

describe('area dimensions', () => {
  it('close the outline and put the horizontal area at the centroid', () => {
    const [d] = measureDimensions([foot, east, north], 'area');
    expect(d!.kind).toBe('area');
    expect(d!.line).toEqual([foot, east, north, foot]);
    expect(d!.labels).toHaveLength(1);
    // Half of 100 × 100 m, brought down to the ellipsoid from 750 m up (−0,02 %).
    expect(d!.labels[0]!.text).toBe('4998,8 m²');
    const centroid = carto(d!.labels[0]!.at);
    expect(CesiumMath.toDegrees(centroid.latitude)).toBeGreaterThan(lat);
    expect(CesiumMath.toDegrees(centroid.longitude)).toBeGreaterThan(lng);
  });
  it('show no area with two points', () => {
    const [d] = measureDimensions([foot, east], 'area');
    expect(d!.labels).toEqual([]);
  });
});

describe('mounting height', () => {
  it('runs from the ground model straight up to the mark, with its value to the left', () => {
    const d = mountDimension(lng, lat, 699.2 + 51.3, 41.9);
    expect(d.kind).toBe('mount');
    expect(carto(d.line[0]!).height).toBeCloseTo(750.5, 6);
    expect(carto(d.line[1]!).height).toBeCloseTo(792.4, 6);
    expect(d.labels[0]!.text).toBe('41,9 m sobre el suelo');
    expect(d.labels[0]!.side).toBe('left');
    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(d.line[0]!, new Cartesian3());
    expect(Cartesian3.dot(d.ticks[0]!.along, normal)).toBeCloseTo(1, 9);
    expect(mountText(41.94)).toBe('41,9 m sobre el suelo');
  });
});
