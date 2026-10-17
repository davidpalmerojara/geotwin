import type { ScreenPoint } from '../../stores/viewer';

/** Rows this tall (px) read left to right, like lines of text. */
const ROW = 48;

/**
 * The items whose projection is on screen, in reading order: rows of 48 px from the top, and
 * left to right inside a row. Items behind the camera or off screen are left out.
 */
export function screenOrder<T>(
  points: readonly { item: T; at: ScreenPoint | null }[],
  width: number,
  height: number,
): T[] {
  return points
    .filter(
      (p): p is { item: T; at: ScreenPoint } =>
        !!p.at && p.at.x >= 0 && p.at.x <= width && p.at.y >= 0 && p.at.y <= height,
    )
    .sort((a, b) => Math.floor(a.at.y / ROW) - Math.floor(b.at.y / ROW) || a.at.x - b.at.x)
    .map((p) => p.item);
}
