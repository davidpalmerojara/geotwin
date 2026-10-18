import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelAnchor } from './labels';

const view = { width: 390, height: 430 };
const label = (id: string, x: number, y: number, width = 200): LabelAnchor => ({
  id,
  x,
  y,
  width,
  height: 24,
});

describe('Installation labels on the map', () => {
  it('puts a lone label below its anchor, centred', () => {
    const placed = placeLabels([label('a', 200, 200)], [], view);
    expect(placed.get('a')).toEqual({ x: 0, y: 50 });
  });

  it('moves the second of two close labels above its anchor instead of overlapping', () => {
    const placed = placeLabels([label('a', 200, 200), label('b', 220, 215)], [], view);
    expect(placed.get('a')).toEqual({ x: 0, y: 50 });
    expect(placed.get('b')!.y).toBe(-34);
  });

  it('slides a label out from under the control column, still spanning its anchor', () => {
    // The phone's control column: 44 px wide at the left, from y = 150 to 420.
    const controls = { left: 12, right: 56, top: 150, bottom: 420 };
    const placed = placeLabels([label('a', 120, 200)], [controls], view).get('a')!;
    const left = 120 + placed.x - 100;
    expect(left).toBeGreaterThanOrEqual(controls.right);
    expect(left).toBeLessThanOrEqual(120);
  });

  it('hides a label with no free spot and one whose anchor is out of view', () => {
    const wall = { left: 0, right: 390, top: 0, bottom: 430 };
    expect(placeLabels([label('a', 200, 200)], [wall], view).get('a')).toBeNull();
    expect(placeLabels([label('b', -50, 200)], [], view).get('b')).toBeNull();
  });

  it('keeps every placed label inside the view and apart from the others', () => {
    const anchors = [label('a', 60, 300), label('b', 150, 330), label('c', 330, 380, 180)];
    const placed = placeLabels(anchors, [], view);
    const boxes = anchors.flatMap((a) => {
      const o = placed.get(a.id);
      return o
        ? [{ l: a.x + o.x - a.width / 2, r: a.x + o.x + a.width / 2, t: a.y + o.y - 12 }]
        : [];
    });
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const b of boxes) {
      expect(b.l).toBeGreaterThanOrEqual(0);
      expect(b.r).toBeLessThanOrEqual(view.width);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i]!, boxes[j]!];
        const apart = p.r <= q.l || q.r <= p.l || p.t + 24 <= q.t || q.t + 24 <= p.t;
        expect(apart).toBe(true);
      }
  });
  it('keeps markers uncovered when it can, and covers them rather than hide the label', () => {
    const marker = { left: 192, right: 208, top: 242, bottom: 258 };
    const free = placeLabels([label('a', 200, 200)], [], view, [marker]).get('a')!;
    expect(free.y).not.toBe(50);
    const full = { left: 0, right: 390, top: 140, bottom: 300 };
    expect(placeLabels([label('a', 200, 200)], [], view, [full]).get('a')).toEqual({
      x: 0,
      y: 50,
    });
  });
  it('goes a step further out before covering a marker (a dense network on a phone)', () => {
    // Marks under the three usual spots: below, above and further below the anchor.
    const marks = [50, -34, 78].map((dy) => ({
      left: 192,
      right: 208,
      top: 200 + dy - 8,
      bottom: 200 + dy + 8,
    }));
    const placed = placeLabels([label('a', 200, 200)], [], view, marks).get('a')!;
    expect(placed.y).toBe(-62);
    const box = { left: 100 + placed.x, right: 300 + placed.x, top: 126, bottom: 150 };
    for (const m of marks)
      expect(box.right <= m.left || m.right <= box.left || box.bottom <= m.top).toBe(true);
  });
});
