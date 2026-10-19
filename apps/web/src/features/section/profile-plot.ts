/**
 * Draws the profile on a 2D canvas: a 1:1 section (the same metres per pixel on both axes, times
 * the vertical exaggeration), the DTM line, the points in their colour or their class colour
 * (fainter the farther from the plane), the buildings' heights and the cursor.
 */
import { ASPRS_CLASSES } from '../layers/point-style';
import { TOKENS } from '../../styles/tokens';
import { number } from '../../lib/format';
import { axisStep, fade, type Building, type DtmLine, type ProfilePoints } from './section-math';

export const PLOT_MARGIN = { left: 46, right: 18, top: 22, bottom: 24 };

export interface PlotFrame {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Horizontal pixels per metre (vertical is this times the exaggeration). */
  pxm: number;
  exaggeration: number;
  /** Altitude at the bottom of the plot area. */
  lo: number;
}
export const xOf = (f: PlotFrame, s: number) => PLOT_MARGIN.left + s * f.pxm;
export const yOf = (f: PlotFrame, z: number) =>
  f.height - PLOT_MARGIN.bottom - (z - f.lo) * f.pxm * f.exaggeration;
export const sOf = (f: PlotFrame, x: number) => (x - PLOT_MARGIN.left) / f.pxm;
export const zOf = (f: PlotFrame, y: number) =>
  f.lo + (f.height - PLOT_MARGIN.bottom - y) / (f.pxm * f.exaggeration);

/**
 * Left edge of the cursor's distance chip (`width` px wide, centred on the cursor at `x`), kept
 * inside the plot between `lo` and `hi`: at A or B a centred chip would hang off the plot and be
 * cut by the canvas edge.
 */
export function chipLeft(x: number, width: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(x - width / 2, hi - width));
}

/** Padding (px) of the dark plate under a value written over the points. */
export const VALUE_PAD = { x: 3, y: 2 };

/**
 * Writes a value over the plot on a plate of the drawer's ink, so the points behind (a building's
 * roof and walls) never run through its digits. The text is left aligned at `x`, its middle at `y`.
 */
function plateText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  const width = ctx.measureText(text).width;
  ctx.fillStyle = TOKENS['ink-1'];
  ctx.fillRect(x - VALUE_PAD.x, y - 7 - VALUE_PAD.y, width + 2 * VALUE_PAD.x, 14 + 2 * VALUE_PAD.y);
  ctx.fillStyle = TOKENS['fg-1'];
  ctx.fillText(text, x, y);
}

const classColor = (cls: number) => ASPRS_CLASSES[cls]?.color ?? '#9aa5b1';
const rgbCss = (rgb: number, alpha: number) =>
  `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${alpha.toFixed(2)})`;

export interface PlotInput {
  frame: PlotFrame;
  length: number;
  half: number;
  points: ProfilePoints;
  dtm: DtmLine;
  buildings: Building[];
  color: 'rgb' | 'class';
  /** The cursor: distance from A, and the point under it (index) if any. */
  cursor: { s: number; point: number | null } | null;
  /** Pixel ratio of the screen. */
  ratio: number;
}

export function drawProfile(ctx: CanvasRenderingContext2D, input: PlotInput) {
  const { frame: f, length, half, points, dtm, buildings, color, cursor, ratio } = input;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  ctx.fillStyle = TOKENS['ink-1'];
  ctx.fillRect(0, 0, f.width, f.height);
  const plotTop = PLOT_MARGIN.top,
    plotBottom = f.height - PLOT_MARGIN.bottom,
    plotRight = Math.min(f.width - PLOT_MARGIN.right, xOf(f, length));
  ctx.font = '400 11px "IBM Plex Mono", monospace';
  ctx.textBaseline = 'middle';

  // Grid: altitudes on the left, distances along the bottom, round steps.
  const zStep = axisStep(f.pxm * f.exaggeration, 32);
  const zTop = zOf(f, plotTop);
  ctx.strokeStyle = TOKENS.rule;
  ctx.lineWidth = 1;
  ctx.fillStyle = TOKENS['fg-1'];
  ctx.textAlign = 'right';
  for (let z = Math.ceil(f.lo / zStep) * zStep; z <= zTop; z += zStep) {
    const y = Math.round(yOf(f, z)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PLOT_MARGIN.left, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillText(number(z, 0), PLOT_MARGIN.left - 6, y);
  }
  ctx.fillText('m', PLOT_MARGIN.left - 6, plotTop - 12);
  const sStep = axisStep(f.pxm, 90);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let s = 0; s <= length + 1e-6; s += sStep) {
    const x = Math.round(xOf(f, s)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    if (xOf(f, length) - x > 40) ctx.fillText(number(s, 0), x, plotBottom + 6);
  }
  ctx.textAlign = 'right';
  ctx.fillText(`${number(length, 1)} m`, plotRight, plotBottom + 6);

  // Points: small squares, fainter with the distance from the plane.
  for (let i = 0; i < points.count; i++) {
    const x = xOf(f, points.s[i]!),
      y = yOf(f, points.z[i]!);
    if (y < plotTop - 2 || y > plotBottom + 2) continue;
    const alpha = fade(points.d[i]!, half);
    if (color === 'rgb') ctx.fillStyle = rgbCss(points.rgb[i]!, alpha);
    else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = classColor(points.cls[i]!);
    }
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;

  // The DTM: a light line, broken where the model has no data.
  ctx.strokeStyle = TOKENS['fg-0'];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  dtm.s.forEach((s, k) => {
    const h = dtm.h[k];
    if (h == null) {
      pen = false;
      return;
    }
    const x = xOf(f, s),
      y = yOf(f, h);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  });
  ctx.stroke();

  // Building heights: a vertical dimension from the DTM to the roof, with E1… and the value.
  ctx.textBaseline = 'middle';
  for (const b of buildings) {
    const x = Math.round(xOf(f, b.s1) + 6) + 0.5;
    const top = yOf(f, b.roof),
      bottom = yOf(f, b.ground);
    ctx.strokeStyle = TOKENS['fg-1'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top);
    ctx.moveTo(x - 4, top);
    ctx.lineTo(x + 4, top);
    ctx.moveTo(x - 4, bottom);
    ctx.lineTo(x + 4, bottom);
    ctx.stroke();
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(xOf(f, b.s0), top + 0.5);
    ctx.lineTo(x, top + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    plateText(ctx, b.label, xOf(f, b.s0), Math.max(plotTop + 6, top - 9));
    plateText(ctx, number(b.height, 1), x + 6, (top + bottom) / 2);
  }

  // The cursor: a yellow line, the distance on a yellow label and a ring on the point.
  if (cursor) {
    const x = Math.round(xOf(f, cursor.s)) + 0.5;
    ctx.strokeStyle = TOKENS.sig;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    const text = number(cursor.s, 1);
    ctx.font = '500 12px "IBM Plex Mono", monospace';
    const w = ctx.measureText(text).width + 10;
    // Over the cursor, but inside the plot at either end of the line.
    const left = chipLeft(x, w, PLOT_MARGIN.left, plotRight);
    ctx.fillStyle = TOKENS.sig;
    ctx.fillRect(left, 2, w, 17);
    ctx.fillStyle = TOKENS['sig-ink'];
    ctx.textAlign = 'center';
    ctx.fillText(text, left + w / 2, 11);
    if (cursor.point !== null) {
      const y = yOf(f, points.z[cursor.point]!);
      ctx.strokeStyle = TOKENS.sig;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(xOf(f, points.s[cursor.point]!), y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/**
 * The point under the pointer: the closest within `px` pixels, else the highest point within
 * half a metre of the cursor's distance (what the eye reads at that place), else none.
 */
export function pointAt(f: PlotFrame, points: ProfilePoints, x: number, y: number, px = 10) {
  const s = sOf(f, x);
  let best: number | null = null,
    bestD = px * px;
  let top: number | null = null;
  const tol = Math.max(0.5, px / f.pxm);
  // Points are sorted by s: binary search the window.
  let lo = 0,
    hi = points.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points.s[mid]! < s - tol) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < points.count && points.s[i]! <= s + tol; i++) {
    const dx = xOf(f, points.s[i]!) - x,
      dy = yOf(f, points.z[i]!) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = i;
    }
    if (Math.abs(points.s[i]! - s) <= 0.5 && (top === null || points.z[i]! > points.z[top]!))
      top = i;
  }
  return best ?? top;
}
