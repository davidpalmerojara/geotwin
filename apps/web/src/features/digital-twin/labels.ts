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
const GAP = 4;

export const overlaps = (a: ScreenBox, b: ScreenBox) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Places each label (in order of priority) at the first free spot: below or above its anchor,
 * slid sideways past whatever is in the way as long as it still spans its anchor, and inside the
 * view. `soft` obstacles (the asset markers) are avoided when possible and covered only when there
 * is no other spot. A label with no free spot is hidden rather than drawn on top of another.
 */
export function placeLabels(
  anchors: LabelAnchor[],
  blocked: ScreenBox[],
  view: { width: number; height: number },
  soft: ScreenBox[] = [],
  offsets = LABEL_OFFSETS,
) {
  const placed: ScreenBox[] = [];
  const result = new Map<string, LabelOffset>();
  const spot = (a: LabelAnchor, avoid: ScreenBox[]): LabelOffset => {
    for (const dy of offsets) {
      const top = a.y + dy - a.height / 2,
        bottom = top + a.height;
      if (top < 0 || bottom > view.height) continue;
      // Centred on the anchor, pulled inside the view, then slid past each obstacle in turn.
      const centred = Math.min(Math.max(a.x - a.width / 2, 0), view.width - a.width);
      const lefts = [centred];
      for (const b of avoid)
        if (b.bottom > top && b.top < bottom) lefts.push(b.right + GAP, b.left - GAP - a.width);
      const left = lefts.find((left) => {
        const box = { left, right: left + a.width, top, bottom };
        return (
          left >= 0 &&
          box.right <= view.width &&
          left <= a.x &&
          box.right >= a.x &&
          !avoid.some((b) => overlaps(box, b))
        );
      });
      if (left === undefined) continue;
      placed.push({ left, right: left + a.width, top, bottom });
      return { x: left + a.width / 2 - a.x, y: dy };
    }
    return null;
  };
  for (const a of anchors) {
    const inView = a.x >= 0 && a.x <= view.width && a.y >= 0 && a.y <= view.height;
    result.set(
      a.id,
      inView
        ? (spot(a, [...blocked, ...placed, ...soft]) ?? spot(a, [...blocked, ...placed]))
        : null,
    );
  }
  return result;
}
