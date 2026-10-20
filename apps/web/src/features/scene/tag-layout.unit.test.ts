import { describe, expect, it } from 'vitest';
import {
  placeValue,
  valueSpots,
  fadesTag,
  EDGE,
  FAR_M,
  NEAR_M,
  isOccluded,
  occlusionMargin,
  layoutTags,
  lodFor,
  rankOf,
  reserveSelected,
  tagBox,
  type TagItem,
  type TagPlacement,
  bracketsBox,
} from './tag-layout';
import { overlaps } from '../digital-twin/labels';
import type { ScreenBox } from '../digital-twin/camera';

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
  it('keeps name, value and word for the selected asset up to 2 km (Radio seen from afar)', () => {
    expect(lodFor(NEAR_M + 1, 'healthy', true)).toBe('full');
    expect(lodFor(FAR_M, 'healthy', true, true)).toBe('full');
    expect(lodFor(FAR_M + 1, 'healthy', true)).toBe('mark');
  });
});

describe('placement priority', () => {
  it('ranks selected, critical, warning, radius hit, operational', () => {
    expect(rankOf('critical', true)).toBe(0);
    expect(rankOf('healthy', true, true)).toBe(0);
    expect(rankOf('critical')).toBe(1);
    expect(rankOf('warning', false, true)).toBe(2);
    expect(rankOf('healthy', false, true)).toBe(3);
    expect(rankOf('healthy')).toBe(4);
  });
  it('gives the selected asset the spot another critical tag wants', () => {
    const small = { width: 120, height: 60 };
    const other = item('other', 20, 40, rankOf('critical'));
    const selected = item('selected', 20, 40, rankOf('critical', true));
    const result = layoutTags([other, selected], { view: small });
    expect(result.get('selected')).not.toBeNull();
    expect(result.get('other')).toBeNull();
  });
  it('falls back to the value alone when the whole tag fits nowhere (1280 × 800, Alertas and card)', () => {
    // The selected critical gateway between the Alertas sheet (to x 572) and the docked card
    // (from x 788): «Pasarela LoRa · torre sur 95,2 °C crítico» is 250 px, its value 84 px.
    const sheet = { left: 12, top: 104, right: 572, bottom: 416 },
      card = { left: 788, top: 114, right: 1160, bottom: 674 };
    const view1280 = { width: 1280, height: 800 };
    const whole = item('pasarela', 703, 393, rankOf('critical', true), 250, 22);
    const blocked = [sheet, card];
    expect(layoutTags([whole], { view: view1280, blocked }).get('pasarela')).toBeNull();
    const tag = { ...whole, compact: { width: 84, height: 22 } };
    const placed = layoutTags([tag], { view: view1280, blocked }).get('pasarela')!;
    expect(placed.compact).toBe(true);
    const box = {
      left: placed.left,
      top: placed.top,
      right: placed.left + 84,
      bottom: placed.top + 22,
    };
    for (const b of blocked) expect(overlaps(box, b)).toBe(false);
    // With room, the whole tag is used.
    expect(layoutTags([tag], { view: view1280 }).get('pasarela')!.compact).toBe(false);
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
  it('keeps clear of other marks, and hides rather than cover one', () => {
    const a = item('a', 400, 300);
    const marks = new Map([['b', { left: 414, top: 250, right: 500, bottom: 290 }]]);
    const placed = layoutTags([a], { view, marks }).get('a')!;
    expect(placed.side).not.toBe('ne');
    // The only spot left is on another mark: the tag is hidden, the mark stays in sight.
    const tight = { width: 120, height: 60 };
    const near = item('n', 20, 40);
    const everywhere = new Map([['m', { left: 0, top: 0, right: 120, bottom: 60 }]]);
    expect(layoutTags([near], { view: tight, marks: everywhere }).get('n')).toBeNull();
    // In its compact form it fits beside the mark: that form is used rather than cover it.
    const mark = new Map([['m', { left: 70, top: 0, right: 120, bottom: 60 }]]);
    const wide = { ...item('w', 20, 40, 4, 90), compact: { width: 30, height: 22 } };
    expect(layoutTags([wide], { view: tight, marks: mark }).get('w')).toMatchObject({
      compact: true,
    });
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

describe('critical tags before warnings (phone, tap on Centro de transformación, with alerts)', () => {
  // The check's frame at 390 × 844 after the tap, with the gateway of the south tower critical and
  // the pressure group in warning: marks, tag sizes and plates (the top plate with the annunciator
  // row, scale, heading, the credits above the sheet at 45 %, the sheet, the tool bar and
  // Torrelago's label).
  const phone = { width: 390, height: 844 };
  const credits = { left: 10, top: 400.9, right: 380, bottom: 456.2 };
  const plates = [
    { left: 10, top: 10, right: 380, bottom: 150 },
    { left: 10, top: 159, right: 170, bottom: 201 },
    { left: 261, top: 159, right: 380, bottom: 201 },
    { left: 10, top: 464.2, right: 380, bottom: 768 },
    { left: 10, top: 776, right: 380, bottom: 834 },
    { left: 61, top: 262, right: 351, bottom: 302 },
  ];
  const at: Record<string, [number, number, 'healthy' | 'warning' | 'critical', number, number]> = {
    // x, y, status, value width, whole width
    '03': [195, 351, 'healthy', 66, 270],
    '06': [90, 430, 'healthy', 59, 247],
    '02': [207, 390, 'warning', 99, 241],
    '04': [276, 225, 'healthy', 66, 218],
    '01': [168, 417, 'critical', 90, 250],
    '05': [252, 397, 'healthy', 74, 234],
  };
  const marks = new Map(
    Object.entries(at).map(([id, [x, y]]) => [
      id,
      { left: x - 8, right: x + 8, top: y - 8, bottom: y + 8 },
    ]),
  );
  const items: TagItem[] = Object.entries(at).map(([id, [x, y, status, value, whole]]) => {
    const full = id === '03' || status !== 'healthy';
    const height = id === '03' ? 22 : 26;
    return {
      id,
      x,
      y,
      distance: 700,
      width: full ? whole : value,
      height,
      rank: rankOf(status, id === '03'),
      compact: full ? { width: value, height } : undefined,
    };
  });
  const layout = (blocked: typeof plates) =>
    layoutTags(items, { view: phone, blocked, marks, selected: '03' });

  it('places the selected tag whole, then the critical one, then the warning', () => {
    const placed = layout([...plates, credits]);
    expect(placed.get('03')).toMatchObject({ side: 'n', compact: false });
    // The gateway's mark is under the credits: none of its spots is clear of them and of the
    // other marks, so its tag hides (its edge chip says where it is, see chipTargets).
    expect(placed.get('01')).toBeNull();
    // The warning keeps its value on the spot of the check (221, 350).
    expect(placed.get('02')).toMatchObject({ side: 'ne', compact: true });
    expect(Math.round(placed.get('02')!.left)).toBe(221);
    // With the sheet lower (the credits out of the way), the critical tag takes a spot, in its
    // compact form, before the warning is placed.
    const lower = layout(plates);
    expect(lower.get('01')).toMatchObject({ compact: true });
    expect(lower.get('02')).toMatchObject({ side: 'ne', compact: true });
  });

  it('never lets a warning’s compact tag take the spot a critical tag could use', () => {
    // Room for one compact tag only, up and to the right of two marks in the same place; the
    // warning is nearer the camera, which wins between equal ranks only.
    const view = { width: 120, height: 50 };
    const tag = (id: string, status: 'critical' | 'warning', distance: number): TagItem => ({
      id,
      x: 20,
      y: 40,
      width: 200,
      height: 22,
      distance,
      rank: rankOf(status),
      compact: { width: 60, height: 22 },
    });
    const placed = layoutTags([tag('warning', 'warning', 100), tag('critical', 'critical', 900)], {
      view,
    });
    expect(placed.get('critical')).toMatchObject({ side: 'ne', compact: true });
    expect(placed.get('warning')).toBeNull();
  });
});

describe('the selected mark is never covered (phone, tap on Centro de transformación)', () => {
  // The boxes of a real frame at 390 × 844 after tapping the mark of «Centro de transformación ·
  // Torrelago» on a phone (four LiDAR sheets): the selected tag holds its whole spot above its
  // mark, and «Grupo de presión» (7,50 mm/s, value only) took the spot above its own mark, right on
  // the selected mark and its brackets.
  const phone = { width: 390, height: 844 };
  const blocked = [
    { left: 10, top: 10, right: 380, bottom: 68.6 },
    { left: 10, top: 76.6, right: 171, bottom: 120.6 },
    { left: 261.2, top: 76.6, right: 380, bottom: 120.6 },
    { left: 10, top: 464.2, right: 380, bottom: 768 },
    { left: 10, top: 400.9, right: 380, bottom: 456.2 },
    { left: 10, top: 776, right: 380, bottom: 834 },
    // Torrelago's installation label.
    { left: 113, top: 229, right: 298, bottom: 269 },
  ];
  const at: Record<string, [number, number, number, number, number]> = {
    // x, y, distance, value width, full width
    '03': [195, 318.377, 765, 66, 270],
    '06': [96.3951, 386.188, 629, 59, 247],
    '02': [206.303, 353.632, 720, 81, 241],
    '04': [272.794, 201.272, 888, 66, 218],
    '01': [169.188, 374.08, 635, 66, 206],
    '05': [248.809, 360.486, 715, 74, 234],
  };
  const marks = new Map(
    Object.entries(at).map(([id, [x, y]]) => [
      id,
      { left: x - 8, right: x + 8, top: y - 8, bottom: y + 8 },
    ]),
  );
  const items: TagItem[] = Object.entries(at).map(([id, [x, y, distance, value, full]]) =>
    id === '03'
      ? {
          id,
          x,
          y,
          distance,
          width: full,
          height: 22,
          rank: rankOf('healthy', true),
          compact: { width: value, height: 22 },
        }
      : { id, x, y, distance, width: value, height: 22, rank: rankOf('healthy') },
  );
  const brackets = bracketsBox(marks.get('03')!);
  it('keeps every other tag off the selected mark and its brackets', () => {
    const result = layoutTags(items, { view: phone, blocked, marks, selected: '03' });
    // The selected tag keeps its whole spot.
    expect(result.get('03')).toMatchObject({ compact: false });
    for (const i of items) {
      const p = result.get(i.id);
      if (!p || i.id === '03') continue;
      const w = p.compact ? i.compact!.width : i.width;
      const box = { left: p.left, top: p.top, right: p.left + w, bottom: p.top + i.height };
      expect(overlaps(box, brackets), `${i.id} over the selected mark`).toBe(false);
    }
  });
  it('drops to the compact form or hides rather than cover any mark', () => {
    // «Grupo de presión» whole (warning) next to the selected mark, with its value as compact form.
    const whole = items.map((i) =>
      i.id === '02'
        ? {
            ...i,
            width: 323,
            height: 26,
            rank: rankOf('warning'),
            compact: { width: 99, height: 26 },
          }
        : i,
    );
    const result = layoutTags(whole, { view: phone, blocked, marks, selected: '03' });
    for (const i of whole) {
      const p = result.get(i.id);
      if (!p || i.id === '03') continue;
      const size = p.compact ? i.compact! : i;
      const box = tagBox({ x: i.x, y: i.y, ...size }, p.side);
      for (const [id, m] of marks)
        if (id !== i.id) expect(overlaps(box, m), `${i.id} over the mark of ${id}`).toBe(false);
    }
  });
  it('lets only the selected tag cover another mark when it has no other spot', () => {
    const tight = { width: 120, height: 60 };
    const everywhere = new Map([['m', { left: 0, top: 0, right: 120, bottom: 60 }]]);
    const selected = { ...item('s', 20, 40, rankOf('healthy', true)) };
    expect(
      layoutTags([selected], { view: tight, marks: everywhere, selected: 's' }).get('s'),
    ).not.toBeNull();
  });
});

describe('reserveSelected (the selected tag wins over the installation labels)', () => {
  // As in the far Radio view: Torrelago's label took the spot beside the selected mark, and the
  // tag fell back to «37,0 °C». The mark at the left edge, a plate below.
  const plate = { left: 0, top: 330, right: 800, bottom: 600 },
    label = { left: 170, top: 230, right: 450, bottom: 292 };
  const tag: TagItem = {
    ...item('sonda', 150, 300, rankOf('warning', true), 180, 22),
    compact: { width: 60, height: 22 },
  };
  it('reserves the spot where it fits whole once the labels are left out', () => {
    const placed = layoutTags([tag], { view, blocked: [plate, label] }).get('sonda')!;
    expect(placed.compact).toBe(true);
    const reserved = reserveSelected(tag, placed, { view, blocked: [plate] })!;
    expect(reserved).toEqual({ side: 'ne', width: 180, height: 22 });
    // The label keeps off that box in the next frame (it steps up), and the tag goes there whole.
    const box = tagBox({ x: tag.x, y: tag.y, ...reserved }, reserved.side);
    expect(overlaps(label, box)).toBe(true);
    const moved = { left: 170, top: 200, right: 450, bottom: box.top - 2 };
    const next = layoutTags([tag], { view, blocked: [plate, moved] }).get('sonda')!;
    expect(next).toMatchObject({ side: 'ne', compact: false });
    // Placed whole, it keeps its spot.
    expect(reserveSelected(tag, next, { view, blocked: [plate] })).toEqual(reserved);
  });
  it('reserves nothing when the tag fits whole nowhere, nor without a selection', () => {
    const wall = { left: 0, top: 0, right: 800, bottom: 290 };
    const placed = layoutTags([tag], { view, blocked: [plate, wall] }).get('sonda') ?? null;
    expect(reserveSelected(tag, placed, { view, blocked: [plate, wall] })).toBeNull();
    expect(reserveSelected(undefined, null, { view })).toBeNull();
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
  it('takes no spot for a size of 0 × 0 (a hidden element measured)', () => {
    expect(placeValue(at, { width: 0, height: 0 }, 1440, [], [])).toBeNull();
  });
});

describe('the mounting height with Radio on settles (1440 × 900, 1,4 km from the east)', () => {
  // A still frame of the check: the value point of the dimension line, the value's measured size,
  // and what it keeps clear of: Radio's distances and radius, the installation labels and the
  // plates (canvas px).
  const at = { x: 695.875, y: 415.7 };
  const size = { width: 174, height: 21 };
  const values = [
    [739, 414, 776, 433], // 63 m
    [609, 381, 646, 400], // 85 m
    [666, 357, 709, 376], // 101 m
    [551, 388, 594, 407], // 136 m
    [803, 326, 847, 345], // 158 m
    [782, 302, 826, 321], // 171 m
    [881, 378, 924, 397], // 180 m
    [610, 657, 829, 681], // r = 300 m · 7 activos dentro
  ];
  const labels = [
    [851, 309, 1019, 349], // Laguna y zona deportiva
    [508, 446, 693, 486], // Torrelago · torres residenciales
  ];
  const plates = [
    [12, 104, 342, 467], // Radio
    [1056, 112, 1428, 807], // the card
  ];
  const box = ([left = 0, top = 0, right = 0, bottom = 0]: number[]) => ({
    left,
    top,
    right,
    bottom,
  });
  const blocked = [...values, ...labels, ...plates].map((b) => box(b));

  it('fits in none of its six spots there, so it stays hidden frame after frame', () => {
    for (const spot of valueSpots(at, size))
      expect(blocked.some((b) => overlaps(spot, b))).toBe(true);
    // The frame loop of asset-tags: each frame places the value with its measured size (it used
    // the size read from the element, 0 × 0 while hidden: a spot then, none the next frame).
    let shown: number | null = null;
    const states: (number | null)[] = [];
    for (let frame = 0; frame < 8; frame++) {
      shown = placeValue(at, size, 1440, blocked, [], 12, shown)?.spot ?? null;
      states.push(shown);
    }
    expect(states).toEqual(Array(8).fill(null));
  });

  it('keeps its spot while it stays free instead of going back to the first one', () => {
    // Zoomed out once (chipmount): left of the line from 534 to 708 px or right from 732 to 906.
    const point = { x: 720, y: 470 };
    const left = placeValue(point, size, 1440, [], [])!;
    expect([left.spot, left.left, left.right]).toEqual([0, 534, 708]);
    // A label stood on the left spot in one frame: the value went right, and the label then left.
    const label = { left: 520, right: 690, top: 455, bottom: 495 };
    const right = placeValue(point, size, 1440, [label], [])!;
    expect([right.spot, right.left, right.right]).toEqual([1, 732, 906]);
    // The next frame both spots are free: it stays on the right (it went back to the left, so the
    // label came back to its spot, and so on, frame after frame).
    expect(placeValue(point, size, 1440, [], [], 12, right.spot)!.spot).toBe(1);
    // Until its spot is taken: then the first free one again.
    const card = { left: 730, right: 1440, top: 0, bottom: 900 };
    expect(placeValue(point, size, 1440, [card], [], 12, right.spot)!.spot).toBe(0);
  });

  it('settles in two frames with the labels placed first, keeping off its last spot', () => {
    // Each frame the labels are placed first and keep off the value's spot of the frame before
    // (addReservedTags); then the value takes its spot clear of them.
    const point = { x: 720, y: 470 };
    const labelSpots = [
      { left: 520, right: 690, top: 455, bottom: 495 },
      { left: 520, right: 690, top: 500, bottom: 540 },
    ];
    let spot: number | null = null;
    const states: string[] = [];
    for (let frame = 0; frame < 8; frame++) {
      const reserved: ScreenBox[] = spot === null ? [] : [valueSpots(point, size)[spot]!];
      const label: ScreenBox = labelSpots.find((l) => !reserved.some((r) => overlaps(l, r)))!;
      spot = placeValue(point, size, 1440, [label], [], 12, spot)?.spot ?? null;
      states.push(`${spot}:${labelSpots.indexOf(label)}`);
    }
    expect(new Set(states.slice(1)).size).toBe(1);
  });
});
