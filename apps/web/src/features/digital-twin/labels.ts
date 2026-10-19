// Placement of the installation labels on the map so they neither overlap each other nor sit
// under the floating controls, and what they say. Pure maths in CSS pixels, no Cesium:
// unit-tested in Node.
import type { AssetStatus } from '@geotwin/shared';
import type { ScreenBox } from './camera';

export interface LabelAnchor {
  id: string;
  /** Anchor on screen (the installation's centre on the ground), px from the canvas corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The label without its counts (the name alone), tried when the whole label has no room. */
  compact?: { width: number; height: number };
}
/**
 * Offset (px) from the anchor to the label's centre, and `compact` when only the name fits;
 * `null` when the label is hidden.
 */
export type LabelOffset = { x: number; y: number; compact?: true } | null;

/** How many assets an installation has, and how many of them are critical or in warning. */
export interface InstallationCounts {
  total: number;
  critical: number;
  warning: number;
}
export function installationCounts(
  assets: { installation_id: string; status: AssetStatus }[],
  id: string,
): InstallationCounts {
  const counts = { total: 0, critical: 0, warning: 0 };
  for (const a of assets) {
    if (a.installation_id !== id) continue;
    counts.total++;
    if (a.status === 'critical') counts.critical++;
    if (a.status === 'warning') counts.warning++;
  }
  return counts;
}
/**
 * The second line of an installation's label, as in the mockups: «6 activos · 1 crítico ·
 * 1 advertencia» or «6 activos · sin alertas». Each alert part carries its status so the label
 * draws it with its glyph and colour, as the scene tags do.
 */
export function countParts({ total, critical, warning }: InstallationCounts) {
  const parts: { text: string; status?: Exclude<AssetStatus, 'healthy'> }[] = [
    { text: `${total} ${total === 1 ? 'activo' : 'activos'}` },
  ];
  if (critical)
    parts.push({
      text: `${critical} ${critical === 1 ? 'crítico' : 'críticos'}`,
      status: 'critical',
    });
  if (warning)
    parts.push({
      text: `${warning} ${warning === 1 ? 'advertencia' : 'advertencias'}`,
      status: 'warning',
    });
  if (!critical && !warning) parts.push({ text: 'sin alertas' });
  return parts;
}
/** The whole label for a screen reader: «Torrelago · torres residenciales: 6 activos, 1 crítico». */
export const labelText = (name: string, counts: InstallationCounts) =>
  `${name}: ${countParts(counts)
    .map((p) => p.text)
    .join(', ')}`;

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
  type Spot = { box: ScreenBox; dy: number; cost: number };
  const spot = (a: Pick<LabelAnchor, 'x' | 'y' | 'width' | 'height'>): Spot | null => {
    const hard = [...blocked, ...placed];
    // The label spans its anchor, or the point of the inset band nearest to it.
    const ax = Math.min(Math.max(a.x, inset), view.width - inset);
    // The offsets are for a one-line label (26 px); a taller one keeps the same gap to its anchor.
    const grow = Math.max(0, a.height - 26) / 2;
    let best: Spot | null = null;
    for (const offset of [...offsets, ...far]) {
      const dy = offset + Math.sign(offset) * grow;
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
    return best;
  };
  for (const a of anchors) {
    const inView = a.x >= 0 && a.x <= view.width && a.y >= 0 && a.y <= view.height;
    if (!inView) {
      result.set(a.id, null);
      continue;
    }
    // The counts go first when space is tight: the name alone is tried when the whole label has
    // no free spot, or only spots over the marks that the name alone would leave uncovered.
    const whole = spot(a);
    const small = a.compact && (!whole || whole.cost > 0) ? spot({ ...a, ...a.compact }) : null;
    const compact = !!small && (!whole || small.cost < whole.cost);
    const best = compact ? small : whole;
    if (!best) {
      result.set(a.id, null);
      continue;
    }
    placed.push(best.box);
    const width = best.box.right - best.box.left;
    result.set(a.id, {
      x: best.box.left + width / 2 - a.x,
      y: best.dy,
      ...(compact ? { compact: true as const } : {}),
    });
  }
  return result;
}
