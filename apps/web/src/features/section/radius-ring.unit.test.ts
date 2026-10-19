import { describe, expect, it } from 'vitest';
import { circle, labelSpot, radiusText, segmentHitsBox } from './radius-ring';
import {
  DISTANCE_OFFSET,
  RING_LABEL_LIFT,
  distanceLabelBox,
  distanceSide,
  ringAnchorOffset,
  ringLabelBox,
  ringLabelSize,
} from './radius-label';

const view = { width: 1440, height: 900 },
  text = 'r = 300 m · 7 activos dentro';
type Pt = { x: number; y: number };
/** Whether the ring (a polyline on screen) runs through a box. */
const crosses = (path: Pt[], box: { left: number; right: number; top: number; bottom: number }) =>
  path.some((p, i) => i + 1 < path.length && segmentHitsBox(p, path[i + 1]!, box));

describe('the radius label', () => {
  it('says the radius and the count, in metres or kilometres', () => {
    expect(radiusText(300, 5)).toBe('r = 300 m · 5 activos dentro');
    expect(radiusText(5000, 1)).toBe('r = 5 km · 1 activo dentro');
  });

  it('goes to the lowest point of the ring that is on screen and clear of the plates', () => {
    const points = [
      { x: 700, y: 230 },
      { x: 300, y: 630 },
      { x: 1100, y: 730 }, // under the card
      null, // behind the camera
      { x: 700, y: 980 }, // below the view
    ];
    const card = { left: 1000, right: 1400, top: 100, bottom: 800 };
    expect(labelSpot(points, text, view, [card])).toEqual({ index: 1, anchor: 'above' });
    // Without the card the lower point wins.
    expect(labelSpot(points, text, view, [])).toEqual({ index: 2, anchor: 'above' });
  });

  it('has a box against its point on the ring, the size the spot is chosen for', () => {
    const box = ringLabelBox({ x: 400, y: 500 }, text);
    expect(box.bottom).toBe(500 - RING_LABEL_LIFT);
    expect(box.right - box.left).toBe(ringLabelSize(text).width);
    expect(box.bottom - box.top).toBe(ringLabelSize(text).height);
    expect((box.left + box.right) / 2).toBe(400);
    // Wide enough for its 28 characters of 12 px mono.
    expect(box.right - box.left).toBeGreaterThanOrEqual(28 * 7.2);
    // Below the point and off its corners: the same size, never over the point itself.
    const below = ringLabelBox({ x: 400, y: 500 }, text, 'below');
    expect(below.top).toBe(500 + RING_LABEL_LIFT);
    const corner = ringLabelBox({ x: 400, y: 500 }, text, 'above-right');
    expect([corner.left, corner.bottom]).toEqual([400 + RING_LABEL_LIFT, 500 - RING_LABEL_LIFT]);
    const other = ringLabelBox({ x: 400, y: 500 }, text, 'below-left');
    expect([other.right, other.top]).toEqual([400 - RING_LABEL_LIFT, 500 + RING_LABEL_LIFT]);
    // Cesium draws it with the matching origin and offset.
    expect(ringAnchorOffset('above')).toEqual({
      horizontal: 'center',
      vertical: 'bottom',
      x: 0,
      y: -RING_LABEL_LIFT,
    });
    expect(ringAnchorOffset('below-left')).toMatchObject({ horizontal: 'right', vertical: 'top' });
  });

  it('is left out when every spot is under a plate, or no point is on screen', () => {
    const points = [
      { x: 300, y: 330 },
      { x: 300, y: 530 },
    ];
    // The Radio panel over the only part of the ring in view (radio-sonda-500-1280): the label
    // would sit under it, or half out of its edge.
    const plate = { left: 0, right: 1440, top: 0, bottom: 900 };
    expect(labelSpot(points, text, view, [plate])).toBeNull();
    const panel = { left: 12, right: 341, top: 104, bottom: 543 };
    const inPanel = [{ x: 170, y: 160 }];
    expect(labelSpot(inPanel, text, view, [panel])).toBeNull();
    // With room beside the panel it shows there, clear of it.
    const spot = labelSpot([...inPanel, { x: 520, y: 300 }], text, view, [panel]);
    expect(spot?.index).toBe(1);
    expect(labelSpot([null, { x: -150, y: 300 }], text, view, [])).toBeNull();
  });

  it('keeps clear of the ring itself where the ring runs steeply on screen', () => {
    // A ring seen from the south: an ellipse on screen, wide and flat at its top and bottom,
    // steep at its sides. Its bottom is under the bottom plates; centred above a point of the steep
    // right side the box would be crossed by the dashes, so it goes where they do not cross it.
    const ellipse = (t: number) => ({ x: 700 + 600 * Math.sin(t), y: 500 + 120 * Math.cos(t) });
    const path = Array.from({ length: 145 }, (_, i) => ellipse((i / 144) * 2 * Math.PI));
    const points = [ellipse(0), ellipse(1.3), ellipse(Math.PI)];
    const bottom = { left: 0, right: 1440, top: 600, bottom: 900 };
    expect(labelSpot(points, text, view, [bottom], 8, [])).toEqual({ index: 1, anchor: 'above' });
    expect(crosses(path, ringLabelBox(points[1]!, text, 'above'))).toBe(true);
    const spot = labelSpot(points, text, view, [bottom], 8, path)!;
    expect(crosses(path, ringLabelBox(points[spot.index]!, text, spot.anchor))).toBe(false);
  });

  it('turns off a corner where the ring runs across the view at a slant (dashes through «r = 300 m»)', () => {
    // A ring seen from a low camera with only a slanted stretch in sight: centred above or below
    // any of its points the box is crossed; off a corner it is not.
    const path = Array.from({ length: 60 }, (_, i) => ({ x: 300 + i * 12, y: 600 - i * 6 }));
    const points = path.filter((_, i) => i % 6 === 3);
    const spot = labelSpot(points, text, view, [], 8, path)!;
    expect(['above', 'below']).not.toContain(spot.anchor);
    expect(crosses(path, ringLabelBox(points[spot.index]!, text, spot.anchor))).toBe(false);
    // Centred above the same point it would have been crossed.
    expect(crosses(path, ringLabelBox(points[spot.index]!, text, 'above'))).toBe(true);
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

describe('the distance of each result', () => {
  const panel = { left: 12, right: 342, top: 110, bottom: 545 };
  it('hangs right of its leader, or left of it when the right is under a plate', () => {
    expect(distanceSide({ x: 600, y: 400 }, 180, view, [panel])).toBe('right');
    // The docked card at 1440 starts just right of «171 m»'s leader end.
    const card = { left: 1056, right: 1428, top: 114, bottom: 838 };
    const at = { x: 1040, y: 570 };
    expect(distanceSide(at, 171, view, [card])).toBe('left');
    const left = distanceLabelBox(at, 171, 'left');
    expect(left.right).toBe(at.x - DISTANCE_OFFSET.x + 5);
    expect(left.right).toBeLessThan(card.left);
    // Mirrored: the same size on either side.
    const right = distanceLabelBox(at, 171);
    expect(right.right - right.left).toBe(left.right - left.left);
  });
  it('is left out when neither side is in sight, never half under the Radio panel', () => {
    // «…9 m» sticking out of the panel's right edge at 1280 × 800 with 500 m.
    expect(distanceSide({ x: 330, y: 160 }, 199, view, [panel])).toBe('hidden');
    // Off the view, or behind the camera.
    expect(distanceSide({ x: 1438, y: 6 }, 199, view, [])).toBe('hidden');
    expect(distanceSide(null, 199, view, [])).toBe('hidden');
    // Near the left edge of the view the right side is used.
    expect(distanceSide({ x: 4, y: 400 }, 63, view, [])).toBe('right');
  });
});
