import { describe, expect, it } from 'vitest';
import { toUtm, utmZone } from './utm';

// Reference values from pyproj 3.8 (EPSG:4258 → EPSG:25830), not from this code.
const corners: [number, number, number, number][] = [
  // Sheet 356-4605 of the PNOA-LiDAR: X 356 000–357 000, Y 4 604 000–4 605 000.
  [-4.72727527667852, 41.574717885425045, 356000, 4604000],
  [-4.715285496530532, 41.5748974270354, 357000, 4604000],
  [-4.727515261213843, 41.58372111326973, 356000, 4605000],
  [-4.715523817225779, 41.58390071134253, 357000, 4605000],
];

describe('UTM 30N', () => {
  it('matches pyproj at the four corners of sheet 356-4605 to the millimetre', () => {
    for (const [lng, lat, x, y] of corners) {
      const utm = toUtm(lng, lat);
      expect(Math.abs(utm.easting - x)).toBeLessThan(0.001);
      expect(Math.abs(utm.northing - y)).toBeLessThan(0.001);
    }
  });
  it('matches pyproj at Torrelago', () => {
    const utm = toUtm(-4.7252, 41.589);
    expect(Math.abs(utm.easting - 356204.7167985559)).toBeLessThan(0.001);
    expect(Math.abs(utm.northing - 4605582.237683196)).toBeLessThan(0.001);
    expect(utm.zone).toBe(30);
  });
  it('picks the zone of a longitude', () => {
    expect(utmZone(-4.72)).toBe(30);
    expect(utmZone(-6.1)).toBe(29);
    expect(utmZone(2.2)).toBe(31);
  });
});
