// Radio's distance labels on screen, without Cesium: the ring draws them (radius-ring.ts) and the
// floating asset card keeps them in sight (asset-card.tsx), so both take their size from here.
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
