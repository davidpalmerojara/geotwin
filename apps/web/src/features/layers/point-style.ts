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

// maximumScreenSpaceError per quality level: lower means more detail and more tiles.
export const QUALITY_SSE: Record<Quality, number> = { low: 24, medium: 12, high: 4 };

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
 * Point-cloud shading: attenuation sizes points by the tile's geometric error (so sparse,
 * coarse tiles still look solid) up to `pointSize` pixels, and eye-dome lighting adds depth
 * cues to points that carry no normals.
 */
export function shadingFor(pointSize: number, baseResolution?: number) {
  return {
    attenuation: true,
    maximumAttenuation: Math.min(Math.max(pointSize, 1), 8),
    geometricErrorScale: 1,
    baseResolution,
    eyeDomeLighting: true,
    eyeDomeLightingStrength: 0.8,
    eyeDomeLightingRadius: 1.0,
  };
}

/** How far to lower a tileset so its lowest point rests on the bare ellipsoid (basic globe). */
export function globeShift(range: { min: number } | undefined, onTerrain: boolean) {
  return !onTerrain && range ? range.min : 0;
}
