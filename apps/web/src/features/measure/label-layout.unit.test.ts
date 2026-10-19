import { describe, expect, it } from 'vitest';
import {
  clearOfSegment,
  labelBox,
  labelSize,
  layoutLabels,
  SIDE_GAP,
  type LabelItem,
} from './label-layout';
import { boxesAlong } from '../scene/scene-marks';
import { tickLabelBox } from '../section/section-math';

const box = (item: LabelItem, place: { dx: number; dy: number; compact: boolean }) => {
  const width = place.compact ? item.shortWidth! : item.width;
  const x = item.x + place.dx,
    y = item.y + place.dy;
  const left = item.side === 'right' ? x : item.side === 'left' ? x - width : x - width / 2;
  return { left, right: left + width, top: y - item.height / 2, bottom: y + item.height / 2 };
};
const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('dimension label layout', () => {
  it('measures a label of the 13 px mono font', () => {
    const { width, height } = labelSize('E3 · 38,0 m');
    expect(width).toBeGreaterThan(90);
    expect(width).toBeLessThan(110);
    expect(height).toBeGreaterThanOrEqual(20);
  });
  it('leaves a lone label beside its dimension', () => {
    const size = labelSize('E1 · 29,7 m');
    const [p] = layoutLabels([{ x: 300, y: 400, ...size, side: 'right' }]);
    expect(p).toEqual({ dx: SIDE_GAP, dy: 0, compact: false });
  });
  it('keeps off the A and B markers (a short profile across the south tower)', () => {
    // E3 beside a building right next to B: its natural place covers the B marker.
    const e3 = { x: 600, y: 400, ...labelSize('E3 · 3,5 m'), side: 'right' as const };
    const item = { ...e3, shortWidth: labelSize('E3').width };
    const marker = { left: 640, right: 677, top: 389, bottom: 411 };
    const [free] = layoutLabels([item]);
    expect(overlap(box(item, free!), marker)).toBe(true);
    const [p] = layoutLabels([item], [marker]);
    expect(p!.dy).not.toBe(0);
    expect(overlap(box(item, p!), marker)).toBe(false);
  });
  it('keeps off the line A–B and its distance ticks, seen from afar', () => {
    // About 500 m away a 38 m building is some 30 px tall on screen: E2's value, beside the middle
    // of its dimension, lands across the line running behind it and on the «150» of its tick.
    const e2 = { x: 700, y: 452, ...labelSize('E2 · 37,9 m'), side: 'right' as const };
    const item = { ...e2, shortWidth: labelSize('E2').width };
    const line = boxesAlong([
      { x: 420, y: 470 },
      { x: 980, y: 445 },
    ]);
    const tick = tickLabelBox({ x: 760, y: 455 }, '150');
    const [free] = layoutLabels([item]);
    expect(line.some((b) => overlap(box(item, free!), b))).toBe(true);
    expect(overlap(box(item, free!), tick)).toBe(true);
    const [p] = layoutLabels([item], [...line, tick]);
    for (const b of [...line, tick]) expect(overlap(box(item, p!), b)).toBe(false);
    // It steps up, above the line, and keeps its value.
    expect(p!.dy).toBeLessThan(0);
    expect(p!.compact).toBe(false);
  });
  it("keeps off the next building's dimension line (Torrelago from afar: E2 and E3)", () => {
    // E3's dimension stands 66 px right of E2's: E2's value, 96 px wide, would run across it.
    const e2 = { x: 591, y: 361, ...labelSize('E2 · 37,9 m'), side: 'right' as const };
    const item = { ...e2, shortWidth: labelSize('E2').width };
    const e3line = boxesAlong([
      { x: 667, y: 400 },
      { x: 667, y: 330 },
    ]);
    const [free] = layoutLabels([item]);
    expect(e3line.some((b) => overlap(box(item, free!), b))).toBe(true);
    const [p] = layoutLabels([item], e3line);
    for (const b of e3line) expect(overlap(box(item, p!), b)).toBe(false);
  });
  it('steps a label that would land on another (Torrelago: E3 and E4 side by side)', () => {
    const e3 = { x: 600, y: 420, ...labelSize('E3 · 38,0 m'), side: 'right' as const };
    const e4 = { x: 640, y: 424, ...labelSize('E4 · 36,8 m'), side: 'right' as const };
    const items = [
      { ...e3, shortWidth: labelSize('E3').width },
      { ...e4, shortWidth: labelSize('E4').width },
    ];
    const places = layoutLabels(items);
    expect(places[0]).toEqual({ dx: SIDE_GAP, dy: 0, compact: false });
    expect(places[1]!.compact).toBe(false);
    expect(places[1]!.dy).not.toBe(0);
    expect(overlap(box(items[0]!, places[0]!), box(items[1]!, places[1]!))).toBe(false);
  });
  it('falls back to the short form when every step is taken', () => {
    const size = labelSize('E9 · 40,0 m'),
      short = labelSize('E6').width;
    // Two columns of five labels fill every step; between them only «E6» fits.
    const column = (x: number): LabelItem[] =>
      Array.from({ length: 5 }, () => ({ x, y: 300, ...size, side: 'right' }));
    const a = 300,
      left = a + SIDE_GAP + size.width + 8;
    const b = left + short + 10 - SIDE_GAP;
    const items: LabelItem[] = [
      ...column(a),
      ...column(b),
      { x: left - SIDE_GAP, y: 300, ...size, side: 'right', shortWidth: short },
    ];
    const places = layoutLabels(items);
    expect(places.slice(0, 10).every((p) => !p.compact)).toBe(true);
    expect(places[10]!.compact).toBe(true);
    const boxes = places.map((p, i) => box(items[i]!, p));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
  });
  it('moves a segment value off its own line', () => {
    const size = labelSize('53,4 m');
    // A near-horizontal segment: the value goes above it, clear of the line.
    const flat = clearOfSegment({ x: 200, y: 10 }, size.width, size.height);
    expect(flat.dy).toBeLessThan(-size.height / 2);
    // A steep one (the tower's height): the value goes beside it.
    const steep = clearOfSegment({ x: 5, y: -180 }, size.width, size.height);
    expect(Math.abs(steep.dx)).toBeGreaterThan(size.width / 2);
    expect(Math.abs(steep.dy)).toBeLessThan(size.height / 2);
    const [p] = layoutLabels([
      { x: 400, y: 400, ...size, side: 'center', segment: { x: 200, y: 10 } },
    ]);
    expect(p!.dx).toBeCloseTo(flat.dx, 6);
    expect(p!.dy).toBeCloseTo(flat.dy, 6);
    // The label's box no longer touches the line through the anchor.
    const b = box({ x: 400, y: 400, ...size, side: 'center' }, p!);
    const lineY = (x: number) => 400 + ((x - 400) * 10) / 200;
    expect(b.bottom).toBeLessThan(Math.min(lineY(b.left), lineY(b.right)));
    // A segment of no length on screen (seen end on) leaves the value where it is.
    expect(clearOfSegment({ x: 0, y: 0 }, size.width, size.height)).toEqual({ dx: 0, dy: 0 });
  });
  it('gives the box a placed label covers, in its short form too', () => {
    const item: LabelItem = {
      x: 100,
      y: 200,
      width: 96,
      height: 22,
      side: 'right',
      shortWidth: 30,
    };
    expect(labelBox(item, { dx: 10, dy: -25, compact: false })).toEqual({
      left: 110,
      right: 206,
      top: 164,
      bottom: 186,
    });
    expect(labelBox(item, { dx: 10, dy: 0, compact: true }).right).toBe(140);
    const centre = labelBox({ ...item, side: 'center' }, { dx: 0, dy: 0, compact: false });
    expect(centre.left).toBe(52);
  });
});
