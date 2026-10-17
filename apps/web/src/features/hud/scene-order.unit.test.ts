import { describe, expect, it } from 'vitest';
import { screenOrder } from './scene-order';

describe('scene assets in screen order', () => {
  it('read top to bottom in 48 px rows, then left to right', () => {
    const points = [
      { item: 'bottom', at: { x: 10, y: 700 } },
      { item: 'top-right', at: { x: 900, y: 100 } },
      { item: 'top-left', at: { x: 50, y: 120 } },
      { item: 'middle', at: { x: 400, y: 400 } },
    ];
    expect(screenOrder(points, 1440, 900)).toEqual(['top-left', 'top-right', 'middle', 'bottom']);
  });
  it('leave out what is off screen or behind the camera', () => {
    const points = [
      { item: 'left', at: { x: -5, y: 100 } },
      { item: 'below', at: { x: 100, y: 901 } },
      { item: 'behind', at: null },
      { item: 'in', at: { x: 100, y: 100 } },
    ];
    expect(screenOrder(points, 1440, 900)).toEqual(['in']);
  });
});
