/**
 * Screen-space layout of the dimension labels drawn in the scene (Medir's values, Perfil's
 * E1…En): pure geometry in canvas pixels, run after every frame by `DimensionLabels`.
 *
 * - A value in the middle of a segment moves off the line, perpendicular to it on screen, so the
 *   line never crosses its own value.
 * - Labels that would overlap one placed before step up or down by one label height (up to two
 *   steps each way); when no step is free a label with a short form («E3» for «E3 · 38,0 m»)
 *   switches to it, as the phone does: the drawer lists the values.
 */
import type { LabelSide } from './dimension-lines';

export interface LabelItem {
  /** The anchor on screen (canvas px). */
  x: number;
  y: number;
  width: number;
  height: number;
  side: LabelSide;
  /** Width of the short form, when the label has one. */
  shortWidth?: number;
  /** The segment the value belongs to, on screen (from one end to the other). */
  segment?: { x: number; y: number };
}
export interface LabelPlace {
  /** Pixel offset from the anchor to the label's origin (as Cesium's `pixelOffset`). */
  dx: number;
  dy: number;
  /** Shown in its short form. */
  compact: boolean;
}

/** Gap between a vertical dimension and the label beside it. */
export const SIDE_GAP = 10;
/** Gap between a segment and its value. */
export const LINE_GAP = 4;
/** Space kept between two labels. */
const LABEL_GAP = 3;
/** Average advance of IBM Plex Mono at 13 px, plus the label's padding on both sides. */
const CHAR_W = 7.8,
  PAD_X = 5,
  PAD_Y = 3;
/** Size of a label of the dimension font (an estimate, the font is monospaced). */
export const labelSize = (text: string, px = 13) => ({
  width: Math.ceil(text.length * CHAR_W * (px / 13) + 2 * PAD_X),
  height: Math.ceil(px * 1.2 + 2 * PAD_Y),
});

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box) =>
  a.left < b.right + LABEL_GAP &&
  b.left < a.right + LABEL_GAP &&
  a.top < b.bottom + LABEL_GAP &&
  b.top < a.bottom + LABEL_GAP;

/**
 * Offset that moves a `width` x `height` label centred on a segment clear of it: along the
 * segment's normal on screen, on the upper side, by the box's reach in that direction plus a gap.
 */
export function clearOfSegment(segment: { x: number; y: number }, width: number, height: number) {
  const length = Math.hypot(segment.x, segment.y);
  if (length < 1e-6) return { dx: 0, dy: 0 };
  let nx = -segment.y / length,
    ny = segment.x / length;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const reach = (Math.abs(nx) * width) / 2 + (Math.abs(ny) * height) / 2 + LINE_GAP;
  return { dx: nx * reach, dy: ny * reach };
}

/** The box a label covers on screen once placed (canvas px). */
export function labelBox(item: LabelItem, place: LabelPlace, width?: number): Box {
  const w =
    width ?? (place.compact && item.shortWidth !== undefined ? item.shortWidth : item.width);
  const x = item.x + place.dx,
    y = item.y + place.dy;
  // The origin is the label's left, right or centre, vertically centred.
  const left = item.side === 'right' ? x : item.side === 'left' ? x - w : x - w / 2;
  return { left, right: left + w, top: y - item.height / 2, bottom: y + item.height / 2 };
}

/** Where each label goes, in the given order (earlier labels keep their place). */
export function layoutLabels(items: LabelItem[], blocked: Box[] = []): LabelPlace[] {
  // What the labels keep clear of besides each other (Perfil's A and B markers).
  const placed: Box[] = [...blocked];
  return items.map((item) => {
    const base = (width: number) => {
      if (item.side === 'center' && item.segment)
        return clearOfSegment(item.segment, width, item.height);
      return { dx: item.side === 'right' ? SIDE_GAP : item.side === 'left' ? -SIDE_GAP : 0, dy: 0 };
    };
    const boxAt = (width: number, dx: number, dy: number) =>
      labelBox(item, { dx, dy, compact: false }, width);
    const step = item.height + LABEL_GAP;
    const steps = [0, -step, step, -2 * step, 2 * step];
    const tryWidth = (width: number) => {
      const { dx, dy } = base(width);
      for (const s of steps) {
        const box = boxAt(width, dx, dy + s);
        if (!placed.some((p) => overlaps(p, box))) return { dx, dy: dy + s, box };
      }
      return null;
    };
    const full = tryWidth(item.width);
    if (full) {
      placed.push(full.box);
      return { dx: full.dx, dy: full.dy, compact: false };
    }
    if (item.shortWidth !== undefined) {
      const short = tryWidth(item.shortWidth);
      const { dx, dy } = short ?? base(item.shortWidth);
      placed.push(short?.box ?? boxAt(item.shortWidth, dx, dy));
      return { dx, dy, compact: true };
    }
    const { dx, dy } = base(item.width);
    placed.push(boxAt(item.width, dx, dy));
    return { dx, dy, compact: false };
  });
}
