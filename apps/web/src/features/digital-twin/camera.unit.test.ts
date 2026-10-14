import { describe, expect, it } from 'vitest';
import {
  flyOnOwn,
  type AutoFlight,
  type Pose,
  aimShift,
  coveredRight,
  distanceM,
  fitDistance,
  fitInView,
  frameOf,
  samePose,
} from './camera';
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
    // A network about 1.4 km across (Laguna de Duero) keeps at least 200 m around its edge.
    const laguna = [
      { lat: 41.589069, lng: -4.725258 },
      { lat: 41.586053, lng: -4.722179 },
      { lat: 41.584019, lng: -4.710608 },
    ];
    const small = frameOf(laguna)!;
    const reach = Math.max(...laguna.map((p) => distanceM(small.center, p)));
    expect(small.radius - reach).toBeCloseTo(Math.max(200, reach * 0.3), 6);
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

describe('Framing beside a floating panel', () => {
  const fov = Math.PI / 3;
  // Screen x (px) of a direction at tangent `t` right of the view axis on a `width` px canvas.
  const screenX = (t: number, width: number, height: number) => {
    const aspect = width / height;
    const tanX = aspect >= 1 ? Math.tan(fov / 2) : Math.tan(fov / 2) * aspect;
    return width / 2 + (t / tanX) * (width / 2);
  };
  // Horizontal screen extent of a sphere whose centre is `shift` m left of the view axis.
  const extent = (
    radius: number,
    distance: number,
    shift: number,
    width: number,
    height: number,
  ) => {
    const centre = Math.atan2(-shift, distance);
    const half = Math.asin(radius / Math.hypot(shift, distance));
    return {
      centre: screenX(Math.tan(centre), width, height),
      left: screenX(Math.tan(centre - half), width, height),
      right: screenX(Math.tan(centre + half), width, height),
    };
  };

  it('is the plain fit when nothing covers the map', () => {
    const view = fitInView(3000, fov, 1440, 900);
    expect(view.shift).toBe(0);
    expect(view.distance).toBeCloseTo(fitDistance(3000, fov, 1440 / 900), 6);
  });

  it('keeps the whole sphere in the visible part, centred in it (1280 x 900 desktop)', () => {
    // The map is about 700 x 580 px there and the open panel hides its right 318 px.
    const [width, height, covered] = [703, 580, 318];
    const view = fitInView(3000, fov, width, height, covered);
    expect(view.distance).toBeGreaterThan(fitDistance(3000, fov, width / height));
    const box = extent(3000, view.distance, view.shift, width, height);
    expect(box.centre).toBeCloseTo((width - covered) / 2, 6);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width - covered);
    // Without the correction the right of the sphere is under the panel (the reported bug).
    const naive = extent(3000, fitDistance(3000, fov, width / height), 0, width, height);
    expect(naive.right).toBeGreaterThan(width - covered);
  });

  it('works on a portrait canvas and never trusts more than half the map to a panel', () => {
    const view = fitInView(500, fov, 600, 800, 250);
    const box = extent(500, view.distance, view.shift, 600, 800);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(600 - 250);
    expect(fitInView(500, fov, 600, 800, 900)).toEqual(fitInView(500, fov, 600, 800, 300));
  });

  it('aims at the middle of the visible part for any camera distance', () => {
    const shift = aimShift(1000, fov, 800, 600, 200);
    expect(extent(10, 1000, shift, 800, 600).centre).toBeCloseTo(300, 6);
    expect(aimShift(1000, fov, 800, 600, 0)).toBe(0);
  });

  it('counts only tall panels that float over the right half', () => {
    const canvas = { left: 232, top: 176, right: 935, bottom: 756 };
    const open = { left: 617, top: 238, right: 917, bottom: 730 };
    const collapsed = { left: 617, top: 238, right: 917, bottom: 280 };
    const leftTool = { left: 302, top: 500, right: 564, bottom: 690 };
    expect(coveredRight(canvas, [open])).toBe(318);
    expect(coveredRight(canvas, [collapsed])).toBe(0);
    expect(coveredRight(canvas, [leftTool])).toBe(0);
    expect(coveredRight(canvas, [leftTool, open, collapsed])).toBe(318);
    expect(coveredRight(canvas, [])).toBe(0);
  });
  it('tells a camera the user has moved from one only lifted above the terrain', () => {
    const landed = [-0.0824, 0.7258, 0, -0.785];
    // Same place and orientation (height is not part of the pose): not moved.
    expect(samePose(landed, [...landed])).toBe(true);
    // Heading 0 and a full turn are the same orientation.
    expect(samePose(landed, [-0.0824, 0.7258, 2 * Math.PI - 1e-6, -0.785])).toBe(true);
    // Panned a few metres (1e-6 rad ≈ 6 m), turned or tilted: moved.
    expect(samePose(landed, [-0.0824 + 1e-6, 0.7258, 0, -0.785])).toBe(false);
    expect(samePose(landed, [-0.0824, 0.7258, 0.1, -0.785])).toBe(false);
    expect(samePose(landed, [-0.0824, 0.7258, 0, -0.6])).toBe(false);
  });
});

describe('Flights the viewer makes on its own', () => {
  // A stand-in viewer: the flights it was asked for, with their callbacks.
  const setup = () => {
    const flights: { complete: () => void; cancel: () => void }[] = [];
    const viewer = { pose: [0.1, 0.7, 0, -1] as Pose, isDestroyed: () => false };
    const last: { current: AutoFlight | null } = { current: null };
    const start = () =>
      flyOnOwn(
        last,
        viewer,
        (v) => [...v.pose] as Pose,
        (complete, cancel) => flights.push({ complete, cancel }),
      );
    return { flights, viewer, last, start };
  };
  it('remembers where a flight lands, to fly it again on new ground', () => {
    const { flights, last, start } = setup();
    start();
    expect(last.current?.state).toBe('flying');
    flights[0]!.complete();
    expect(last.current).toMatchObject({ state: 'landed', pose: [0.1, 0.7, 0, -1] });
    last.current!.redo();
    expect(flights).toHaveLength(2);
  });
  it('forgets a flight that another flight interrupts (Cesium calls only cancel)', () => {
    const { flights, last, start } = setup();
    start();
    flights[0]!.cancel(); // the user's «Ir» on a layer took over
    expect(last.current).toBeNull();
  });
  it('keeps the newer flight when the older one is cancelled by it', () => {
    const { flights, last, start } = setup();
    start();
    start(); // flown again on the real ground: Cesium cancels the first one
    const newer = last.current;
    flights[0]!.cancel();
    flights[0]!.complete();
    expect(last.current).toBe(newer);
    expect(newer?.state).toBe('flying');
  });
});
