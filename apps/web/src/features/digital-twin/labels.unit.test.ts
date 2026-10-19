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
    // Marks everywhere a label could go: it covers them rather than disappear.
    const full = { left: 0, right: 390, top: 0, bottom: 430 };
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

  it('keeps every label the HUD inset away from the edges of the view', () => {
    // An installation near the left edge (the Medir close-up) and one near the bottom.
    const inset = 12;
    const anchors = [label('a', 4, 200, 180), label('b', 380, 400, 180)];
    const placed = placeLabels(anchors, [], view, [], { inset });
    for (const a of anchors) {
      const o = placed.get(a.id)!;
      expect(o).not.toBeNull();
      const left = a.x + o.x - a.width / 2,
        top = a.y + o.y - a.height / 2;
      expect(left).toBeGreaterThanOrEqual(inset);
      expect(left + a.width).toBeLessThanOrEqual(view.width - inset);
      expect(top).toBeGreaterThanOrEqual(inset);
      expect(top + a.height).toBeLessThanOrEqual(view.height - inset);
    }
  });

  it('slides a label sideways off a mark when it can still span its anchor', () => {
    // A mark right where the centred label would go, below the anchor.
    const mark = { left: 191, right: 209, top: 241, bottom: 259 };
    const o = placeLabels([label('a', 200, 200, 120)], [], view, [mark]).get('a')!;
    const box = { left: 200 + o.x - 60, right: 200 + o.x + 60, top: 200 + o.y - 12 };
    const clear =
      box.right <= mark.left ||
      mark.right <= box.left ||
      box.top + 24 <= mark.top ||
      mark.bottom <= box.top;
    expect(clear).toBe(true);
  });

  it('covers as little as it can of the marks and the profile when nothing is clear', () => {
    // Marks under every spot (centred and slid) except a far one that only grazes one of them.
    const marks = [50, -34, 78, 106].flatMap((dy) =>
      [100, 200, 300].map((x) => ({
        left: x - 9,
        right: x + 9,
        top: 200 + dy - 9,
        bottom: 200 + dy + 9,
      })),
    );
    marks.push({ left: 191, right: 209, top: 146, bottom: 164 });
    const o = placeLabels([label('a', 200, 200)], [], view, marks).get('a')!;
    const box = { left: 100 + o.x, right: 300 + o.x, top: 200 + o.y - 12, bottom: 200 + o.y + 12 };
    const area = (m: (typeof marks)[number]) =>
      Math.max(0, Math.min(box.right, m.right) - Math.max(box.left, m.left)) *
      Math.max(0, Math.min(box.bottom, m.bottom) - Math.max(box.top, m.top));
    // Only the grazed mark, by 4 px of its height: the spot 62 px above.
    expect(o.y).toBe(-62);
    expect(marks.reduce((sum, m) => sum + area(m), 0)).toBe(18 * 4);
  });
});
