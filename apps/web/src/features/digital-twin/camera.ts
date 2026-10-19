// Pure camera-framing maths, kept free of Cesium so it can be unit-tested in Node.
export interface LatLng {
  lat: number;
  lng: number;
}
const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * Centre and radius (metres) of a circle that contains every point, padded so that
 * markers, labels and installation areas near the edge stay inside the view.
 * By default the padding grows with the frame (30 %, between 200 and 450 m): the whole
 * network keeps room for its labels (about 160 px wide, centred on the marker) and one
 * installation (a 210 m area) fills the view.
 */
export function frameOf(points: LatLng[], paddingM?: number, minRadiusM = 300) {
  if (!points.length) return undefined;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
  const radius = Math.max(...points.map((p) => distanceM(center, p)));
  const padding = paddingM ?? Math.min(450, Math.max(200, radius * 0.3));
  return { center, radius: Math.max(minRadiusM, radius + padding) };
}
/**
 * Camera distance that fits a sphere of `radius` in a perspective frustum.
 * Cesium's `fov` spans the wider screen axis, so on a portrait phone the
 * horizontal angle is the narrow one and decides the distance.
 */
export function fitDistance(radius: number, fov: number, aspectRatio: number, margin = 1.15) {
  return fitInView(radius, fov, aspectRatio, 1, 0, margin).distance;
}

/** Tangent of half the horizontal and vertical field of view of Cesium's `fov`. */
function halfTangents(fov: number, width: number, height: number) {
  const aspect = width / height;
  const fovy = aspect <= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
  const y = Math.tan(fovy / 2);
  return { x: y * aspect, y };
}

/**
 * Pixels of the canvas hidden by plates and panels along each edge. The scene runs to every edge
 * of the screen and the HUD floats over it, so a framing aims at the middle of what is left.
 */
export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
const toEdges = (covered: number | Partial<Edges>): Edges =>
  typeof covered === 'number'
    ? { top: 0, right: covered, bottom: 0, left: 0 }
    : { top: 0, right: 0, bottom: 0, left: 0, ...covered };
/** Never trust more than half of either axis to the HUD: scale both sides down together. */
function clampEdges(edges: Edges, width: number, height: number): Edges {
  const fit = (a: number, b: number, max: number) => {
    a = Math.max(0, a);
    b = Math.max(0, b);
    const k = a + b > max ? max / (a + b) : 1;
    return [a * k, b * k] as const;
  };
  const [left, right] = fit(edges.left, edges.right, width / 2);
  const [top, bottom] = fit(edges.top, edges.bottom, height / 2);
  return { top, right, bottom, left };
}

/**
 * Metres to aim the camera to the right of a target `distance` away so the target lands in the
 * middle of the part of the canvas that a panel `covered` px wide on the right leaves visible.
 */
export function aimShift(
  distance: number,
  fov: number,
  width: number,
  height: number,
  covered: number,
) {
  if (!covered || !width || !height) return 0;
  return (distance * halfTangents(fov, width, height).x * covered) / width;
}

/**
 * Fits a sphere in the visible part of a `width` x `height` canvas whose edges are partly hidden
 * by floating plates (`covered`: px per edge, or px on the right): the camera distance for the
 * narrower visible angle, how far to aim to the right of the sphere (`shift`, metres) and how far
 * above it on screen (`lift`, metres across the line of sight) so it sits centred in what is left.
 */
export function fitInView(
  radius: number,
  fov: number,
  width: number,
  height: number,
  covered: number | Partial<Edges> = 0,
  margin = 1.15,
) {
  const edges = clampEdges(toEdges(covered), width, height);
  const half = halfTangents(fov, width, height);
  const narrow = Math.min(
    Math.atan((half.x * (width - edges.left - edges.right)) / width),
    Math.atan((half.y * (height - edges.top - edges.bottom)) / height),
  );
  const distance = (radius / Math.sin(narrow)) * margin;
  return { distance, ...aimOffsets(distance, fov, width, height, edges) };
}

/**
 * For a camera `distance` from its target: metres to aim to the right of it (`shift`) and above
 * it across the line of sight (`lift`) so it lands in the middle of what the HUD leaves visible.
 */
export function aimOffsets(
  distance: number,
  fov: number,
  width: number,
  height: number,
  covered: number | Partial<Edges>,
) {
  if (!width || !height) return { shift: 0, lift: 0 };
  const edges = clampEdges(toEdges(covered), width, height);
  const half = halfTangents(fov, width, height);
  return {
    shift: aimShift(distance, fov, width, height, edges.right - edges.left),
    lift: (distance * half.y * (edges.top - edges.bottom)) / height,
  };
}

export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/**
 * Pixels on the right of the canvas hidden by panels floating over the map. Only panels that
 * start in the right half and cover at least a quarter of its height count: a collapsed header
 * is a thin strip that the framing margin already leaves room for.
 */
export function coveredRight(canvas: ScreenBox, overlays: ScreenBox[]) {
  const width = canvas.right - canvas.left,
    height = canvas.bottom - canvas.top;
  let covered = 0;
  for (const box of overlays) {
    const overlap = Math.min(box.bottom, canvas.bottom) - Math.max(box.top, canvas.top);
    if (box.left <= canvas.left + width / 2 || box.left >= canvas.right) continue;
    if (overlap < height / 4) continue;
    covered = Math.max(covered, canvas.right - box.left);
  }
  return covered;
}

/**
 * Whether a box lies along the top or bottom edge (a strip) rather than a side. A wide box is a
 * strip, unless it is a panel against a side, taller than 120 px and under 60 % of the width
 * (a short section sheet on the left is a side panel, not a strip at the top).
 */
function isStrip(box: ScreenBox, canvas: ScreenBox, width: number) {
  const w = box.right - box.left,
    h = box.bottom - box.top;
  if (w < h) return false;
  const againstSide = box.left - canvas.left <= 40 || canvas.right - box.right <= 40;
  return !(againstSide && h > 120 && w < 0.6 * width);
}

/**
 * Pixels of each edge of the canvas hidden by the HUD. A wide box (a strip of plates) counts for
 * the top or the bottom when it lies in that quarter of the canvas; a tall one (a panel, a sheet,
 * a docked card) for the left or the right edge when it hugs it. A wide plate stacked within
 * 40 px of a covered strip covers that edge too (the phone's credits above its bottom sheet).
 * Anything else floats over the scene (a card beside its asset) and is left out.
 */
export function coveredEdges(canvas: ScreenBox, overlays: ScreenBox[]): Edges {
  const height = canvas.bottom - canvas.top,
    width = canvas.right - canvas.left;
  const edges: Edges = { top: 0, right: 0, bottom: 0, left: 0 };
  const near = 40;
  for (const raw of overlays) {
    const box = {
      left: Math.max(raw.left, canvas.left),
      right: Math.min(raw.right, canvas.right),
      top: Math.max(raw.top, canvas.top),
      bottom: Math.min(raw.bottom, canvas.bottom),
    };
    const w = box.right - box.left,
      h = box.bottom - box.top;
    if (w <= 0 || h <= 0) continue;
    if (isStrip(box, canvas, width)) {
      if (box.top - canvas.top <= height / 4)
        edges.top = Math.max(edges.top, box.bottom - canvas.top);
      else if (canvas.bottom - box.bottom <= height / 4)
        edges.bottom = Math.max(edges.bottom, canvas.bottom - box.top);
    } else if (box.left - canvas.left <= near)
      edges.left = Math.max(edges.left, box.right - canvas.left);
    else if (canvas.right - box.right <= near)
      edges.right = Math.max(edges.right, canvas.right - box.left);
  }
  // Wide plates stacked on a covered top or bottom strip extend it, one layer at a time.
  for (let grown = true; grown;) {
    grown = false;
    for (const raw of overlays) {
      const left = Math.max(raw.left, canvas.left),
        right = Math.min(raw.right, canvas.right);
      const top = Math.max(raw.top, canvas.top),
        bottom = Math.min(raw.bottom, canvas.bottom);
      if (
        right - left <= 0 ||
        bottom - top <= 0 ||
        !isStrip({ left, right, top, bottom }, canvas, width)
      )
        continue;
      const fromBottom = canvas.bottom - bottom,
        reach = canvas.bottom - top;
      if (edges.bottom && fromBottom <= edges.bottom + near && reach > edges.bottom) {
        edges.bottom = reach;
        grown = true;
      }
      const fromTop = top - canvas.top,
        down = bottom - canvas.top;
      if (edges.top && fromTop <= edges.top + near && down > edges.top) {
        edges.top = down;
        grown = true;
      }
    }
  }
  return edges;
}

/**
 * The middle of the part of the canvas the HUD leaves visible (page px): where «Medir» puts its
 * crosshair and its «Centro» point. On a phone with the Medir sheet at 45 % it lies between the
 * top plate and the credits over the sheet, not on them.
 */
export function freeCentre(canvas: ScreenBox, overlays: ScreenBox[]) {
  const edges = coveredEdges(canvas, overlays);
  const left = canvas.left + edges.left,
    right = canvas.right - edges.right,
    top = canvas.top + edges.top,
    bottom = canvas.bottom - edges.bottom;
  // A HUD that leaves no room (it never should): the middle of the canvas.
  if (right - left < 40 || bottom - top < 40)
    return { x: (canvas.left + canvas.right) / 2, y: (canvas.top + canvas.bottom) / 2 };
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * Whether two camera poses [longitude, latitude, heading, pitch] (radians) are the same: about
 * 0.5 m on the ground and 0.05° of rotation. Height is left out on purpose, as Cesium lifts a
 * camera that ends up below newly loaded terrain without the user moving it.
 */
export function samePose(a: readonly number[], b: readonly number[]) {
  const turn = (x: number) => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
  return (
    a.length === b.length &&
    a.every((x, i) => (i < 2 ? Math.abs(x - b[i]!) < 1e-7 : turn(x - b[i]!) < 1e-3))
  );
}
/** Camera position on the ground (lng, lat in radians) and orientation (heading, pitch). */
export type Pose = [number, number, number, number];
/**
 * The last flight the viewer made on its own (framing a place or the selected asset). When the
 * ground under it changes (the LiDAR terrain arrives after the first frame) it is flown again,
 * but only while the camera is still where that flight left it: a user's moves are never undone.
 */
export interface AutoFlight {
  state: 'flying' | 'landed';
  redo: () => void;
  /** Where the flight left the camera. */
  pose?: Pose;
}
/**
 * Starts a flight of the viewer's own and remembers it in `last`, so it can be flown again.
 * `fly` gets the callbacks for the camera flight: `complete` when it lands, `cancel` when
 * another flight (the user's «Ir» on a layer, for instance) interrupts it. Cesium calls only
 * `cancel` then, and the interrupted flight is forgotten: a later change of ground must not
 * fly it again over what the user asked for.
 */
export function flyOnOwn<V extends { isDestroyed(): boolean }>(
  last: { current: AutoFlight | null },
  v: V,
  poseOf: (v: V) => Pose,
  fly: (complete: () => void, cancel: () => void) => void,
) {
  const flight: AutoFlight = { state: 'flying', redo: () => flyOnOwn(last, v, poseOf, fly) };
  last.current = flight;
  fly(
    () => {
      if (last.current !== flight || v.isDestroyed()) return;
      flight.state = 'landed';
      flight.pose = poseOf(v);
    },
    () => {
      if (last.current === flight) last.current = null;
    },
  );
}
