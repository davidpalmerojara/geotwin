import { describe, expect, it } from 'vitest';
import { distanceM, fitDistance, frameOf } from './camera';
const pisuerga = { lat: 41.655, lng: -4.737 };
const sanCristobal = { lat: 41.62, lng: -4.706 };
const campus = { lat: 41.663, lng: -4.713 };
describe('Camera framing', () => {
  it('measures metres on the ellipsoid scale', () => {
    // 0.001° of latitude is ~111 m everywhere.
    expect(distanceM({ lat: 41, lng: -4 }, { lat: 41.001, lng: -4 })).toBeCloseTo(111.2, 0);
    expect(distanceM(pisuerga, pisuerga)).toBe(0);
  });
  it('contains every point plus padding', () => {
    const frame = frameOf([pisuerga, sanCristobal, campus], 250)!;
    for (const p of [pisuerga, sanCristobal, campus])
      expect(distanceM(frame.center, p)).toBeLessThanOrEqual(frame.radius - 250 + 1e-6);
    expect(frame.radius).toBeGreaterThan(2500);
    expect(frame.radius).toBeLessThan(3500);
  });
  it('keeps a minimum radius for a single point and nothing for no points', () => {
    expect(frameOf([pisuerga])).toEqual({ center: pisuerga, radius: 300 });
    expect(frameOf([])).toBeUndefined();
  });
  it('pads the whole network for its labels and frames one installation closely', () => {
    const network = frameOf([pisuerga, sanCristobal, campus])!;
    const spread = Math.max(
      ...[pisuerga, sanCristobal, campus].map((p) => distanceM(network.center, p)),
    );
    expect(network.radius - spread).toBeCloseTo(450, 6);
    // Six assets about 60 m around an installation centre.
    const site = [0, 1, 2, 3, 4, 5].map((i) => ({
      lat: pisuerga.lat + 0.0005 * Math.cos(i),
      lng: pisuerga.lng + 0.0007 * Math.sin(i),
    }));
    const installation = frameOf([...site, pisuerga])!;
    expect(installation.radius).toBe(300);
    expect(installation.radius).toBeLessThan(network.radius / 5);
  });
  it('backs off further on a portrait phone than on a landscape desktop', () => {
    const fov = Math.PI / 3;
    const desktop = fitDistance(3000, fov, 1440 / 900);
    const phone = fitDistance(3000, fov, 390 / 844);
    expect(phone).toBeGreaterThan(desktop * 1.25);
    // The sphere fits the narrow axis: radius / sin(halfAngle) with the margin.
    expect(fitDistance(1000, Math.PI / 2, 1, 1)).toBeCloseTo(1000 / Math.sin(Math.PI / 4), 6);
  });
});
