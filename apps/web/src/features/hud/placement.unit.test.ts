import { describe, expect, it } from 'vitest';
import { bearing, compass, edgeChip, intersects, placeCard, separate, type Box } from './placement';

const viewport = { width: 1440, height: 900 };
const card = { width: 372, height: 520 };
// The heading plate (top right) and the readout and credits (bottom).
const plates: Box[] = [
  { left: 1138, top: 12, right: 1428, bottom: 66 },
  { left: 12, top: 858, right: 760, bottom: 888 },
  { left: 868, top: 838, right: 1428, bottom: 888 },
];
const base = { viewport, card, obstacles: plates, dockTop: 108, bottom: 830 };

describe('asset card placement', () => {
  it('floats beside the asset on the side with more room, joined by a guide', () => {
    const p = placeCard({ ...base, anchor: { x: 500, y: 300 } });
    expect(p.mode).toBe('float');
    expect(p.side).toBe('right');
    expect(p.left).toBe(584);
    expect(p.guide!.x1).toBe(500);
    expect(p.guide!.x2 - p.guide!.x1).toBeGreaterThanOrEqual(30);
    const q = placeCard({ ...base, anchor: { x: 1100, y: 450 } });
    expect(q.side).toBe('left');
    expect(q.left + card.width).toBe(1016);
  });
  it('never covers the asset or another plate', () => {
    for (const anchor of [
      { x: 700, y: 120 },
      { x: 900, y: 600 },
      { x: 300, y: 780 },
    ]) {
      const p = placeCard({ ...base, anchor });
      const box = { left: p.left, top: p.top, right: p.left + 372, bottom: p.top + 520 };
      if (p.mode === 'float') {
        for (const plate of plates) expect(intersects(box, plate)).toBe(false);
        expect(
          anchor.x > box.left - 16 &&
            anchor.x < box.right + 16 &&
            anchor.y > box.top - 16 &&
            anchor.y < box.bottom + 16,
        ).toBe(false);
      }
      expect(box.bottom).toBeLessThanOrEqual(830);
    }
  });
  it('moves off a plate that would sit under it', () => {
    const panel: Box = { left: 900, top: 100, right: 1300, bottom: 300 };
    const p = placeCard({ ...base, obstacles: [...plates, panel], anchor: { x: 850, y: 200 } });
    const box = { left: p.left, top: p.top, right: p.left + 372, bottom: p.top + 520 };
    expect(intersects(box, panel)).toBe(false);
  });
  it('leaves Radio’s results in sight, or docks when it cannot', () => {
    const free = placeCard({ ...base, anchor: { x: 500, y: 300 } });
    // A result right where the card would float: it goes elsewhere, clear of it.
    const result = { x: free.left + 150, y: free.top + 200 };
    const p = placeCard({ ...base, anchor: { x: 500, y: 300 }, keep: [result] });
    const box = { left: p.left, top: p.top, right: p.left + 372, bottom: p.top + 520 };
    if (p.mode === 'float')
      expect(
        result.x > box.left - 28 &&
          result.x < box.right + 28 &&
          result.y > box.top - 28 &&
          result.y < box.bottom + 28,
      ).toBe(false);
    expect(p).not.toEqual(free);
    // Results on both sides of the asset: no floating spot leaves them in sight.
    const both = placeCard({
      ...base,
      anchor: { x: 700, y: 400 },
      keep: [
        { x: 1000, y: 200 },
        { x: 1000, y: 600 },
        { x: 400, y: 200 },
        { x: 400, y: 600 },
      ],
    });
    expect(both.mode).toBe('dock');
  });
  it('docks to the right when there is no room, off screen or on a narrow screen', () => {
    const tall = placeCard({
      ...base,
      card: { width: 372, height: 820 },
      anchor: { x: 500, y: 300 },
    });
    expect(tall).toEqual({ mode: 'dock', left: 1056, top: 108 });
    expect(placeCard({ ...base, anchor: null }).mode).toBe('dock');
    expect(placeCard({ ...base, anchor: { x: -40, y: 300 } }).mode).toBe('dock');
    expect(
      placeCard({ ...base, viewport: { width: 900, height: 900 }, anchor: { x: 300, y: 300 } })
        .mode,
    ).toBe('dock');
  });
});

describe('edge chips', () => {
  const free: Box = { left: 12, top: 104, right: 1428, bottom: 830 };
  const size = { width: 180, height: 22 };
  it('sits where the line to the target crosses the edge of the free area', () => {
    const chip = edgeChip(free, size, { x: 720, y: -400 }, 0)!;
    expect(chip.side).toBe('top');
    expect(chip.top).toBe(104);
    expect(chip.left + 90).toBeCloseTo(720, 0);
    expect(chip.angle).toBeCloseTo(0, 5);
    const right = edgeChip(free, size, { x: 2000, y: 467 }, 0)!;
    expect(right.side).toBe('right');
    expect(right.left).toBe(1428 - 180);
    expect(right.angle).toBeCloseTo(90, 5);
  });
  it('uses the bearing for a target behind the camera', () => {
    const behind = edgeChip(free, size, null, 180)!;
    expect(behind.side).toBe('bottom');
    expect(behind.top).toBe(830 - 22);
    expect(behind.angle).toBeCloseTo(180, 5);
    const left = edgeChip(free, size, null, 270)!;
    expect(left.side).toBe('left');
    expect(left.left).toBe(12);
  });
  it('is not needed for a target in the free area', () => {
    expect(edgeChip(free, size, { x: 600, y: 500 }, 0)).toBeNull();
  });
  it('keeps chips on the same edge apart', () => {
    const a = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    const b = edgeChip(free, size, { x: 2000, y: 405 }, 0)!;
    const [p, q] = separate(
      [
        { ...a, ...size },
        { ...b, ...size },
      ],
      free,
    );
    expect(
      intersects(
        { left: p!.left, top: p!.top, right: p!.left + 180, bottom: p!.top + 22 },
        { left: q!.left, top: q!.top, right: q!.left + 180, bottom: q!.top + 22 },
      ),
    ).toBe(false);
  });
  it('gives the bearing and the compass point', () => {
    const torrelago = { lat: 41.589, lng: -4.7252 };
    expect(bearing(torrelago, { lat: 41.6, lng: -4.7252 })).toBeCloseTo(0, 5);
    expect(bearing(torrelago, { lat: 41.589, lng: -4.7 })).toBeCloseTo(90, 0);
    expect(compass(bearing(torrelago, { lat: 41.58, lng: -4.735 }))).toBe('SO');
    expect(compass(359)).toBe('N');
    expect(compass(135)).toBe('SE');
  });
});
