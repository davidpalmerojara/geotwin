import { describe, expect, it } from 'vitest';
import { chipLeft, drawProfile, PLOT_MARGIN, xOf, type PlotFrame } from './profile-plot';
import type { ProfilePoints } from './section-math';

type Call = { op: string; args: unknown[]; fill: string };
/** A 2D context that records what is drawn, with the fill style at the time. */
function recorder() {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { fillStyle: '', strokeStyle: '', font: '' };
  for (const op of ['fillRect', 'fillText', 'clearRect', 'stroke', 'beginPath', 'moveTo'])
    ctx[op] = (...args: unknown[]) => calls.push({ op, args, fill: String(ctx.fillStyle) });
  for (const op of ['setTransform', 'lineTo', 'arc', 'setLineDash']) ctx[op] = () => undefined;
  // 7 px per character, as Plex Mono at 12 px.
  ctx.measureText = (text: string) => ({ width: text.length * 7 });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// A 336,2 m line drawn 1:1 in a 960 × 240 px canvas, with a 38 m building near its middle.
const frame: PlotFrame = { width: 960, height: 240, pxm: 2.7, exaggeration: 1, lo: 690 };
const n = 400;
const points: ProfilePoints = {
  count: n,
  s: Float64Array.from({ length: n }, (_, i) => 150 + (i % 40) * 0.5),
  d: new Float32Array(n),
  z: Float32Array.from({ length: n }, (_, i) => 700 + (i / n) * 40),
  cls: new Uint8Array(n).fill(6),
  rgb: new Uint32Array(n).fill(0xffffff),
};
const input = {
  frame,
  length: 336.2,
  half: 1.5,
  points,
  dtm: { s: [0, 336.2], h: [700, 701] },
  buildings: [{ label: 'E2', s0: 150, s1: 170, roof: 738, ground: 700.1, height: 37.9, at: 160 }],
  color: 'rgb' as const,
  ratio: 1,
};

describe('the profile plot', () => {
  it('keeps the cursor chip inside the plot at either end of the line', () => {
    const plotRight = Math.min(frame.width - PLOT_MARGIN.right, xOf(frame, 336.2));
    for (const s of [0, 336.2]) {
      const { ctx, calls } = recorder();
      drawProfile(ctx, { ...input, cursor: { s, point: null } });
      const chip = calls.find((c) => c.op === 'fillRect' && c.fill === '#ffd21a')!;
      const [left, , width] = chip.args as number[];
      expect(left).toBeGreaterThanOrEqual(PLOT_MARGIN.left);
      expect(left! + width!).toBeLessThanOrEqual(plotRight);
      // The value is written in the middle of the chip.
      const text = calls.find((c) => c.op === 'fillText' && c.fill === '#191500')!;
      expect(text.args[1]).toBe(left! + width! / 2);
    }
    expect(chipLeft(500, 48, 46, 900)).toBe(476);
  });

  it('writes the heights on a plate drawn over the points, so they stay readable', () => {
    const { ctx, calls } = recorder();
    drawProfile(ctx, { ...input, cursor: null });
    // The points are 2 px squares: the last one drawn.
    const lastPoint = calls.reduce(
      (last, c, i) => (c.op === 'fillRect' && c.args[2] === 2 ? i : last),
      -1,
    );
    expect(lastPoint).toBeGreaterThan(0);
    for (const value of ['E2', '37,9']) {
      const text = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === value);
      expect(text).toBeGreaterThan(lastPoint);
      // Right before it, a plate of the drawer's ink that covers the whole text.
      const plate = calls[text - 1]!;
      expect(plate.op).toBe('fillRect');
      expect(plate.fill).toBe('#161615');
      const [left, top, width, height] = plate.args as number[];
      const [, x, y] = calls[text]!.args as number[];
      expect(left).toBeLessThan(x!);
      expect(left! + width!).toBeGreaterThanOrEqual(x! + value.length * 7);
      expect(top).toBeLessThan(y! - 6);
      expect(top! + height!).toBeGreaterThan(y! + 6);
    }
  });
});
