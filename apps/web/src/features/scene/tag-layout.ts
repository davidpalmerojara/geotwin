/**
 * Placement of the sensor tags drawn in the scene next to each asset (from direction C), in the
 * same spirit as the installation labels (labels.ts): pure maths in CSS pixels, no Cesium, so it is
 * unit-tested in Node. Each tag sits at one of eight spots around its asset's mark, joined to it by
 * a short leader; the most important tags are placed first and a tag with no free spot is hidden
 * rather than drawn on top of another one or of a plate of the HUD.
 */
import type { AssetStatus } from '@geotwin/shared';
import type { ScreenBox } from '../digital-twin/camera';
import { overlaps } from '../digital-twin/labels';

/** What a tag shows: name, value and word; only the value; or no tag, only the mark. */
export type TagLod = 'full' | 'value' | 'mark';
/** Camera distances (m) where tags lose their name, then their value. */
export const NEAR_M = 700;
export const FAR_M = 2000;

/**
 * Level of detail by the camera's distance to the asset: up to 700 m warnings and critical assets
 * (and the selected one) show name, value and word, operational ones only their value; up to 2 km
 * every tag shows its value; further away only the mark is drawn. `quiet` (while a profile is
 * drawn) leaves operational assets with only their mark: warnings, critical assets and the selected
 * one keep their tags.
 */
export function lodFor(
  distance: number,
  status: AssetStatus,
  selected = false,
  quiet = false,
): TagLod {
  if (!Number.isFinite(distance) || distance > FAR_M) return 'mark';
  if (quiet && status === 'healthy' && !selected) return 'mark';
  if (distance > NEAR_M) return 'value';
  return status !== 'healthy' || selected ? 'full' : 'value';
}

/**
 * Placement order: the selected asset (the one the user is looking at, with its card open), then
 * critical, warning, a Radio result, the rest.
 */
export function rankOf(status: AssetStatus, selected = false, hit = false) {
  return selected ? 0 : status === 'critical' ? 1 : status === 'warning' ? 2 : hit ? 3 : 4;
}

export interface TagItem {
  id: string;
  /** The mark (the asset's anchor) on screen, px from the scene's corner. */
  x: number;
  y: number;
  /** Size of the tag box, px. */
  width: number;
  height: number;
  /** 0 places first (see rankOf). */
  rank: number;
  /** Camera distance, m: nearer tags win between equal ranks. */
  distance: number;
  /** A smaller form (the value alone) to fall back to when the tag does not fit at any spot. */
  compact?: { width: number; height: number };
}
/** The eight spots around the mark, in the order they are tried. */
export type Side = 'ne' | 'nw' | 'n' | 'e' | 'w' | 'se' | 'sw' | 's';
export const SIDES: Side[] = ['ne', 'nw', 'n', 'e', 'w', 'se', 'sw', 's'];
/** Gap from the mark to a diagonal tag, and to a tag straight above, below or beside it. */
export const DIAGONAL = 14;
export const STRAIGHT = 24;
/** Tags keep this far from the edges of the scene. */
export const EDGE = 4;

export interface TagPlacement {
  side: Side;
  left: number;
  top: number;
  /** The leader from the mark to the nearest point of the tag. */
  leader: { x1: number; y1: number; x2: number; y2: number };
  /** Placed in its compact form. */
  compact: boolean;
}

/** The tag's box at one of the eight spots. */
export function tagBox(item: Pick<TagItem, 'x' | 'y' | 'width' | 'height'>, side: Side) {
  const { x, y, width: w, height: h } = item;
  const left =
    side === 'ne' || side === 'se'
      ? x + DIAGONAL
      : side === 'nw' || side === 'sw'
        ? x - DIAGONAL - w
        : side === 'e'
          ? x + STRAIGHT
          : side === 'w'
            ? x - STRAIGHT - w
            : x - w / 2;
  const top =
    side === 'ne' || side === 'nw'
      ? y - DIAGONAL - h
      : side === 'se' || side === 'sw'
        ? y + DIAGONAL
        : side === 'n'
          ? y - STRAIGHT - h
          : side === 's'
            ? y + STRAIGHT
            : y - h / 2;
  return { left, top, right: left + w, bottom: top + h };
}

const leaderTo = (x: number, y: number, box: ScreenBox) => ({
  x1: x,
  y1: y,
  x2: Math.min(Math.max(x, box.left), box.right),
  y2: Math.min(Math.max(y, box.top), box.bottom),
});

export interface LayoutOptions {
  /** The scene's size, px. */
  view: { width: number; height: number };
  /** Plates of the HUD and other labels: never covered. */
  blocked?: ScreenBox[];
  /** The marks of every asset (by id): avoided when there is another spot. */
  marks?: Map<string, ScreenBox>;
  /** The side each tag had last time, tried first so tags do not jump while the camera moves. */
  previous?: Map<string, Side>;
}

/**
 * Greedy placement: tags in order of rank (then nearest first) each take the first of the eight
 * spots that stays inside the scene and clear of the plates, of the tags already placed and of the
 * other marks; marks are only covered when there is no other spot. A tag with a compact form that
 * fits nowhere whole tries again in that form (the value alone) before giving up. `null` means
 * hidden.
 */
export function layoutTags(items: TagItem[], options: LayoutOptions) {
  const { view, blocked = [], marks = new Map<string, ScreenBox>(), previous } = options;
  const ordered = [...items].sort(
    (a, b) => a.rank - b.rank || a.distance - b.distance || (a.id < b.id ? -1 : 1),
  );
  const placed: ScreenBox[] = [];
  const result = new Map<string, TagPlacement | null>();
  const fits = (box: ScreenBox, avoid: ScreenBox[]) =>
    box.left >= EDGE &&
    box.top >= EDGE &&
    box.right <= view.width - EDGE &&
    box.bottom <= view.height - EDGE &&
    !avoid.some((b) => overlaps(box, b));
  for (const item of ordered) {
    const onScreen = item.x >= 0 && item.x <= view.width && item.y >= 0 && item.y <= view.height;
    if (!onScreen) {
      result.set(item.id, null);
      continue;
    }
    const otherMarks = [...marks].filter(([id]) => id !== item.id).map(([, box]) => box);
    const last = previous?.get(item.id);
    const sides = last ? [last, ...SIDES.filter((s) => s !== last)] : SIDES;
    const hard = [...blocked, ...placed];
    let chosen: Side | undefined;
    let sized: Pick<TagItem, 'x' | 'y' | 'width' | 'height'> = item;
    for (const form of item.compact ? [item, { ...item, ...item.compact }] : [item]) {
      for (const avoid of [[...hard, ...otherMarks], hard]) {
        chosen = sides.find((side) => fits(tagBox(form, side), avoid));
        if (chosen) break;
      }
      if (chosen) {
        sized = form;
        break;
      }
    }
    if (!chosen) {
      result.set(item.id, null);
      continue;
    }
    const box = tagBox(sized, chosen);
    placed.push(box);
    result.set(item.id, {
      side: chosen,
      left: box.left,
      top: box.top,
      leader: leaderTo(item.x, item.y, box),
      compact: sized !== item,
    });
  }
  return result;
}

/** The spot the selected asset's tag holds whole, around its mark. */
export interface TagReservation {
  side: Side;
  width: number;
  height: number;
}

/**
 * The selected tag wins its spot over the installation labels: they are placed before the tags in
 * a frame, so the tag tells them where it goes whole and they keep off it from the next frame on.
 * `placed` is its placement this frame; `options` are the layout's without the labels. When it was
 * placed whole that spot is kept; when it had to drop to its compact form (or hide), the first spot
 * where it fits whole leaving the labels out; `null` when it fits whole nowhere even then.
 */
export function reserveSelected(
  item: TagItem | undefined,
  placed: TagPlacement | null | undefined,
  options: LayoutOptions,
): TagReservation | null {
  if (!item) return null;
  const size = { width: item.width, height: item.height };
  if (placed && !placed.compact) return { side: placed.side, ...size };
  const whole = layoutTags([{ ...item, compact: undefined }], options).get(item.id);
  return whole ? { side: whole.side, ...size } : null;
}

/** Depth samples (px offsets from the mark) read to tell whether something hides it. */
export const OCCLUSION_SAMPLES: [number, number][] = [
  [0, 0],
  [-3, 0],
  [3, 0],
];
/** Metres something must stand in front of the mark to count as hiding it. */
export const OCCLUSION_MARGIN_M = 3;
/**
 * Far away the depth of a frame is coarser and each LiDAR point covers more ground (a 4 px splat
 * at 4 km is several metres across): the margin grows to 0,4 % of the distance beyond 750 m.
 */
export const occlusionMargin = (distance: number) => Math.max(OCCLUSION_MARGIN_M, distance * 0.004);

/**
 * Whether a mark is hidden: in at least two of the three samples of a 3 px cross the scene's depth
 * (the camera distance of whatever is drawn there; null for the sky) is more than 3 m nearer than
 * the mark (more far away, see occlusionMargin). A thin post or a wire in front catches one
 * sample at most and does not hide it.
 */
export function isOccluded(
  anchorDistance: number,
  samples: (number | null | undefined)[],
  margin = occlusionMargin(anchorDistance),
) {
  let nearer = 0;
  for (const d of samples)
    if (typeof d === 'number' && Number.isFinite(d) && d < anchorDistance - margin) nearer++;
  return nearer >= 2;
}

/**
 * Whether the tag of a hidden mark is drawn faded (55 %). Only an operating asset's: the mark of an
 * asset in warning or critical goes hollow like any other, but its tag stays at full strength, as
 * an alert has to be read from afar and faded red or amber text falls below AA contrast.
 */
export const fadesTag = (status: AssetStatus, occluded: boolean) =>
  occluded && status === 'healthy';

/**
 * Where the value of the selected asset's mounting dimension goes (its top-left corner), for a
 * label `size` beside the point `at` of the dimension line: to its left, to its right, or a step
 * above or below either, the first place inside the view clear of `blocked` (plates, chips,
 * installation labels) and of the other assets' `marks`. When only the marks are in the way, the
 * first place clear of the rest (the label is drawn over the marks); null when none is.
 */
export function placeValue(
  at: { x: number; y: number },
  size: { width: number; height: number },
  viewWidth: number,
  blocked: ScreenBox[],
  marks: ScreenBox[],
  gap = 12,
): ScreenBox | null {
  const { width: w, height: h } = size;
  const step = h + 6;
  const candidates = [0, -step, step].flatMap((dy) =>
    [at.x - gap - w, at.x + gap].map((left) => ({
      left,
      right: left + w,
      top: at.y - h / 2 + dy,
      bottom: at.y + h / 2 + dy,
    })),
  );
  const inside = (b: ScreenBox) => b.left >= 0 && b.right <= viewWidth;
  const clear = (b: ScreenBox, of: ScreenBox[]) => !of.some((o) => overlaps(b, o));
  const usable = candidates.filter((b) => inside(b) && clear(b, blocked));
  return usable.find((b) => clear(b, marks)) ?? usable[0] ?? null;
}
