/**
 * Pure builders for the 3D Tiles style of a point-cloud layer (Cesium3DTileStyle JSON) and the
 * point-cloud shading options. No Cesium import: the viewer wraps the result in
 * `new Cesium3DTileStyle(json)`, and the tests check the expressions directly.
 */
import type { Layer } from '@geotwin/shared';

export type ColorMode = 'rgb' | 'height' | 'classification';
export type ClassGroup = 'ground' | 'vegetation' | 'buildings' | 'water' | 'other';
export type Quality = 'low' | 'medium' | 'high';

// ASPRS LAS 1.4 standard classes. The colours are this project's own legend (ASPRS defines the
// codes, not a palette).
export const ASPRS_CLASSES: Record<number, { name: string; color: string }> = {
  1: { name: 'Sin clasificar', color: '#9aa5b1' },
  2: { name: 'Suelo', color: '#b08a5a' },
  3: { name: 'Vegetación baja', color: '#b7d77a' },
  4: { name: 'Vegetación media', color: '#6fbf4a' },
  5: { name: 'Vegetación alta', color: '#2f8f3a' },
  6: { name: 'Edificación', color: '#e3664d' },
  7: { name: 'Ruido bajo', color: '#d946ef' },
  9: { name: 'Agua', color: '#3b8fd9' },
  17: { name: 'Tablero de puente', color: '#f2c14e' },
  18: { name: 'Ruido alto', color: '#d946ef' },
};
const OTHER_COLOR = '#9aa5b1';

export const CLASS_GROUPS: { key: ClassGroup; label: string; codes: number[]; color: string }[] = [
  { key: 'ground', label: 'Suelo', codes: [2], color: ASPRS_CLASSES[2]!.color },
  { key: 'vegetation', label: 'Vegetación', codes: [3, 4, 5], color: ASPRS_CLASSES[4]!.color },
  { key: 'buildings', label: 'Edificios', codes: [6], color: ASPRS_CLASSES[6]!.color },
  { key: 'water', label: 'Agua', codes: [9], color: ASPRS_CLASSES[9]!.color },
  // Everything else: unclassified, noise, bridges, wires…
  { key: 'other', label: 'Otros', codes: [], color: OTHER_COLOR },
];
export const ALL_CLASS_GROUPS: Record<ClassGroup, boolean> = {
  ground: true,
  vegetation: true,
  buildings: true,
  water: true,
  other: true,
};
const EXPLICIT_CODES = CLASS_GROUPS.flatMap((g) => g.codes);

/**
 * How much of the cloud is drawn. «Híbrido (sin suelo)» hides the ground and water returns, so
 * the ground is the orthophoto draped on the LiDAR relief while buildings, vegetation and the
 * rest stay as points.
 */
export type PointMode = 'all' | 'hybrid';
export const HYBRID_HIDDEN: ClassGroup[] = ['ground', 'water'];

/** The class groups actually drawn: the user's choice, minus ground and water in hybrid mode. */
export function effectiveClasses(
  classes: Record<ClassGroup, boolean>,
  mode: PointMode,
): Record<ClassGroup, boolean> {
  if (mode !== 'hybrid') return classes;
  const result = { ...classes };
  for (const group of HYBRID_HIDDEN) result[group] = false;
  return result;
}

// Height ramp, low to high (blue → green → yellow → red), sampled from a spectral scheme.
export const HEIGHT_RAMP = [
  '#2c7bb6',
  '#00a6ca',
  '#00ccbc',
  '#90eb9d',
  '#ffff8c',
  '#f9d057',
  '#f29e2e',
  '#e76818',
  '#d7191c',
];

/**
 * Quality presets: `sse` is the tilesets' maximumScreenSpaceError (lower means finer tiles, more
 * of them) and `cacheMB` the tile cache of each layer (a PNOA sheet holds about 100 MB of tiles,
 * so «Alta» can keep a whole sheet loaded while the camera moves around it). `imageryLevel` is
 * the deepest PNOA orthophoto level drawn.
 */
export const QUALITY: Record<Quality, { sse: number; cacheMB: number; imageryLevel: number }> = {
  low: { sse: 16, cacheMB: 64, imageryLevel: 18 },
  medium: { sse: 12, cacheMB: 128, imageryLevel: 19 },
  high: { sse: 3, cacheMB: 256, imageryLevel: 19 },
};

/**
 * Deepest orthophoto level for a quality preset (z19 is the native 25 cm; z18, 45 cm, needs a
 * quarter of the tiles). Read once, when the photo layer is created.
 */
export const imageryLevelFor = (quality: Quality) => QUALITY[quality].imageryLevel;

/**
 * Defaults for a device: phones and small or low-memory devices start at «Baja» with 3 px
 * points, so they stay responsive; the rest at «Media» with 4 px.
 */
export function displayDefaults(device: {
  narrow: boolean;
  coarsePointer: boolean;
  memoryGB?: number;
}): { quality: Quality; pointSize: number } {
  const small = device.narrow || device.coarsePointer || (device.memoryGB ?? 8) <= 4;
  return small ? { quality: 'low', pointSize: 3 } : { quality: 'medium', pointSize: 4 };
}

const CLASS = '${classification}';

/** Show expression for the enabled class groups; undefined when every class is shown. */
export function classFilter(groups: Record<ClassGroup, boolean>): string | undefined {
  const enabled = CLASS_GROUPS.filter((g) => groups[g.key]);
  if (enabled.length === CLASS_GROUPS.length) return undefined;
  if (!enabled.length) return 'false';
  return enabled
    .map((g) =>
      g.key === 'other'
        ? `(${EXPLICIT_CODES.map((c) => `${CLASS} !== ${c}`).join(' && ')})`
        : g.codes.map((c) => `${CLASS} === ${c}`).join(' || '),
    )
    .join(' || ');
}

/**
 * Ellipsoidal height of a point near (lat, lng) from its ECEF position, as a style expression.
 * The geodetic normal n at the reference point is (cos φ cos λ, cos φ sin λ, sin φ), and a point
 * at height h on that normal satisfies dot(P, n) = a·sqrt(1 − e²·sin²φ) + h exactly; nearby points
 * are off by d²/2R (2 cm at 500 m). `shift` is how far the tileset was lowered along n; it is
 * added back, so the expression always yields the real ellipsoidal height.
 */
export function heightExpression(lat: number, lng: number, shift = 0) {
  const a = 6378137,
    e2 = 6.69437999014e-3;
  const phi = (lat * Math.PI) / 180,
    lambda = (lng * Math.PI) / 180;
  const n = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const d = a * Math.sqrt(1 - e2 * Math.sin(phi) ** 2) - shift;
  return {
    normal: n as [number, number, number],
    offset: d,
    expression: `dot(\${POSITION_ABSOLUTE}, vec3(${n.map((v) => v.toFixed(12)).join(', ')})) - ${d.toFixed(3)}`,
  };
}

/** Ellipsoidal height range of a processed layer (file heights plus the geoid N applied). */
export function ellipsoidalRange(layer: Pick<Layer, 'height_range_m' | 'vertical'>) {
  if (!layer.height_range_m) return undefined;
  const n = layer.vertical.datum === 'ellipsoidal' ? 0 : (layer.vertical.geoid_offset_m ?? 0);
  return { min: layer.height_range_m.min + n, max: layer.height_range_m.max + n };
}

type Ranged = Pick<Layer, 'height_range_m' | 'vertical'>;
/** Metres from a sheet's Cota (h − N, as the readout gives it) to its ellipsoidal heights. */
const cotaOffset = (layer: Ranged) => layer.vertical.geoid_offset_m ?? 0;

/** Height range of a processed layer as Cota: ellipsoidal heights minus the sheet's geoid N. */
export function cotaRange(layer: Ranged) {
  const range = ellipsoidalRange(layer);
  if (!range) return undefined;
  const n = cotaOffset(layer);
  return { min: range.min - n, max: range.max - n };
}

/**
 * The one Cota range that Altura colours on every sheet drawn: the union of their ranges, so a
 * colour means the same height on all of them and the ruler can label it. Undefined when no
 * sheet has a range.
 */
export function sharedCotaRange(layers: Ranged[]) {
  let shared: { min: number; max: number } | undefined;
  for (const layer of layers) {
    const range = cotaRange(layer);
    if (!range) continue;
    shared = shared
      ? { min: Math.min(shared.min, range.min), max: Math.max(shared.max, range.max) }
      : range;
  }
  return shared;
}

/**
 * What Altura colours over: the shared Cota range of the ready sheets that are shown, and how many
 * they are (hidden sheets do not stretch the colours of the others).
 */
export function heightLegend(
  layers: (Ranged & Pick<Layer, 'id' | 'status'>)[],
  hidden: Record<string, boolean>,
) {
  const shown = layers.filter((l) => l.status === 'ready' && !hidden[l.id] && l.height_range_m);
  const range = sharedCotaRange(shown);
  return range ? { range, sheets: shown.length } : undefined;
}

/**
 * The ellipsoidal range a sheet's style ramps over so that it paints the shared Cota range: each
 * sheet adds its own geoid N, so two sheets give one colour to one Cota.
 */
export function sheetRampRange(layer: Ranged, shared: { min: number; max: number }) {
  const n = cotaOffset(layer);
  return { min: shared.min + n, max: shared.max + n };
}

export interface RulerScale {
  /** Round ends of the ruler (multiples of `step`), around the coloured range. */
  low: number;
  high: number;
  /** Metres between labelled ticks; unlabelled ticks fall halfway. */
  step: number;
  ticks: { z: number; major: boolean }[];
}

/**
 * Ticks of the height ruler: labels every 1, 2 or 5 × 10ⁿ m, about `majors` of them over the
 * range, a short tick halfway, and round ends (692,8–746,6 m gives 690 to 750 every 10 m, as
 * A/desktop-capas).
 */
export function rulerScale(min: number, max: number, majors = 6): RulerScale {
  const span = Math.max(max - min, 1);
  const raw = span / majors;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const low = Math.floor(min / step) * step,
    high = Math.max(Math.ceil(max / step) * step, low + step);
  const ticks: RulerScale['ticks'] = [];
  const count = Math.round((high - low) / (step / 2));
  for (let i = 0; i <= count; i++)
    ticks.push({ z: Number((low + (i * step) / 2).toPrecision(12)), major: i % 2 === 0 });
  return { low, high, step, ticks };
}

/** Upper bounds of the height bins: HEIGHT_RAMP[i] colours heights below bounds[i]. */
export function rampBounds(min: number, max: number, steps = HEIGHT_RAMP.length) {
  const span = Math.max(max - min, 0.01);
  return Array.from({ length: steps - 1 }, (_, i) => min + (span * (i + 1)) / steps);
}

export interface StyleInput {
  mode: ColorMode;
  classes: Record<ClassGroup, boolean>;
  // Needed for the height ramp: reference point and ellipsoidal range of the layer.
  center?: { lat: number; lng: number } | null;
  range?: { min: number; max: number };
  // Metres the tileset was lowered along the normal at `center` (basic globe placement).
  shift?: number;
}
export interface StyleJson {
  show?: string;
  color?: string | { conditions: [string, string][] };
  defines?: Record<string, string>;
}

/** Cesium3DTileStyle JSON for a layer. RGB mode keeps the colours stored in the points. */
export function buildPointCloudStyle(input: StyleInput): StyleJson {
  const style: StyleJson = {};
  const show = classFilter(input.classes);
  if (show) style.show = show;
  if (input.mode === 'classification') {
    style.color = {
      conditions: [
        ...Object.entries(ASPRS_CLASSES).map(
          ([code, c]) => [`${CLASS} === ${code}`, `color('${c.color}')`] as [string, string],
        ),
        ['true', `color('${OTHER_COLOR}')`],
      ],
    };
  } else if (input.mode === 'height' && input.center && input.range) {
    const shift = input.shift ?? 0;
    const height = heightExpression(input.center.lat, input.center.lng, shift);
    const bounds = rampBounds(input.range.min, input.range.max);
    style.defines = { h: height.expression };
    style.color = {
      conditions: [
        ...bounds.map(
          (b, i) => [`\${h} < ${b.toFixed(2)}`, `color('${HEIGHT_RAMP[i]}')`] as [string, string],
        ),
        ['true', `color('${HEIGHT_RAMP.at(-1)}')`],
      ],
    };
  }
  return style;
}

/**
 * Average horizontal point spacing in metres, from the footprint and the point count (PNOA cob3:
 * about 0.45 m at 5 pts/m²). py3dtiles leaves the leaf tiles' geometric error at 0, and Cesium
 * would otherwise estimate it from each tile's volume, which for flat ground gives points a pixel
 * wide; this is the `baseResolution` it uses instead.
 */
export function pointSpacing(layer: Pick<Layer, 'bbox' | 'point_count'>) {
  if (!layer.bbox || !layer.point_count) return undefined;
  const [west, south, east, north] = layer.bbox;
  const lat = (((south + north) / 2) * Math.PI) / 180;
  const area = (east - west) * 111320 * Math.cos(lat) * ((north - south) * 110574);
  return area > 0 ? Math.sqrt(area / layer.point_count) : undefined;
}

/**
 * Point-cloud shading. Attenuation sizes each point from its tile's geometric error (the layer's
 * point spacing for the finest tiles), up to `pointSize` pixels: coarse tiles seen from afar get
 * points large enough to close the gaps, and close up no point grows past `pointSize`, so the
 * cloud does not turn into blobs. Measured on the Laguna sheets, 4 px closes the gaps at middle
 * distances and 5-6 px already looks like overlapping scales. Eye-dome lighting darkens every
 * depth step (building edges, tree crowns): it helps to read shapes but draws outlines that make
 * the cloud look like a drawing, so it is optional and softer than Cesium's default (1, 1).
 */
export function shadingFor(pointSize: number, baseResolution?: number, edl = false) {
  return {
    attenuation: true,
    maximumAttenuation: Math.min(Math.max(pointSize, 1), 8),
    geometricErrorScale: 1,
    baseResolution,
    eyeDomeLighting: edl,
    eyeDomeLightingStrength: 0.35,
    eyeDomeLightingRadius: 0.75,
  };
}

/**
 * Fragment shader for round points (Cesium CustomShader, MODIFY_MATERIAL mode). Square points
 * read as pixel blocks; a disc with a slightly darker rim reads as a small rounded splat. There
 * is no vertex shader on purpose: a custom one would replace the size Cesium's attenuation gives
 * each point. It only discards fragments outside the circle and shades the rest, so the 3D Tiles
 * style (RGB, height ramp, classification) is left as it is, and picking still hits the discs.
 */
export const ROUND_POINTS_GLSL = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float r2 = dot(offset, offset) * 4.0;
  if (r2 > 1.0) discard;
  material.diffuse *= 1.0 - 0.18 * r2;
}
`;

/** How far to lower a tileset so its lowest point rests on the bare ellipsoid (basic globe). */
export function globeShift(range: { min: number } | undefined, onTerrain: boolean) {
  return !onTerrain && range ? range.min : 0;
}
