/**
 * Where the floating pieces of the HUD go, as pure geometry in page pixels: the asset card next to
 * its asset (or docked to the right edge) and the chips on the edge of the free part of the
 * scene for what lies outside it. No DOM, no Cesium: the components measure and call these.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

export const MARGIN = 12;
export const GAP = 8;
/** Length of the guide between the asset and its floating card (clear of the asset's label). */
export const GUIDE = 84;
/** Below this width the card is always docked (tablets and phones). */
export const FLOAT_MIN_WIDTH = 1024;

export const intersects = (a: Box, b: Box, pad = 0) =>
  a.left < b.right + pad &&
  b.left < a.right + pad &&
  a.top < b.bottom + pad &&
  b.top < a.bottom + pad;
const boxOf = (left: number, top: number, size: Size): Box => ({
  left,
  top,
  right: left + size.width,
  bottom: top + size.height,
});

export interface CardPlacement {
  mode: 'float' | 'dock';
  left: number;
  top: number;
  side?: 'left' | 'right';
  /** From the asset to the card's edge, when it floats. */
  guide?: { x1: number; y1: number; x2: number; y2: number };
}

export interface CardInput {
  viewport: Size;
  /** The asset on screen; null when it is behind the camera or not placed yet. */
  anchor: Point | null;
  card: Size;
  /** Plates, panels and sheets the card must not cover. */
  obstacles: Box[];
  /** Top of the docked card (below the heading plate). */
  dockTop: number;
  /** Lowest the card's bottom may go (above the credits). */
  bottom: number;
  /**
   * What the floating card should leave in sight: points (Radio's results on screen, with
   * KEEP_PAD around them) and boxes (their distance labels, with GAP around them).
   */
  keep?: (Point | Box)[];
}
/** Clearance around each point the card keeps in sight (its mark and distance label). */
const KEEP_PAD = 28;

/**
 * Floats the card beside its asset, on the side with more room and joined by a guide of at
 * least GUIDE px, without covering the asset, another plate or a point it must keep in sight
 * (Radio's results). When there is no such spot (or the screen is narrow, or the asset is off
 * screen) the card docks to the right edge.
 */
export function placeCard({
  viewport,
  anchor,
  card,
  obstacles,
  dockTop,
  bottom,
  keep = [],
}: CardInput) {
  const dock: CardPlacement = {
    mode: 'dock',
    left: viewport.width - MARGIN - card.width,
    top: dockTop,
  };
  if (viewport.width < FLOAT_MIN_WIDTH || !anchor) return dock;
  const { x, y } = anchor;
  if (x < MARGIN || x > viewport.width - MARGIN || y < MARGIN || y > bottom) return dock;
  const top0 = MARGIN,
    top1 = bottom - card.height;
  if (top1 < top0) return dock;
  const clampTop = (t: number) => Math.min(top1, Math.max(top0, t));
  const sides: ('left' | 'right')[] =
    viewport.width - x >= x ? ['right', 'left'] : ['left', 'right'];
  // The asset itself stays visible, with its glyph and the name label drawn above it.
  const asset = { left: x - 80, right: x + 80, top: y - 44, bottom: y + 16 };
  for (const side of sides) {
    const left = side === 'right' ? x + GUIDE : x - GUIDE - card.width;
    if (left < MARGIN || left + card.width > viewport.width - MARGIN) continue;
    const tops = [
      y - card.height / 2,
      ...obstacles.flatMap((o) => [o.bottom + GAP, o.top - GAP - card.height]),
    ]
      .map(clampTop)
      .sort((a, b) => Math.abs(a + card.height / 2 - y) - Math.abs(b + card.height / 2 - y));
    for (const top of tops) {
      const box = boxOf(left, top, card);
      if (intersects(box, asset) || obstacles.some((o) => intersects(box, o, GAP - 1))) continue;
      const covers = (k: Point | Box) =>
        'x' in k
          ? k.x > box.left - KEEP_PAD &&
            k.x < box.right + KEEP_PAD &&
            k.y > box.top - KEEP_PAD &&
            k.y < box.bottom + KEEP_PAD
          : intersects(box, k, GAP);
      if (keep.some(covers)) continue;
      const edge = side === 'right' ? left : left + card.width;
      return {
        mode: 'float',
        left,
        top,
        side,
        guide: { x1: x, y1: y, x2: edge, y2: Math.min(box.bottom - 12, Math.max(box.top + 12, y)) },
      } satisfies CardPlacement;
    }
  }
  return dock;
}

/** Initial great-circle bearing in degrees (0 = north, clockwise). */
export function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * r) * Math.cos(to.lat * r);
  const x =
    Math.cos(from.lat * r) * Math.sin(to.lat * r) -
    Math.sin(from.lat * r) * Math.cos(to.lat * r) * Math.cos((to.lng - from.lng) * r);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
/** Eight-point compass in Spanish (O for oeste). */
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

export interface EdgeChip {
  left: number;
  top: number;
  /** Where the chip points, in screen degrees (0 = up, clockwise). */
  angle: number;
  side: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * The chip for something outside the free part of the scene: on the free box's edge where the
 * line from its centre towards the target crosses it, fully inside the box. `target` is the
 * target on screen (it may lie outside the box or the screen); when it is behind the camera
 * (null) the direction comes from `relativeBearing`, the bearing minus the camera heading in
 * degrees, with straight ahead pointing up. Returns null when the target is in the free box.
 */
export function edgeChip(
  free: Box,
  chip: Size,
  target: Point | null,
  relativeBearing: number,
): EdgeChip | null {
  const cx = (free.left + free.right) / 2,
    cy = (free.top + free.bottom) / 2;
  if (
    target &&
    target.x >= free.left &&
    target.x <= free.right &&
    target.y >= free.top &&
    target.y <= free.bottom
  )
    return null;
  let dx: number, dy: number;
  if (target) {
    dx = target.x - cx;
    dy = target.y - cy;
  } else {
    const a = (relativeBearing * Math.PI) / 180;
    dx = Math.sin(a);
    dy = -Math.cos(a);
  }
  if (!dx && !dy) dy = -1;
  const hw = (free.right - free.left) / 2,
    hh = (free.bottom - free.top) / 2;
  // Scale the direction to the box's edge.
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const ex = cx + dx * t,
    ey = cy + dy * t;
  const side: EdgeChip['side'] =
    Math.abs(dx * t) >= hw - 0.5 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
  const left = Math.min(free.right - chip.width, Math.max(free.left, ex - chip.width / 2));
  const top = Math.min(free.bottom - chip.height, Math.max(free.top, ey - chip.height / 2));
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return { left, top, angle, side };
}

/** Lays chips out along their edges so none overlaps the one before (in the given order). */
export function separate(chips: (EdgeChip & Size)[], free: Box) {
  const placed: (EdgeChip & Size)[] = [];
  for (const chip of chips) {
    const c = { ...chip };
    for (let i = 0; i < 40; i++) {
      const hit = placed.find((p) =>
        intersects(boxOf(c.left, c.top, c), boxOf(p.left, p.top, p), 3),
      );
      if (!hit) break;
      if (c.side === 'left' || c.side === 'right') c.top = hit.top + hit.height + 4;
      else c.left = hit.left + hit.width + 4;
    }
    c.top = Math.min(free.bottom - c.height, c.top);
    c.left = Math.min(free.right - c.width, c.left);
    placed.push(c);
  }
  return placed;
}

/**
 * Whether something drawn at `at` on screen is out of sight: behind the camera (null), off the
 * viewport, or under one of the plates (within `pad` px of it, so a half-covered mark counts).
 * A point in a band of the scene that the framing treats as covered, but between plates, is in
 * sight: its mark and its tag are there to see, and a chip for it would only repeat them.
 */
export function outOfSight(at: Point | null, viewport: Size, plates: Box[], pad = 8) {
  if (!at) return true;
  if (at.x < 0 || at.y < 0 || at.x > viewport.width || at.y > viewport.height) return true;
  return plates.some(
    (b) =>
      at.x >= b.left - pad &&
      at.x <= b.right + pad &&
      at.y >= b.top - pad &&
      at.y <= b.bottom + pad,
  );
}

/**
 * How much of a box (a tag, a label) can be seen: the share of it, from 0 to 1, that is on screen
 * and under no plate. Sampled on a grid, so plates that overlap each other are not counted twice.
 */
export function shownShare(box: Box, viewport: Size, plates: Box[], columns = 8, rows = 3) {
  const width = box.right - box.left,
    height = box.bottom - box.top;
  if (width <= 0 || height <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < columns; i++)
    for (let j = 0; j < rows; j++) {
      const x = box.left + ((i + 0.5) * width) / columns,
        y = box.top + ((j + 0.5) * height) / rows;
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
      if (plates.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) continue;
      seen++;
    }
  return seen / (columns * rows);
}

/** Most edge chips shown at once; the rest are counted in a «+n» chip that shows them all. */
export const MAX_CHIPS = 3;
/**
 * The chips to show, most urgent first (`rank`, lower first, then nearer), at most `max` of
 * them unless `all`; `more` is how many are left out.
 */
export function pickChips<T extends { distance: number }>(
  chips: T[],
  rank: (chip: T) => number,
  all = false,
  max = MAX_CHIPS,
) {
  const sorted = [...chips].sort((a, b) => rank(a) - rank(b) || a.distance - b.distance);
  const shown = all ? sorted : sorted.slice(0, max);
  return { shown, more: sorted.length - shown.length };
}

/**
 * Lays chips out along their edges (in the given order) clear of each other and of the plates
 * floating inside the free area (a card beside its asset): a chip that would land on one slides
 * along its edge to the nearest free spot, and is left out (null) when there is none. `marks`
 * (the assets' marks in the scene) are avoided too when the edge has room; a chip never goes
 * missing for one.
 */
export function placeChips<T extends EdgeChip & Size>(
  chips: T[],
  free: Box,
  plates: Box[],
  marks: Box[] = [],
) {
  const placed: T[] = [];
  return chips.map((chip) => {
    const next =
      placeChip(chip, free, [...plates, ...placed.map((p) => boxOf(p.left, p.top, p)), ...marks]) ??
      placeChip(chip, free, [...plates, ...placed.map((p) => boxOf(p.left, p.top, p))]);
    if (next) placed.push(next);
    return next;
  });
}

function placeChip<T extends EdgeChip & Size>(chip: T, free: Box, obstacles: Box[]): T | null {
  const fits = (left: number, top: number) =>
    left >= free.left - 0.5 &&
    left + chip.width <= free.right + 0.5 &&
    top >= free.top - 0.5 &&
    top + chip.height <= free.bottom + 0.5 &&
    !obstacles.some((o) => intersects(boxOf(left, top, chip), o, 3));
  const along = chip.side === 'left' || chip.side === 'right';
  const start = along ? chip.top : chip.left;
  const size = along ? chip.height : chip.width;
  const spots = [
    start,
    ...obstacles.flatMap((o) =>
      along ? [o.top - 4 - size, o.bottom + 4] : [o.left - 4 - size, o.right + 4],
    ),
  ].sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
  const spot = spots.find((s) => (along ? fits(chip.left, s) : fits(s, chip.top)));
  if (spot === undefined) return null;
  return along ? { ...chip, top: spot } : { ...chip, left: spot };
}
