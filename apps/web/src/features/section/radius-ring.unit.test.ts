import { describe, expect, it } from 'vitest';
import { circle, labelSpot, radiusText } from './radius-ring';

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

  it('draws a closed circle of the given radius', () => {
    const ring = circle({ lng: -4.72191, lat: 41.58642 }, 300, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });
});
