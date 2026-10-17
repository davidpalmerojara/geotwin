import { describe, expect, it } from 'vitest';
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from 'cesium';
import { BEAM_LENGTH_M, BEAM_WIDTH_PX, beamPositions, pulsePhase } from './alert-beams';

// The level probe on the lake of Laguna de Duero, at the water's ellipsoidal height.
const anchor = Cartesian3.fromDegrees(-4.72191, 41.58642, 750.5);

describe('alert beams', () => {
  it('rise along the geodetic normal from the anchor', () => {
    const [start, end] = beamPositions(anchor, 'critical');
    expect(Cartesian3.equals(start, anchor)).toBe(true);
    const direction = Cartesian3.normalize(
      Cartesian3.subtract(end, start, new Cartesian3()),
      new Cartesian3(),
    );
    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new Cartesian3());
    expect(Cartesian3.dot(direction, normal)).toBeCloseTo(1, 12);
    // Straight up: the top has the same latitude and longitude (to 0,1 mm), 250 m higher.
    const top = Cartographic.fromCartesian(end);
    expect(CesiumMath.toDegrees(top.longitude)).toBeCloseTo(-4.72191, 8);
    expect(CesiumMath.toDegrees(top.latitude)).toBeCloseTo(41.58642, 8);
    expect(top.height).toBeCloseTo(750.5 + 250, 6);
  });
  it('are 250 m long for a critical alert and 60 m for a warning', () => {
    for (const level of ['critical', 'warning'] as const) {
      const [start, end] = beamPositions(anchor, level);
      expect(Cartesian3.distance(start, end)).toBeCloseTo(BEAM_LENGTH_M[level], 6);
    }
    expect(BEAM_LENGTH_M).toEqual({ critical: 250, warning: 60 });
    for (const width of Object.values(BEAM_WIDTH_PX)) {
      expect(width).toBeGreaterThanOrEqual(10);
      expect(width).toBeLessThanOrEqual(14);
    }
  });
  it('pulse with a phase that wraps every 1,6 s', () => {
    expect(pulsePhase(0)).toBe(0);
    expect(pulsePhase(800)).toBeCloseTo(0.5);
    expect(pulsePhase(1600 + 400)).toBeCloseTo(0.25);
  });
});
