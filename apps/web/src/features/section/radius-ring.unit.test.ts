import { describe, expect, it } from 'vitest';
import { circle, labelSpot, radiusText, segmentHitsBox } from './radius-ring';
import {
  DISTANCE_OFFSET,
  RING_LABEL_LIFT,
  distanceLabelBox,
  distanceSide,
  placeDistances,
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

describe('the distances seen from afar (Radio of 300 m around the south tower, 1,9 km away)', () => {
  // A real frame at 1440 × 900 with four LiDAR sheets: the end of each result's leader (on its
  // mark) and the centre of every mark in view. The south tower (01) is the selected centre, with
  // its brackets. Before, «63 m» sat on the brackets, «85 m» and «101 m» overlapped and «158 m»
  // lay under the next mark (it read «8 m»).
  const ends = [
    { id: '06', metres: 63, at: { x: 678.2, y: 421.6 } },
    { id: '02', metres: 85, at: { x: 741.6, y: 399.4 } },
    { id: '05', metres: 101, at: { x: 768.4, y: 403.9 } },
    { id: '03', metres: 136, at: { x: 734.1, y: 374.9 } },
    { id: '11', metres: 158, at: { x: 808.1, y: 479.1 } },
    { id: '10', metres: 171, at: { x: 827.6, y: 461.3 } },
    { id: '12', metres: 180, at: { x: 747.8, y: 521.8 } },
  ];
  const centres: [string, number, number][] = [
    ['09', 953.1, 483.2],
    ['08', 1005, 621.9],
    ['03', 734.1, 375.4],
    ['11', 808, 479.6],
    ['06', 678.2, 422.1],
    ['02', 741.6, 397.9],
    ['04', 788, 289.1],
    ['01', 720, 414.8],
    ['10', 827.5, 461.8],
    ['07', 940.6, 514.8],
    ['12', 747.8, 522.3],
    ['05', 768.4, 404.4],
  ];
  const marks = centres.map(([id, x, y]) => {
    const half = id === '01' ? 14 : 8;
    return { id, left: x - half, right: x + half, top: y - half, bottom: y + half };
  });
  const panel = { left: 12, top: 104, right: 342, bottom: 466 },
    card = { left: 1056, top: 114, right: 1428, bottom: 806 };
  const ring = { left: 612, top: 594, right: 828, bottom: 616 };
  const apart = (
    a: { left: number; right: number; top: number; bottom: number },
    b: { left: number; right: number; top: number; bottom: number },
  ) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

  it('keeps every distance clear of the other marks, of each other and of the radius label', () => {
    const sides = placeDistances(ends, view, [panel, card], marks, [ring]);
    const shown = ends.flatMap((end) => {
      const side = sides.get(end.id)!;
      return side === 'hidden' ? [] : [{ end, box: distanceLabelBox(end.at, end.metres, side) }];
    });
    for (const { end, box } of shown) {
      for (const m of marks)
        if (m.id !== end.id) expect(apart(box, m), `${end.metres} m on ${m.id}`).toBe(true);
      expect(apart(box, ring)).toBe(true);
      for (const other of shown)
        if (other.end !== end)
          expect(apart(box, other.box), `${end.metres} m on ${other.end.metres} m`).toBe(true);
    }
    // Most still have room; the nearest results come first.
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(sides.get('06')).not.toBe('hidden');
  });

  it('flips, steps or hides only when the usual spot is taken', () => {
    // Alone in the view, every distance hangs right of its leader and up, as before.
    for (const end of ends) expect(placeDistances([end], view, []).get(end.id)).toBe('right');
    // A mark right of the end: the figure goes left of its leader.
    const at = { x: 600, y: 500 };
    const mark = { id: 'x', left: at.x + 10, right: at.x + 26, top: at.y - 26, bottom: at.y - 10 };
    expect(placeDistances([{ id: 'a', at, metres: 63 }], view, [], [mark]).get('a')).toBe('left');
    // Its own mark never counts.
    const own = { ...mark, id: 'a' };
    expect(placeDistances([{ id: 'a', at, metres: 63 }], view, [], [own]).get('a')).toBe('right');
    // Two results on the same spot: the nearer keeps it, the other moves.
    const two = placeDistances(
      [
        { id: 'far', at, metres: 101 },
        { id: 'near', at, metres: 85 },
      ],
      view,
      [],
    );
    expect(two.get('near')).toBe('right');
    expect(two.get('far')).toBe('left');
    // Marks all around: it is not written (the Radio panel lists it).
    const around = [-40, 0, 40].flatMap((dx) =>
      [-40, 0, 40].map((dy, k) => ({
        id: `m${dx}${k}`,
        left: at.x + dx - 30,
        right: at.x + dx + 30,
        top: at.y + dy - 30,
        bottom: at.y + dy + 30,
      })),
    );
    expect(placeDistances([{ id: 'a', at, metres: 63 }], view, [], around).get('a')).toBe('hidden');
    expect(placeDistances([{ id: 'a', at: null, metres: 63 }], view, []).get('a')).toBe('hidden');
  });

  it('builds the box of each spot around the end of the leader', () => {
    const at = { x: 500, y: 300 };
    const right = distanceLabelBox(at, 63),
      below = distanceLabelBox(at, 63, 'right-below'),
      up = distanceLabelBox(at, 63, 'right-up'),
      left = distanceLabelBox(at, 63, 'left-below');
    expect(right.bottom).toBe(at.y + DISTANCE_OFFSET.y + 2);
    expect(below.top).toBe(at.y - DISTANCE_OFFSET.y - 2);
    expect(up.bottom).toBeLessThan(right.top);
    expect(left.right).toBe(at.x - DISTANCE_OFFSET.x + 5);
    expect(below.left).toBe(right.left);
  });
});
