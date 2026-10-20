import { describe, expect, it } from 'vitest';
import {
  bearing,
  chipTargets,
  compass,
  edgeChip,
  intersects,
  MAX_CHIPS,
  outOfSight,
  pickChips,
  placeChips,
  placeCard,
  separate,
  shownShare,
  type Box,
} from './placement';
import { distanceLabelBox } from '../section/radius-label';
import { coveredEdges } from '../digital-twin/camera';

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
  it('leaves a result’s distance label in sight, not only its point', () => {
    const free = placeCard({ ...base, anchor: { x: 500, y: 300 } });
    expect(free.mode).toBe('float');
    // A result 40 px left of where the card would float: the point alone is clear of the card
    // with its 28 px, but its label («65 m», to the right of it) would be under the card's edge.
    const result = { x: free.left - 40, y: free.top + 200 };
    const label = distanceLabelBox(result, 65);
    expect(label.right).toBeGreaterThan(free.left);
    expect(placeCard({ ...base, anchor: { x: 500, y: 300 }, keep: [result] })).toEqual(free);
    const p = placeCard({ ...base, anchor: { x: 500, y: 300 }, keep: [result, label] });
    const box = { left: p.left, top: p.top, right: p.left + 372, bottom: p.top + 520 };
    expect(p).not.toEqual(free);
    if (p.mode === 'float') expect(intersects(box, label)).toBe(false);
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
  it('is only for what is out of sight, not for what shows between plates', () => {
    const viewport = { width: 1440, height: 900 };
    // Medir open on the left: the framing counts the whole left band as covered.
    const plates: Box[] = [
      { left: 12, top: 12, right: 380, bottom: 96 },
      { left: 12, top: 200, right: 372, bottom: 520 },
    ];
    // Visible in the left band, below the panel: its mark and tag are on screen.
    expect(outOfSight({ x: 200, y: 700 }, viewport, plates)).toBe(false);
    // Under the panel, or half under its edge.
    expect(outOfSight({ x: 200, y: 300 }, viewport, plates)).toBe(true);
    expect(outOfSight({ x: 376, y: 300 }, viewport, plates)).toBe(true);
    // Off the screen or behind the camera.
    expect(outOfSight({ x: -20, y: 300 }, viewport, plates)).toBe(true);
    expect(outOfSight({ x: 700, y: 950 }, viewport, plates)).toBe(true);
    expect(outOfSight(null, viewport, plates)).toBe(true);
  });
  it('measures how much of a tag or label shows, so one in sight needs no chip', () => {
    const viewport = { width: 1440, height: 900 };
    const annunciator: Box = { left: 12, top: 12, right: 900, bottom: 52 };
    // A tag just below the annunciator: its mark's centre may sit on the plate's edge, but the
    // tag itself shows whole.
    expect(
      shownShare({ left: 600, top: 56, right: 700, bottom: 76 }, viewport, [annunciator]),
    ).toBe(1);
    // Half under the plate.
    expect(
      shownShare({ left: 600, top: 42, right: 700, bottom: 62 }, viewport, [annunciator]),
    ).toBeCloseTo(1 / 3, 5);
    // Under two plates that overlap each other: counted once, nothing shows.
    const panel: Box = { left: 500, top: 30, right: 800, bottom: 300 };
    expect(
      shownShare({ left: 600, top: 20, right: 700, bottom: 40 }, viewport, [annunciator, panel]),
    ).toBe(0);
    // Half off the screen.
    expect(shownShare({ left: 1400, top: 400, right: 1480, bottom: 420 }, viewport, [])).toBe(0.5);
    expect(shownShare({ left: 10, top: 10, right: 10, bottom: 30 }, viewport, [])).toBe(0);
  });
  it('shows the most urgent chips first and counts the rest', () => {
    const chips = [
      { id: 'installation far', rank: 3, distance: 900 },
      { id: 'radius', rank: 2, distance: 65 },
      { id: 'installation near', rank: 3, distance: 90 },
      { id: 'warning', rank: 1, distance: 400 },
      { id: 'critical', rank: 0, distance: 1200 },
    ];
    const { shown, more } = pickChips(chips, (c) => c.rank);
    expect(shown.map((c) => c.id)).toEqual(['critical', 'warning', 'radius']);
    expect(shown).toHaveLength(MAX_CHIPS);
    expect(more).toBe(2);
    const every = pickChips(chips, (c) => c.rank, true);
    expect(every.shown).toHaveLength(5);
    expect(every.more).toBe(0);
    expect(every.shown[3]!.id).toBe('installation near');
    expect(pickChips(chips.slice(0, 2), (c) => c.rank).more).toBe(0);
  });
  it('slides a chip out from behind a floating card, and keeps chips apart', () => {
    // The card floats beside its asset; a chip on the right edge lands behind it.
    const card: Box = { left: 1000, top: 114, right: 1372, bottom: 672 };
    const chip = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    expect(intersects({ ...chip, right: chip.left + 180, bottom: chip.top + 22 }, card)).toBe(true);
    const [moved, next] = placeChips(
      [
        { ...chip, ...size },
        { ...chip, ...size },
      ],
      free,
      [card],
    );
    for (const c of [moved!, next!]) {
      const box = { left: c.left, top: c.top, right: c.left + 180, bottom: c.top + 22 };
      expect(intersects(box, card)).toBe(false);
      expect(box.top).toBeGreaterThanOrEqual(free.top);
      expect(box.bottom).toBeLessThanOrEqual(free.bottom);
    }
    expect(
      intersects(
        { left: moved!.left, top: moved!.top, right: moved!.left + 180, bottom: moved!.top + 22 },
        { left: next!.left, top: next!.top, right: next!.left + 180, bottom: next!.top + 22 },
      ),
    ).toBe(false);
    // The nearest free spot: just below the card.
    expect(moved!.top).toBe(card.bottom + 4);
  });
  it('slides a chip off a distance Radio writes in the scene', () => {
    // «180 m» at the end of a result's leader, right where a chip on the left edge would sit.
    const chip = edgeChip(free, size, { x: -600, y: 290 }, 0)!;
    const label = distanceLabelBox({ x: free.left + 20, y: chip.top + 25 }, 180);
    const box = (c: { left: number; top: number }) => ({
      left: c.left,
      top: c.top,
      right: c.left + size.width,
      bottom: c.top + size.height,
    });
    expect(intersects(box(chip), label)).toBe(true);
    const [placed] = placeChips([{ ...chip, ...size }], free, [label]);
    expect(placed!.side).toBe('left');
    expect(intersects(box(placed!), label)).toBe(false);
  });
  it('slides a chip off an asset’s mark, but never goes missing for one', () => {
    // A critical asset's mark (22 px) right where the chip of a far installation would land.
    const chip = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    const mark: Box = {
      left: chip.left + 40,
      top: chip.top,
      right: chip.left + 62,
      bottom: chip.top + 22,
    };
    const box = (c: { left: number; top: number }) => ({
      left: c.left,
      top: c.top,
      right: c.left + size.width,
      bottom: c.top + size.height,
    });
    const [placed] = placeChips([{ ...chip, ...size }], free, [], [mark]);
    expect(intersects(box(placed!), mark)).toBe(false);
    // An edge full of marks: the chip stays where it was, over them.
    const marks = Array.from({ length: 60 }, (_, i) => ({
      left: chip.left,
      right: chip.left + size.width,
      top: free.top + i * 15,
      bottom: free.top + i * 15 + 22,
    }));
    const [kept] = placeChips([{ ...chip, ...size }], free, [], marks);
    expect(kept).toMatchObject({ left: chip.left, top: chip.top });
  });
  it('slides a chip off an installation label, but gives the label up before a mark', () => {
    const chip = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    const box = (c: { left: number; top: number }) => ({
      left: c.left,
      top: c.top,
      right: c.left + size.width,
      bottom: c.top + size.height,
    });
    // An installation label reaching to the right edge, where the chip would go (the counts line
    // of Torrelago under the depósito's chip while the camera flew).
    const label: Box = {
      left: chip.left - 80,
      right: chip.left + 120,
      top: chip.top - 10,
      bottom: chip.top + 26,
    };
    const [clear] = placeChips([{ ...chip, ...size }], free, [], [], [label]);
    expect(intersects(box(clear!), label)).toBe(false);
    // With marks filling the rest of the edge, the mark wins: the chip stays on the label.
    const marks = Array.from({ length: 60 }, (_, i) => ({
      left: chip.left,
      right: chip.left + size.width,
      top: free.top + i * 15,
      bottom: free.top + i * 15 + 22,
    })).filter((m) => !intersects(m, label));
    const [onLabel] = placeChips([{ ...chip, ...size }], free, [], marks, [label]);
    expect(onLabel).not.toBeNull();
    expect(marks.some((m) => intersects(box(onLabel!), m, 3))).toBe(false);
  });
  it('slides a chip off an asset tag too, but gives the tag up before a label', () => {
    const chip = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    const box = (c: { left: number; top: number }) => ({
      left: c.left,
      top: c.top,
      right: c.left + size.width,
      bottom: c.top + size.height,
    });
    // A sensor's tag where the chip would go (the south tower's tag under the depósito's chip
    // while the camera flew to an asset at 900 x 1200).
    const tag: Box = {
      left: chip.left - 60,
      right: chip.left + 40,
      top: chip.top,
      bottom: chip.top + 22,
    };
    const [clear] = placeChips([{ ...chip, ...size }], free, [], [], [], [tag]);
    expect(intersects(box(clear!), tag)).toBe(false);
    // With labels on the rest of the edge, the label wins: the chip stays on the tag.
    const labels = Array.from({ length: 60 }, (_, i) => ({
      left: chip.left,
      right: chip.left + size.width,
      top: free.top + i * 15,
      bottom: free.top + i * 15 + 22,
    })).filter((l) => !intersects(l, tag));
    const [onTag] = placeChips([{ ...chip, ...size }], free, [], [], labels, [tag]);
    expect(onTag).not.toBeNull();
    expect(labels.some((l) => intersects(box(onTag!), l, 3))).toBe(false);
  });
  it('leaves a chip out when its whole edge is covered', () => {
    const wall: Box = { left: 1000, top: 0, right: 1440, bottom: 900 };
    const chip = edgeChip(free, size, { x: 2000, y: 400 }, 0)!;
    expect(placeChips([{ ...chip, ...size }], free, [wall])).toEqual([null]);
  });
});

describe('a critical asset under a plate on a phone with a sheet open', () => {
  // The check's phone (390 × 844) after a tap on «Centro de transformación · Torrelago», the sheet
  // at 45 %: the gateway of the south tower, critical, has its mark at (168, 417) under the credits
  // strip above the sheet, and its tag found no spot clear of the other marks.
  const phone = { width: 390, height: 844 };
  const plates: Box[] = [
    { left: 10, top: 10, right: 380, bottom: 150 }, // top plate with the annunciator row
    { left: 10, top: 159, right: 170, bottom: 201 }, // scale
    { left: 261, top: 159, right: 380, bottom: 201 }, // heading
    { left: 10, top: 401, right: 380, bottom: 456 }, // credits
    { left: 10, top: 464, right: 380, bottom: 768 }, // the asset sheet
    { left: 10, top: 776, right: 380, bottom: 834 }, // tool bar
  ];
  const gateway = { x: 168, y: 417 };
  const edges = coveredEdges({ left: 0, top: 0, right: 390, bottom: 844 }, plates);
  const free: Box = {
    left: Math.max(12, edges.left + 8),
    top: Math.max(12, edges.top + 8),
    right: 390 - Math.max(12, edges.right + 8),
    bottom: 844 - Math.max(12, edges.bottom + 8),
  };
  const targets = [
    { key: 'i:Torrelago' },
    { key: 'i:Depósito elevado del cerro' },
    { key: 'a:Grupo de presión', status: 'warning' },
    { key: 'a:Pasarela LoRa · torre sur', status: 'critical' },
  ];

  it('keeps only the critical assets among the targets, and every target without a sheet', () => {
    expect(chipTargets(targets, true).map((t) => t.key)).toEqual(['a:Pasarela LoRa · torre sur']);
    expect(chipTargets(targets, false)).toEqual(targets);
  });

  it('puts its chip on the free edge nearest its mark, clear of the selected brackets', () => {
    // Under the credits, so out of sight, and the area above the sheet is room enough for chips.
    expect(outOfSight(gateway, phone, plates)).toBe(true);
    expect(free.bottom).toBeLessThanOrEqual(401 - 8);
    expect(free.bottom - free.top).toBeGreaterThanOrEqual(120);
    const size = { width: 268, height: 24 };
    const chip = edgeChip(free, size, gateway, 0)!;
    expect(chip.side).toBe('bottom');
    // The selected mark of the transformer with its brackets (28 px) is a mark it keeps off.
    const brackets: Box = { left: 181, top: 337, right: 209, bottom: 365 };
    const [placed] = placeChips([{ ...chip, ...size }], free, plates, [brackets]);
    expect(placed).not.toBeNull();
    const box = {
      left: placed!.left,
      top: placed!.top,
      right: placed!.left + size.width,
      bottom: placed!.top + size.height,
    };
    expect(plates.some((p) => intersects(box, p))).toBe(false);
    expect(intersects(box, brackets)).toBe(false);
  });

  it('never covers the selected mark: off the edge when the edge has no room beside it', () => {
    // Without relief a note sits above the credits: the free area is a strip from 168 to 339 px
    // and the selected mark, with its brackets, is at its bottom edge, where the chip goes.
    const strip: Box = { left: 12, top: 168, right: 378, bottom: 339 };
    const brackets: Box = { left: 176, top: 313, right: 204, bottom: 341 };
    const size = { width: 268, height: 24 };
    const chip = edgeChip(strip, size, { x: 160, y: 411 }, 0)!;
    expect(chip.side).toBe('bottom');
    const box = (c: { left: number; top: number }) => ({
      left: c.left,
      top: c.top,
      right: c.left + size.width,
      bottom: c.top + size.height,
    });
    // As a mark only, the chip ends over it: no spot along the edge is clear of it.
    const [over] = placeChips([{ ...chip, ...size }], strip, [], [brackets]);
    expect(intersects(box(over!), brackets)).toBe(true);
    // Kept clear: the chip steps up off the edge, just above the brackets, inside the strip.
    const [placed] = placeChips([{ ...chip, ...size }], strip, [], [], [], [], [brackets]);
    expect(placed).not.toBeNull();
    expect(intersects(box(placed!), brackets, 3)).toBe(false);
    expect(placed!.top).toBe(313 - 4 - 24);
    expect(placed!.top).toBeGreaterThanOrEqual(strip.top);
  });
});
