// Radio's labels on screen, without Cesium: the ring draws them (radius-ring.ts), the floating
// asset card keeps the distances in sight (asset-card.tsx) and the installation labels, the tags and
// the edge chips keep off all of them (scene-marks.ts), so they all take their size from here.
import { number } from '../../lib/format';

/** The label's offset (px) from the end of its leader: to the right and up (or left and up). */
export const DISTANCE_OFFSET = { x: 10, y: -10 };
/** Padding around the text, as Cesium draws the label's background. */
export const DISTANCE_PAD = { x: 5, y: 2 };

export const distanceText = (metres: number) => `${number(metres, 0)} m`;

/** Which side of its leader's end a distance label hangs, or none when neither is in sight. */
export type DistanceSide = 'right' | 'left' | 'hidden';

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
  side: DistanceSide = 'right',
) {
  const width = distanceText(metres).length * 6.7 + 2 * DISTANCE_PAD.x,
    height = 15 + 2 * DISTANCE_PAD.y;
  const left =
    side === 'left'
      ? at.x - DISTANCE_OFFSET.x + DISTANCE_PAD.x - width
      : at.x + DISTANCE_OFFSET.x - DISTANCE_PAD.x;
  const bottom = at.y + DISTANCE_OFFSET.y + DISTANCE_PAD.y;
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
