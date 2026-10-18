import { describe, expect, it } from 'vitest';
import { circle, labelSpot, radiusText, segmentHitsBox } from './radius-ring';

const view = { width: 1440, height: 900 },
  label = { width: 200, height: 24 };

describe('the radius label', () => {
  it('says the radius and the count, in metres or kilometres', () => {
    expect(radiusText(300, 5)).toBe('r = 300 m · 5 activos dentro');
    expect(radiusText(5000, 1)).toBe('r = 5 km · 1 activo dentro');
  });

  it('goes to the lowest point of the ring that is on screen and clear of the plates', () => {
    const points = [
      { x: 700, y: 200 },
      { x: 300, y: 600 },
      { x: 1100, y: 700 }, // under the card
      null, // behind the camera
      { x: 700, y: 950 }, // below the view
    ];
    const card = { left: 1000, right: 1400, top: 100, bottom: 800 };
    expect(labelSpot(points, label, view, [card])).toBe(1);
    // Without the card the lower point wins.
    expect(labelSpot(points, label, view, [])).toBe(2);
  });

  it('falls back to the lowest point on screen when every one is under a plate', () => {
    const points = [
      { x: 300, y: 300 },
      { x: 300, y: 500 },
    ];
    const plate = { left: 0, right: 1440, top: 0, bottom: 900 };
    expect(labelSpot(points, label, view, [plate])).toBe(1);
    expect(labelSpot([null, { x: -50, y: 300 }], label, view, [])).toBe(-1);
  });

  it('keeps clear of the ring itself where the ring runs steeply on screen', () => {
    // A ring seen from the south: an ellipse on screen, wide and flat at its top and bottom,
    // steep at its sides. Its bottom is under the bottom plates; of the rest, a point on the
    // steep right side is the lowest, but a box centred above it is crossed by the dashes, so
    // the label goes to the flat top.
    const ellipse = (t: number) => ({ x: 700 + 600 * Math.sin(t), y: 500 + 120 * Math.cos(t) });
    const path = Array.from({ length: 145 }, (_, i) => ellipse((i / 144) * 2 * Math.PI));
    const above = (t: number) => ({ x: ellipse(t).x, y: ellipse(t).y - 18 });
    const points = [above(0), above(1.3), above(Math.PI)];
    const bottom = { left: 0, right: 1440, top: 580, bottom: 900 };
    expect(labelSpot(points, label, view, [bottom], 8, [])).toBe(1);
    expect(labelSpot(points, label, view, [bottom], 8, path)).toBe(2);
    // When every spot clear of the plates is crossed, the plates still come first.
    expect(labelSpot([above(0), above(1.3)], label, view, [bottom], 8, path)).toBe(1);
  });

  it('tells whether a segment crosses a box', () => {
    const box = { left: 0, right: 10, top: 0, bottom: 10 };
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
    expect(segmentHitsBox({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 2, y: 2 }, { x: 3, y: 3 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 11, y: 0 }, { x: 11, y: 10 }, box)).toBe(false);
  });

  it('draws a closed circle of the given radius', () => {
    const ring = circle({ lng: -4.72191, lat: 41.58642 }, 300, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });
});
