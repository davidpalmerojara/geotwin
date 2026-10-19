// Radio's labels on screen, without Cesium: the ring draws them (radius-ring.ts), the floating
// asset card keeps the distances in sight (asset-card.tsx) and the installation labels, the tags and
// the edge chips keep off all of them (scene-marks.ts), so they all take their size from here.
import { number } from '../../lib/format';

/** The label's offset (px) from the end of its leader: to the right and up. */
export const DISTANCE_OFFSET = { x: 10, y: -10 };
/** Padding around the text, as Cesium draws the label's background. */
export const DISTANCE_PAD = { x: 5, y: 2 };

export const distanceText = (metres: number) => `${number(metres, 0)} m`;

/**
 * Page box of a distance label whose leader ends at `at` (11 px mono text, left and bottom
 * aligned at the offset), a little generous so a card kept off it never touches the text.
 */
export function distanceLabelBox(at: { x: number; y: number }, metres: number) {
  const width = distanceText(metres).length * 6.7 + 2 * DISTANCE_PAD.x,
    height = 15 + 2 * DISTANCE_PAD.y;
  const left = at.x + DISTANCE_OFFSET.x - DISTANCE_PAD.x,
    bottom = at.y + DISTANCE_OFFSET.y + DISTANCE_PAD.y;
  return { left, right: left + width, top: bottom - height, bottom };
}

/** Pixels between the ring and the bottom of the radius label. */
export const RING_LABEL_LIFT = 6;
/** Size of «r = 300 m · 5 activos dentro» (12 px mono with 7 × 4 px of padding), a little generous. */
export const ringLabelSize = (text: string) => ({
  width: Math.ceil(text.length * 7.3 + 14),
  height: 24,
});
/** Box of the radius label drawn centred above its point `at` on the ring. */
export function ringLabelBox(at: { x: number; y: number }, text: string) {
  const { width, height } = ringLabelSize(text);
  const bottom = at.y - RING_LABEL_LIFT;
  return { left: at.x - width / 2, right: at.x + width / 2, top: bottom - height, bottom };
}
