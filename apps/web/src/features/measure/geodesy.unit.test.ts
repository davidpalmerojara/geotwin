import { describe, expect, it } from 'vitest';
import { Cartesian3 } from 'cesium';
import {
  distance3d,
  formatArea,
  formatHeight,
  formatLength,
  groundDistance,
  heightDifference,
  horizontalArea,
  measure,
  snapToGround,
} from './geodesy';

// Reference values computed independently with pyproj 3.7 (GeographicLib geodesics on WGS84:
// Geod(ellps='WGS84').inv / polygon_area_perimeter, and EPSG:4979 → EPSG:4978 for ECEF).
const p = (lng: number, lat: number, h = 0) => Cartesian3.fromDegrees(lng, lat, h);
const A = p(-4.7195, 41.5825, 752.3),
  B = p(-4.718, 41.5834, 760.05);

describe('Measurement maths', () => {
  it('ground distance matches GeographicLib to the millimetre', () => {
    expect(groundDistance([A, B])).toBeCloseTo(160.11814265660917, 3);
    // Valladolid centre → Laguna de Duero, 7.7 km.
    expect(groundDistance([p(-4.7245, 41.6523), p(-4.7191, 41.5829)])).toBeCloseTo(
      7721.099186700752,
      3,
    );
  });
  it('ground distance ignores height; the 3D distance does not', () => {
    expect(groundDistance([p(-4.7195, 41.5825, 0), p(-4.718, 41.5834, 900)])).toBeCloseTo(
      160.11814265660917,
      3,
    );
    // ECEF chord between the two points with their heights (pyproj + math.dist).
    expect(distance3d([A, B])).toBeCloseTo(160.32455058680705, 4);
  });
  it('adds polyline segments and skips repeated points', () => {
    const M = p(-4.71875, 41.58295, 756);
    expect(groundDistance([A, M, M, B])).toBeCloseTo(
      groundDistance([A, M]) + groundDistance([M, B]),
      6,
    );
    expect(distance3d([A])).toBe(0);
    expect(groundDistance([A])).toBe(0);
  });
  it('height difference is last minus first', () => {
    expect(heightDifference([A, B])).toBeCloseTo(7.75, 6);
    expect(heightDifference([B, A])).toBeCloseTo(-7.75, 6);
    expect(heightDifference([A])).toBe(0);
  });
  it('polygon area and perimeter match GeographicLib', () => {
    const polygon = [
      p(-4.72, 41.582),
      p(-4.7185, 41.5821),
      p(-4.7183, 41.5832),
      p(-4.7198, 41.5835),
    ];
    // Relative error below 1e-5 (0.2 m² of 18,246 m²).
    expect(horizontalArea(polygon)).toBeCloseTo(18245.575064003468, 0);
    expect(groundDistance(polygon, true)).toBeCloseTo(545.7587813645284, 3);
    // Same polygon picked at different heights: the horizontal area does not change.
    const raised = [
      p(-4.72, 41.582, 700),
      p(-4.7185, 41.5821, 712),
      p(-4.7183, 41.5832, 705),
      p(-4.7198, 41.5835, 731),
    ];
    expect(Math.abs(horizontalArea(raised) / 18245.575064003468 - 1)).toBeLessThan(1e-5);
  });
  it('a 1 x 1 km UTM 30N tile at Laguna de Duero', () => {
    // Corners of the EPSG:25830 square 356000-357000 E, 4604000-4605000 N.
    const tile = [
      p(-4.72727527667852, 41.574717885425045),
      p(-4.715285496530532, 41.5748974270354),
      p(-4.715523817225779, 41.58390071134253),
      p(-4.727515261213843, 41.58372111326973),
    ];
    expect(Math.abs(horizontalArea(tile) - 1000293.2377600521)).toBeLessThan(10);
    expect(groundDistance(tile, true)).toBeCloseTo(4000.58642433306, 2);
  });
  it('measure() reports what each tool needs', () => {
    expect(measure([A, B], 'distance')).toMatchObject({ points: 2, area: 0, perimeter: 0 });
    expect(measure([A, B], 'area').area).toBe(0);
  });
  it('formats metres with sensible precision in Spanish', () => {
    expect(formatLength(3.14159)).toBe('3,14 m');
    expect(formatLength(160.118)).toBe('160,1 m');
    expect(formatLength(7721.099)).toBe('7,721 km');
    expect(formatHeight(7.75)).toBe('+7,75 m');
    expect(formatHeight(-12.34)).toBe('−12,3 m');
    expect(formatHeight(0.001)).toBe('±0,00 m');
    expect(formatArea(42.123)).toBe('42,12 m²');
    expect(formatArea(1234.56)).toBe('1234,6 m²');
    expect(formatArea(18245.575)).toBe('18.246 m² (1,82 ha)');
    expect(formatArea(1000293.2)).toBe('1,000 km²');
  });
  it('moves picked points onto the ground model without moving them sideways', () => {
    // A point picked on a car roof 1.6 m up and one on the road, on ground rising 1 m per 0.001°.
    const ground = (lng: number) => 750 + (lng + 4.72) * 1000;
    const car = Cartesian3.fromDegrees(-4.72, 41.58, 751.6);
    const road = Cartesian3.fromDegrees(-4.719, 41.58, 751.02);
    const [a, b] = snapToGround([car, road], ground);
    expect(heightDifference([car, road])).toBeCloseTo(-0.58, 2);
    expect(heightDifference([a!, b!])).toBeCloseTo(1, 3);
    expect(groundDistance([a!, b!])).toBeCloseTo(groundDistance([car, road]), 6);
  });
});
