// Radio's labels on screen, without Cesium: the ring draws them (radius-ring.ts), the floating
// asset card keeps the distances in sight (asset-card.tsx) and the installation labels, the tags and
// the edge chips keep off all of them (scene-marks.ts), so they all take their size from here. The
// distances keep off the plates, the assets' marks and each other (placeDistances).
import { number } from '../../lib/format';

/** The label's offset (px) from the end of its leader: to the right and up (or left and up). */
export const DISTANCE_OFFSET = { x: 10, y: -10 };
/** Height of the step a distance takes further up when beside its leader's end there is a mark. */
export const DISTANCE_STEP = 20;
/** Padding around the text, as Cesium draws the label's background. */
export const DISTANCE_PAD = { x: 5, y: 2 };

export const distanceText = (metres: number) => `${number(metres, 0)} m`;

/**
 * Where a distance label hangs against its leader's end: right and up (the usual), left and up,
 * right or left and below, or right or left a step further up; or nowhere.
 */
export type DistanceSide =
  'right' | 'left' | 'right-below' | 'left-below' | 'right-up' | 'left-up' | 'hidden';
/** The spots tried in order: beside the end above it, below it, then a step further up. */
export const DISTANCE_SIDES: Exclude<DistanceSide, 'hidden'>[] = [
  'right',
  'left',
  'right-below',
  'left-below',
  'right-up',
  'left-up',
];

/** The label's alignment and pixel offset from its leader's end for a side (what Cesium takes). */
export function distanceOffset(side: Exclude<DistanceSide, 'hidden'>) {
  const left = side.startsWith('left');
  const below = side.endsWith('below');
  const x = left ? -DISTANCE_OFFSET.x : DISTANCE_OFFSET.x;
  const y = below
    ? -DISTANCE_OFFSET.y
    : side.endsWith('up')
      ? DISTANCE_OFFSET.y - DISTANCE_STEP
      : DISTANCE_OFFSET.y;
  return {
    horizontal: (left ? 'right' : 'left') as 'left' | 'right',
    vertical: (below ? 'top' : 'bottom') as 'top' | 'bottom',
    x,
    y,
  };
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Page box of a distance label whose leader ends at `at` (11 px mono text, bottom aligned at the
 * offset; to the right of the end, or mirrored to its left), a little generous so a card kept off
 * it never touches the text.
 */
export function distanceLabelBox(
  at: { x: number; y: number },
  metres: number,
  side: Exclude<DistanceSide, 'hidden'> = 'right',
) {
  const width = distanceText(metres).length * 6.7 + 2 * DISTANCE_PAD.x,
    height = 15 + 2 * DISTANCE_PAD.y;
  const o = distanceOffset(side);
  const left =
    o.horizontal === 'right' ? at.x + o.x + DISTANCE_PAD.x - width : at.x + o.x - DISTANCE_PAD.x;
  if (o.vertical === 'top') {
    const top = at.y + o.y - DISTANCE_PAD.y;
    return { left, right: left + width, top, bottom: top + height };
  }
  const bottom = at.y + o.y + DISTANCE_PAD.y;
  return { left, right: left + width, top: bottom - height, bottom };
}

const inside = (box: Box, view: { width: number; height: number }, margin: number) =>
  box.left >= margin &&
  box.top >= margin &&
  box.right <= view.width - margin &&
  box.bottom <= view.height - margin;
const apart = (a: Box, b: Box) =>
  a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;

/**
 * Where a result's distance goes: right of its leader's end, or left of it when the right is under
 * a plate or off the view, or nowhere when both are (the Radio panel lists every distance), so no
 * figure is left half under a plate or cut by the edge of the view.
 */
export function distanceSide(
  at: { x: number; y: number } | null,
  metres: number,
  view: { width: number; height: number },
  plates: Box[],
  margin = 2,
): DistanceSide {
  if (!at) return 'hidden';
  for (const side of ['right', 'left'] as const) {
    const box = distanceLabelBox(at, metres, side);
    if (inside(box, view, margin) && plates.every((p) => apart(box, p))) return side;
  }
  return 'hidden';
}

/** A result's distance to place: the end of its leader on screen (null when behind the camera). */
export interface DistanceEnd {
  id: string;
  at: { x: number; y: number } | null;
  metres: number;
}
/** An asset's mark on screen; the selected asset's with its brackets. */
export interface MarkSpot extends Box {
  id: string;
}

/**
 * Where every result's distance goes: nearest results first (the order of the Radio panel), each at
 * the first of DISTANCE_SIDES that stays inside the view and clear of the plates, of `fixed` boxes
 * (the radius label), of the other assets' marks (a mark under a figure hides the asset, a figure
 * under a mark loses digits: «158 m» read «8 m») and of the distances already placed. A distance
 * with no such spot is not written (the Radio panel lists them all). Its own mark is where its
 * leader ends, so the label beside it never counts as covering it.
 */
export function placeDistances(
  ends: DistanceEnd[],
  view: { width: number; height: number },
  plates: Box[],
  marks: MarkSpot[] = [],
  fixed: Box[] = [],
  margin = 2,
) {
  const result = new Map<string, DistanceSide>();
  const placed: Box[] = [];
  const order = [...ends].sort((a, b) => a.metres - b.metres || (a.id < b.id ? -1 : 1));
  for (const end of order) {
    const { at } = end;
    if (!at) {
      result.set(end.id, 'hidden');
      continue;
    }
    const avoid = [...plates, ...fixed, ...placed, ...marks.filter((m) => m.id !== end.id)];
    const side = DISTANCE_SIDES.find((s) => {
      const box = distanceLabelBox(at, end.metres, s);
      return inside(box, view, margin) && avoid.every((p) => apart(box, p));
    });
    result.set(end.id, side ?? 'hidden');
    if (side) placed.push(distanceLabelBox(at, end.metres, side));
  }
  return result;
}

/** Pixels between the ring and the nearest edge of the radius label. */
export const RING_LABEL_LIFT = 6;
/** Size of «r = 300 m · 5 activos dentro» (12 px mono with 7 × 4 px of padding), a little generous. */
export const ringLabelSize = (text: string) => ({
  width: Math.ceil(text.length * 7.3 + 14),
  height: 24,
});

/**
 * Where the radius label sits against its point on the ring: centred above it (the usual), centred
 * below it, or off one of its corners, so that a ring running across the view at a slant (seen
 * from a low camera) does not cross the text.
 */
export type RingAnchor =
  'above' | 'below' | 'above-right' | 'above-left' | 'below-right' | 'below-left';
export const RING_ANCHORS: RingAnchor[] = [
  'above',
  'below',
  'above-right',
  'above-left',
  'below-right',
  'below-left',
];

/** The label's alignment and pixel offset for an anchor (what Cesium's label takes). */
export function ringAnchorOffset(anchor: RingAnchor) {
  const up = anchor.startsWith('above');
  const h = anchor.endsWith('right') ? 'left' : anchor.endsWith('left') ? 'right' : 'center';
  return {
    horizontal: h as 'left' | 'right' | 'center',
    vertical: (up ? 'bottom' : 'top') as 'bottom' | 'top',
    x: h === 'left' ? RING_LABEL_LIFT : h === 'right' ? -RING_LABEL_LIFT : 0,
    y: up ? -RING_LABEL_LIFT : RING_LABEL_LIFT,
  };
}

/** Box of the radius label drawn against its point `at` on the ring. */
export function ringLabelBox(
  at: { x: number; y: number },
  text: string,
  anchor: RingAnchor = 'above',
) {
  const { width, height } = ringLabelSize(text);
  const o = ringAnchorOffset(anchor);
  const x = at.x + o.x,
    y = at.y + o.y;
  const left = o.horizontal === 'left' ? x : o.horizontal === 'right' ? x - width : x - width / 2;
  const top = o.vertical === 'top' ? y : y - height;
  return { left, right: left + width, top, bottom: top + height };
}
