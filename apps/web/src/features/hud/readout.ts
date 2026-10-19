/**
 * What the readout plate shows for the point under the cursor, and the scale bar, as pure
 * functions: no Cesium, so they can be tested in Node. Heights are shown as orthometric
 * altitudes (h − N, with the geoid undulation N of the LiDAR sheet under the cursor), like the
 * PNOA products; «Sobre el suelo» is the point minus the ground model (DTM) under it.
 */
import { toUtm } from '../../lib/utm';
import type { Layer } from '@geotwin/shared';
import { number } from '../../lib/format';

/** Non-breaking space: a figure and its unit, or the groups of a UTM coordinate, never wrap. */
export const NBSP = ' ';
export const MINUS = '−';

export interface Cell {
  text: string;
  /** Why there is no value («—»), for the title and the screen reader. */
  reason?: string;
}
export interface ReadoutInput {
  /** The picked point: ellipsoidal height in metres. */
  point: { lng: number; lat: number; h: number } | null;
  /** Ellipsoidal height of the LiDAR ground model (DTM) there, or null outside the sheets. */
  ground: number | null;
  /** Geoid undulation N of the sheet under the point, in metres. */
  geoid: number | null;
  /** Whether the LiDAR relief is on: without it the clouds are lowered to the ellipsoid. */
  relief: boolean;
  /** Why there is no point (the cursor is off the scene, or it points at the sky). */
  missing?: string;
}
export interface Readout {
  position: Cell;
  utm: Cell;
  cota: Cell;
  suelo: Cell;
  sobre: Cell;
}

export const NO_CURSOR = 'mueve el cursor sobre la escena';
export const NO_GROUND = 'el cursor no apunta al suelo';
export const NO_RELIEF = 'activa Relieve del LiDAR';
export const OUTSIDE = 'fuera de las hojas LiDAR';

const none = (reason: string): Cell => ({ text: '—', reason });

/** 41,58972° N  4,72497° O (Spanish uses O for oeste). */
export function formatLatLon(lat: number, lng: number, digits = 5) {
  const ns = lat >= 0 ? 'N' : 'S',
    ew = lng >= 0 ? 'E' : 'O';
  return `${number(Math.abs(lat), digits)}°${NBSP}${ns}${NBSP}${NBSP}${number(Math.abs(lng), digits)}°${NBSP}${ew}`;
}

/** 4605661,6 → 4 605 661,6: groups of three with non-breaking spaces, as surveyors write them. */
export function grouped(value: number, digits = 1) {
  const [int, dec] = Math.abs(value).toFixed(digits).split('.');
  const groups = int!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${value < 0 ? MINUS : ''}${groups}${dec ? `,${dec}` : ''}`;
}

/** UTM 30N easting and northing: 356 225,5  4 605 661,6. */
export function formatUtm(lng: number, lat: number) {
  const { easting, northing } = toUtm(lng, lat);
  return `${grouped(easting)}${NBSP}${NBSP}${grouped(northing)}`;
}

/** 737,7 m */
export const formatMetres = (m: number, digits = 1) => `${number(m, digits)}${NBSP}m`;

/** +37,6 m · −0,4 m · 0,0 m: the height above the ground always carries its sign. */
export function formatSigned(m: number, digits = 1) {
  const rounded = Number(m.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : '';
  return `${sign}${number(Math.abs(rounded), digits)}${NBSP}m`;
}

export function readout({ point, ground, geoid, relief, missing }: ReadoutInput): Readout {
  if (!point) {
    const why = missing ?? NO_CURSOR;
    return {
      position: none(why),
      utm: none(why),
      cota: none(why),
      suelo: none(why),
      sobre: none(why),
    };
  }
  const position = { text: formatLatLon(point.lat, point.lng) };
  const utm = { text: formatUtm(point.lng, point.lat) };
  // Without the relief globeShift lowers the clouds by about 700 m: no height would be true.
  if (!relief)
    return { position, utm, cota: none(NO_RELIEF), suelo: none(NO_RELIEF), sobre: none(NO_RELIEF) };
  if (ground === null || geoid === null)
    return { position, utm, cota: none(OUTSIDE), suelo: none(OUTSIDE), sobre: none(OUTSIDE) };
  return {
    position,
    utm,
    cota: { text: formatMetres(point.h - geoid) },
    suelo: { text: formatMetres(ground - geoid) },
    sobre: { text: formatSigned(point.h - ground) },
  };
}

export interface ScaleBar {
  /** Length of the bar in metres (a round number) and in pixels. */
  metres: number;
  px: number;
  labels: [string, string, string];
}

/** 25 → «25», 2,5 → «2,5», 1000 → «1 km» (the unit only on the last label). */
function scaleLabel(m: number, unit: boolean) {
  if (m >= 1000) return `${number(m / 1000, m % 1000 ? 1 : 0)}${unit ? `${NBSP}km` : ''}`;
  const digits = Number.isInteger(m) ? 0 : m * 10 === Math.round(m * 10) ? 1 : 2;
  return `${number(m, digits)}${unit ? `${NBSP}m` : ''}`;
}

/**
 * The longest round length (1, 2 or 5 × 10ⁿ m, whose halves are round too) that fits in `maxPx` at `metresPerPixel`
 * (measured at the centre of the view), with labels for 0, the half and the end.
 */
export function niceScale(metresPerPixel: number, maxPx = 160): ScaleBar | null {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null;
  const longest = metresPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(longest));
  const step = [5, 2, 1].find((m) => m * power <= longest) ?? 1;
  const metres = Number((step * power).toPrecision(6));
  const half = metres / 2;
  const unitKm = metres >= 1000;
  return {
    metres,
    px: metres / metresPerPixel,
    labels: [
      '0',
      unitKm && half < 1000 ? scaleLabel(half, true) : scaleLabel(half, false),
      scaleLabel(metres, true),
    ],
  };
}

/** Geoid undulation N of the ready LiDAR sheet whose box holds (lng, lat), or null. */
export function geoidAt(
  layers: Pick<Layer, 'status' | 'bbox' | 'vertical'>[],
  lng: number,
  lat: number,
) {
  for (const layer of layers) {
    const box = layer.bbox,
      n = layer.vertical.geoid_offset_m;
    if (layer.status !== 'ready' || !box || n === null) continue;
    if (lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3]) return n;
  }
  return null;
}

/**
 * The readout for an asset (the one under the pointer, or the selected one): its known position,
 * mounted `mount` metres above the ground model, so its Cota is the DTM plus the mount and «Sobre
 * el suelo» the mount itself.
 */
export function assetReadout(
  asset: { location: { lng: number; lat: number }; mount_height_m: number },
  ground: number | null,
  geoid: number | null,
  relief: boolean,
): Readout {
  const { lng, lat } = asset.location;
  return readout({
    point: { lng, lat, h: (ground ?? 0) + asset.mount_height_m },
    ground,
    geoid,
    relief,
  });
}

/**
 * What moves the asset the readout calls «Activo» (the one whose mark or tag is under the pointer):
 * - `over`: the pointer entered an element (`asset` is the mark's asset, or null off the marks).
 *   Only a mouse hovers: a tap (finger or pen) selects the asset, and leaves no «Activo» behind.
 * - `out`: the pointer left an element; `page` when it left the page altogether.
 * - `recheck`: the mark now under the still pointer (after a frame, or when the marks change),
 *   since a mark can move away from the pointer or be taken out without any pointer event. It
 *   only keeps or drops the asset already shown: a new one waits for the pointer to move.
 */
export type HoverEvent =
  | { type: 'over'; pointer: string; asset: string | null }
  | { type: 'out'; pointer: string; page: boolean }
  | { type: 'recheck'; asset: string | null };
export function nextHover(current: string | null, event: HoverEvent): string | null {
  switch (event.type) {
    case 'over':
      return event.pointer === 'mouse' ? event.asset : null;
    case 'out':
      return event.page || event.pointer !== 'mouse' ? null : current;
    case 'recheck':
      return current === null ? null : event.asset;
  }
}

/**
 * The readout for the point under the profile chart's cursor: the LiDAR point there (or the
 * ground, where the slab has no point), with altitudes as the chart gives them (h − N).
 */
export function profileReadout(r: {
  lng: number;
  lat: number;
  z: number | null;
  ground: number | null;
  geoid: number;
}): Readout {
  const h = r.z ?? r.ground;
  return readout({
    point: { lng: r.lng, lat: r.lat, h: (h ?? 0) + r.geoid },
    ground: r.ground === null ? null : r.ground + r.geoid,
    geoid: h === null ? null : r.geoid,
    relief: true,
  });
}
