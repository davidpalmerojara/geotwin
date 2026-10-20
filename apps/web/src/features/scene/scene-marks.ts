/**
 * What the tools draw in the scene that a label should not hide when it has somewhere else to go:
 * the A and B markers and the outline of a profile. Each tool registers a function that gives
 * their boxes on screen (canvas px); the installation labels read them all as soft obstacles. No
 * Cesium here, so the labels' code does not pull in the tools' chunk.
 */
export interface MarkBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const sources = new Set<() => MarkBox[]>();

/** Adds a source of boxes; the returned function removes it. */
export function addSceneMarks(source: () => MarkBox[]) {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** Every registered box, as their sources give them now. */
export const sceneMarks = (): MarkBox[] => [...sources].flatMap((source) => source());

/**
 * Values a tool writes in the scene for the user to read (Radio's distance to each result and its
 * «r = 300 m · 5 activos dentro»), in canvas px. Unlike the marks above they are hard obstacles:
 * an installation label, an asset's tag or an edge chip never sits on one, as none of them may sit
 * on a measurement's value either (`dimensionLabelBoxes`).
 */
const labelSources = new Set<() => MarkBox[]>();

/** Adds a source of value boxes; the returned function removes it. */
export function addSceneLabels(source: () => MarkBox[]) {
  labelSources.add(source);
  return () => {
    labelSources.delete(source);
  };
}

/** Every registered value box, as their sources give them now. */
export const sceneLabels = (): MarkBox[] => [...labelSources].flatMap((source) => source());

/**
 * The selected asset's tag, whole, where it goes (canvas px): the installation labels keep off it
 * as they keep off a value, so the tag of the asset the user is looking at is not pushed to its
 * compact form by a label (see `reserveSelected`).
 */
const reservedSources = new Set<() => MarkBox[]>();

/** Adds a source of reserved boxes; the returned function removes it. */
export function addReservedTags(source: () => MarkBox[]) {
  reservedSources.add(source);
  return () => {
    reservedSources.delete(source);
  };
}

/** Every reserved box, as their sources give them now. */
export const reservedTags = (): MarkBox[] => [...reservedSources].flatMap((source) => source());

/**
 * Small boxes along a polyline on screen, one every `step` px and `size` px wide, so a label
 * can tell a line it would cross from the free space on either side of it.
 */
export function boxesAlong(
  points: ({ x: number; y: number } | null | undefined)[],
  step = 8,
  size = 6,
): MarkBox[] {
  const boxes: MarkBox[] = [];
  const half = size / 2;
  const at = (x: number, y: number) =>
    boxes.push({ left: x - half, right: x + half, top: y - half, bottom: y + half });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // A segment that projects absurdly long (a vertex behind the camera) is left out.
    if (!Number.isFinite(length) || length > 20000) continue;
    const n = Math.max(1, Math.ceil(length / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++)
      at(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
  }
  return boxes;
}
