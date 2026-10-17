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
/** Length of the guide between the asset and its floating card. */
export const GUIDE = 30;
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
}

/**
 * Floats the card beside its asset, on the side with more room and joined by a guide of at
 * least GUIDE px, without covering the asset or another plate. When there is no such spot (or
 * the screen is narrow, or the asset is off screen) the card docks to the right edge.
 */
export function placeCard({ viewport, anchor, card, obstacles, dockTop, bottom }: CardInput) {
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
  // The asset itself, with room for its glyph, stays visible.
  const asset = { left: x - 16, right: x + 16, top: y - 16, bottom: y + 16 };
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
