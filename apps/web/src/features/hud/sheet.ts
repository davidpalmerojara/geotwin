/**
 * Phone bottom sheets: the heights they rest at («snaps», in % of the screen height measured from
 * its bottom edge, so 45 % leaves the top 55 % of the scene) and what a drag or a key does.
 * The highest snap (90 %) is modal: it traps the focus and hides the plates behind it.
 */
export type Snap = number;
/** Pulling the sheet this many points below its lowest snap closes it. */
const CLOSE_BELOW = 10;
export const MODAL_SNAP = 90;

/** Page pixels from the top of the screen to the top edge of a sheet at a snap. */
export function sheetTop(snap: Snap, height: number) {
  return Math.round(height * (1 - snap / 100));
}

/** The snap a dragged top edge is at, in % of the screen height. */
export function snapOfTop(top: number, height: number) {
  return height > 0 ? 100 * (1 - top / height) : 0;
}

/** The next snap up (1) or down (−1), staying at the ends. */
export function stepSnap(snaps: readonly Snap[], current: Snap, direction: 1 | -1): Snap {
  const sorted = [...snaps].sort((a, b) => a - b);
  const at = sorted.indexOf(current);
  if (at < 0) return nearestSnap(sorted, current);
  return sorted[Math.max(0, Math.min(sorted.length - 1, at + direction))]!;
}

export function nearestSnap(snaps: readonly Snap[], value: number): Snap {
  let best = snaps[0]!;
  for (const snap of snaps) if (Math.abs(snap - value) < Math.abs(best - value)) best = snap;
  return best;
}

/**
 * Where a drag ends. A quick flick (more than 0,5 px/ms) goes one snap in its direction; a slow
 * drag rests at the nearest snap; pulled well below the lowest snap the sheet closes (null).
 */
export function releaseSnap(
  snaps: readonly Snap[],
  start: Snap,
  top: number,
  height: number,
  /** Pixels per millisecond, positive downwards. */
  velocity = 0,
  closable = true,
): Snap | null {
  const value = snapOfTop(top, height);
  const lowest = Math.min(...snaps);
  if (closable && (value < lowest - CLOSE_BELOW || (value < lowest && velocity > 0.5))) return null;
  if (Math.abs(velocity) > 0.5) {
    const next = stepSnap(snaps, start, velocity > 0 ? -1 : 1);
    if (next !== start) return next;
  }
  return nearestSnap(snaps, value);
}

/** Keys on the sheet's handle: arrows move one snap, Home and End go to the ends. */
export function snapForKey(snaps: readonly Snap[], current: Snap, key: string): Snap | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
    case 'PageUp':
      return stepSnap(snaps, current, 1);
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'PageDown':
      return stepSnap(snaps, current, -1);
    case 'Home':
      return Math.min(...snaps);
    case 'End':
      return Math.max(...snaps);
    default:
      return null;
  }
}

/** Whether a sheet at this snap is modal (it covers nearly the whole screen). */
export const isModal = (snap: Snap) => snap >= MODAL_SNAP;

/**
 * The element Tab should move to inside a modal sheet: from the last to the first and from the
 * first to the last (Shift+Tab), so the focus never leaves it. Null lets the browser move it.
 */
export function trapTarget<T>(focusables: readonly T[], active: T | null, back: boolean): T | null {
  if (!focusables.length) return null;
  const first = focusables[0]!,
    last = focusables[focusables.length - 1]!;
  const at = active === null ? -1 : focusables.indexOf(active);
  if (at < 0) return back ? last : first;
  if (back && at === 0) return last;
  if (!back && at === focusables.length - 1) return first;
  return null;
}
