// Placement of the installation labels on the map so they neither overlap each other nor sit
// under the floating controls. Pure maths in CSS pixels, no Cesium: unit-tested in Node.
import type { ScreenBox } from './camera';

export interface LabelAnchor {
  id: string;
  /** Anchor on screen (the installation's centre on the ground), px from the canvas corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Offset (px) from the anchor to the label's centre; `null` when the label is hidden. */
export type LabelOffset = { x: number; y: number } | null;

/** Vertical offsets tried in order: below the area's centre, above it, further below. */
export const LABEL_OFFSETS = [50, -34, 78];
/**
 * Further out, tried only to keep the asset markers uncovered: the marks are drawn over the scene,
 * so a label under one loses the letters behind it (a dense network seen whole on a phone).
 */
export const FAR_OFFSETS = [-62, 106];
const GAP = 4;

export const overlaps = (a: ScreenBox, b: ScreenBox) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** How much of `b` a box covers, in px². */
const covered = (a: ScreenBox, b: ScreenBox) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

export interface LabelOptions {
  /** Distance (px) kept from every edge of the view: the HUD's inset, as the plates keep. */
  inset?: number;
  offsets?: number[];
  far?: number[];
}

/**
 * Places each label (in order of priority) at the first free spot: below or above its anchor,
 * slid sideways past whatever is in the way as long as it still spans its anchor, and inside the
 * view, `inset` px from its edges. `soft` obstacles (the asset markers, what a profile draws) are
 * avoided when possible, also a step further out (`far`); when no spot is clear of them the label
 * takes the spot that covers the least of them. A label with no spot clear of the plates and of the
 * other labels is hidden rather than drawn on top of another.
 */
export function placeLabels(
  anchors: LabelAnchor[],
  blocked: ScreenBox[],
  view: { width: number; height: number },
  soft: ScreenBox[] = [],
  { inset = 0, offsets = LABEL_OFFSETS, far = FAR_OFFSETS }: LabelOptions = {},
) {
  const placed: ScreenBox[] = [];
  const result = new Map<string, LabelOffset>();
  const spot = (a: LabelAnchor): LabelOffset => {
    const hard = [...blocked, ...placed];
    // The label spans its anchor, or the point of the inset band nearest to it.
    const ax = Math.min(Math.max(a.x, inset), view.width - inset);
    let best: { box: ScreenBox; dy: number; cost: number } | null = null;
    for (const dy of [...offsets, ...far]) {
      const top = a.y + dy - a.height / 2,
        bottom = top + a.height;
      if (top < inset || bottom > view.height - inset) continue;
      // Centred on the anchor, pulled inside the view, then slid past each obstacle in turn.
      const centred = Math.min(Math.max(a.x - a.width / 2, inset), view.width - inset - a.width);
      const lefts = [centred];
      for (const b of [...hard, ...soft])
        if (b.bottom > top && b.top < bottom) lefts.push(b.right + GAP, b.left - GAP - a.width);
      for (const left of lefts) {
        const box = { left, right: left + a.width, top, bottom };
        if (
          left < inset ||
          box.right > view.width - inset ||
          left > ax ||
          box.right < ax ||
          hard.some((b) => overlaps(box, b))
        )
          continue;
        // The nearer offsets come first: a further one only to cover fewer soft obstacles.
        const cost = soft.reduce((sum, b) => sum + covered(box, b), 0);
        if (!best || cost < best.cost) best = { box, dy, cost };
        if (cost === 0) break;
      }
      if (best?.cost === 0) break;
      // Without soft obstacles to weigh, the first free spot is the one.
      if (best && !soft.length) break;
    }
    if (!best) return null;
    placed.push(best.box);
    return { x: best.box.left + a.width / 2 - a.x, y: best.dy };
  };
  for (const a of anchors) {
    const inView = a.x >= 0 && a.x <= view.width && a.y >= 0 && a.y <= view.height;
    result.set(a.id, inView ? spot(a) : null);
  }
  return result;
}
