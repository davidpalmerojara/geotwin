import { describe, expect, it } from 'vitest';
import {
  placeValue,
  fadesTag,
  EDGE,
  FAR_M,
  NEAR_M,
  isOccluded,
  occlusionMargin,
  layoutTags,
  lodFor,
  rankOf,
  tagBox,
  type TagItem,
  type TagPlacement,
} from './tag-layout';
import { overlaps } from '../digital-twin/labels';

const view = { width: 800, height: 600 };
const item = (id: string, x: number, y: number, rank = 4, width = 80, height = 22): TagItem => ({
  id,
  x,
  y,
  width,
  height,
  rank,
  distance: 500,
});
const boxOf = (p: TagPlacement, i: TagItem) => ({
  left: p.left,
  top: p.top,
  right: p.left + i.width,
  bottom: p.top + i.height,
});

describe('level of detail by distance', () => {
  it('shows name and value for warnings and critical assets up to 700 m', () => {
    expect(lodFor(300, 'critical')).toBe('full');
    // While a profile is drawn, operational assets keep only their mark; alarms keep their tags.
    expect(lodFor(300, 'healthy', false, true)).toBe('mark');
    expect(lodFor(300, 'healthy', true, true)).toBe('full');
    expect(lodFor(300, 'warning', false, true)).toBe('full');
    expect(lodFor(1500, 'critical', false, true)).toBe('value');
    expect(lodFor(NEAR_M, 'warning')).toBe('full');
    expect(lodFor(300, 'healthy')).toBe('value');
    expect(lodFor(300, 'healthy', true)).toBe('full');
  });
  it('shows only the value up to 2 km and only the mark beyond', () => {
    expect(lodFor(NEAR_M + 1, 'critical')).toBe('value');
    expect(lodFor(FAR_M, 'healthy')).toBe('value');
    expect(lodFor(FAR_M + 1, 'critical')).toBe('mark');
    expect(lodFor(Number.NaN, 'healthy')).toBe('mark');
  });
});

describe('placement priority', () => {
  it('ranks critical, warning, selected, radius hit, operational', () => {
    expect(rankOf('critical')).toBe(0);
    expect(rankOf('warning', true, true)).toBe(1);
    expect(rankOf('healthy', true, true)).toBe(2);
    expect(rankOf('healthy', false, true)).toBe(3);
    expect(rankOf('healthy')).toBe(4);
  });
  it('gives the contested spot to the more important tag and hides the other one', () => {
    // Two marks in the same place in a scene with room for one tag only.
    const small = { width: 120, height: 60 };
    const ok = item('ok', 20, 40, rankOf('healthy'));
    const crit = item('crit', 20, 40, rankOf('critical'));
    const result = layoutTags([ok, crit], { view: small });
    expect(result.get('crit')).not.toBeNull();
    expect(result.get('ok')).toBeNull();
  });
  it('places nearer tags first between equal ranks', () => {
    const small = { width: 120, height: 60 };
    const far = { ...item('far', 20, 40), distance: 900 };
    const near = { ...item('near', 20, 40), distance: 100 };
    const result = layoutTags([far, near], { view: small });
    expect(result.get('near')).not.toBeNull();
    expect(result.get('far')).toBeNull();
  });
});

describe('tag layout', () => {
  it('puts a lone tag up and to the right of its mark, with a leader to its corner', () => {
    const tag = item('a', 400, 300);
    const placed = layoutTags([tag], { view }).get('a')!;
    expect(placed.side).toBe('ne');
    expect(placed.left).toBeGreaterThan(400);
    expect(placed.top + tag.height).toBeLessThan(300);
    expect(placed.leader).toEqual({ x1: 400, y1: 300, x2: placed.left, y2: placed.top + 22 });
  });
  it('never overlaps two tags, a plate or the scene edge, whatever the crowd', () => {
    const items: TagItem[] = [];
    for (let i = 0; i < 40; i++)
      items.push(
        item(`t${i}`, 60 + ((i * 97) % 680), 50 + ((i * 53) % 500), i % 5, 60 + (i % 4) * 20),
      );
    const blocked = [{ left: 0, top: 0, right: 300, bottom: 120 }];
    const result = layoutTags(items, { view, blocked });
    const boxes = items.flatMap((i) => {
      const p = result.get(i.id);
      return p ? [boxOf(p, i)] : [];
    });
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.length).toBeLessThan(items.length);
    for (const [k, a] of boxes.entries()) {
      expect(a.left).toBeGreaterThanOrEqual(EDGE);
      expect(a.top).toBeGreaterThanOrEqual(EDGE);
      expect(a.right).toBeLessThanOrEqual(view.width - EDGE);
      expect(a.bottom).toBeLessThanOrEqual(view.height - EDGE);
      expect(overlaps(a, blocked[0]!)).toBe(false);
      for (const b of boxes.slice(k + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });
  it('hides the tags that do not fit and the marks off screen', () => {
    const plate = { left: 0, top: 0, right: 800, bottom: 600 };
    const result = layoutTags([item('a', 400, 300), item('off', -20, 300)], {
      view,
      blocked: [plate],
    });
    expect(result.get('a')).toBeNull();
    expect(result.get('off')).toBeNull();
  });
  it('keeps clear of other marks while there is room, and covers one rather than vanish', () => {
    const a = item('a', 400, 300);
    const marks = new Map([['b', { left: 414, top: 250, right: 500, bottom: 290 }]]);
    const placed = layoutTags([a], { view, marks }).get('a')!;
    expect(placed.side).not.toBe('ne');
    // The only spot left is on another mark: it is still used.
    const tight = { width: 120, height: 60 };
    const near = item('n', 20, 40);
    const everywhere = new Map([['m', { left: 0, top: 0, right: 120, bottom: 60 }]]);
    expect(layoutTags([near], { view: tight, marks: everywhere }).get('n')).not.toBeNull();
    // Its own mark never counts.
    const own = new Map([['n', { left: 0, top: 0, right: 120, bottom: 60 }]]);
    expect(layoutTags([near], { view: tight, marks: own }).get('n')?.side).toBe('ne');
  });
  it('keeps the side a tag had while it still fits, so tags do not jump', () => {
    const a = item('a', 400, 300);
    const previous = new Map([['a', 'sw' as const]]);
    expect(layoutTags([a], { view, previous }).get('a')?.side).toBe('sw');
  });
  it('builds each of the eight boxes around the mark', () => {
    const at = { x: 100, y: 100, width: 40, height: 20 };
    expect(tagBox(at, 'n')).toEqual({ left: 80, top: 56, right: 120, bottom: 76 });
    expect(tagBox(at, 's')).toEqual({ left: 80, top: 124, right: 120, bottom: 144 });
    expect(tagBox(at, 'e').left).toBe(124);
    expect(tagBox(at, 'w').right).toBe(76);
    expect(tagBox(at, 'nw')).toEqual({ left: 46, top: 66, right: 86, bottom: 86 });
    expect(tagBox(at, 'se')).toEqual({ left: 114, top: 114, right: 154, bottom: 134 });
  });
});

describe('occlusion', () => {
  it('needs two of three samples more than 3 m in front of the mark', () => {
    expect(isOccluded(500, [480, 490, 520])).toBe(true);
    expect(isOccluded(500, [480, 510, 520])).toBe(false);
    // 3 m is not enough: the roof the gateway stands on.
    expect(isOccluded(500, [497.5, 497.1, 499])).toBe(false);
    expect(isOccluded(500, [496.9, 496.5, 499])).toBe(true);
  });
  it('allows more depth noise far away', () => {
    // 4,3 km: 17 m of margin; a roof 10 m in front of a far mark does not hide it.
    expect(occlusionMargin(500)).toBe(3);
    expect(occlusionMargin(4300)).toBeCloseTo(17.2);
    expect(isOccluded(4300, [4290, 4288, 4300])).toBe(false);
    expect(isOccluded(4300, [4250, 4270, 4300])).toBe(true);
  });
  it('ignores the sky and missing reads', () => {
    expect(isOccluded(500, [null, undefined, 400])).toBe(false);
    expect(isOccluded(500, [Number.NaN, 400, 400])).toBe(true);
  });
});

describe('fadesTag', () => {
  it('fades the tag of a hidden operating asset only', () => {
    expect(fadesTag('healthy', true)).toBe(true);
    expect(fadesTag('healthy', false)).toBe(false);
  });

  it('keeps the tag of a hidden alert at full strength', () => {
    expect(fadesTag('warning', true)).toBe(false);
    expect(fadesTag('critical', true)).toBe(false);
  });
});

describe('placeValue (the mounting height)', () => {
  const size = { width: 150, height: 21 };
  const at = { x: 600, y: 400 };
  it('goes left of the dimension line when there is room', () => {
    const box = placeValue(at, size, 1440, [], [])!;
    expect(box.right).toBe(588);
    expect(box.top).toBeCloseTo(389.5, 5);
  });
  it("moves aside from another asset's mark instead of being drawn under it", () => {
    // A mark right where «41,9 m sobre el suelo» would go, on its left.
    const mark = { left: 500, right: 516, top: 392, bottom: 408 };
    const box = placeValue(at, size, 1440, [], [mark])!;
    expect(overlaps(box, mark)).toBe(false);
    expect(box.left).toBe(612);
  });
  it('steps up or down when both sides have a mark', () => {
    const marks = [
      { left: 500, right: 516, top: 392, bottom: 408 },
      { left: 700, right: 716, top: 392, bottom: 408 },
    ];
    const box = placeValue(at, size, 1440, [], marks)!;
    expect(marks.some((m) => overlaps(box, m))).toBe(false);
    expect(box.top).toBeLessThan(389.5);
  });
  it('keeps clear of plates before marks, and gives up when nothing is free', () => {
    const card = { left: 300, right: 1440, top: 0, bottom: 900 };
    expect(placeValue(at, size, 1440, [card], [])).toBeNull();
    const left = { left: 0, right: 590, top: 0, bottom: 900 };
    const everywhere = [{ left: 600, right: 900, top: 0, bottom: 900 }];
    // Only marks to the right: drawn over them rather than under the plate on the left.
    const box = placeValue(at, size, 1440, [left], everywhere)!;
    expect(box.left).toBe(612);
  });
});
