/**
 * Measurements drawn as dimension lines on the cloud (from direction A): a 1,5 px line in signal
 * yellow over a dark halo, dashed where something hides it, ticks across its ends and the value
 * in Plex Mono 500 13 px on a yellow label. The geometry is worked out by `measureDimensions` and
 * `mountDimension` (pure, unit-tested); `drawDimensions` turns it into entities.
 */
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  Ellipsoid,
  HorizontalOrigin,
  LabelStyle,
  PolylineDashMaterialProperty,
  PolylineOutlineMaterialProperty,
  VerticalOrigin,
  type CustomDataSource,
} from 'cesium';
import { number } from '../../lib/format';
import { formatArea, formatHeight, formatLength, groundDistance, horizontalArea } from './geodesy';

const ellipsoid = Ellipsoid.WGS84;
/** Below this horizontal spread (m) a height difference is already the line itself. */
const VERTICAL_SPREAD_M = 2;
/** Height differences below this (m) get no vertical dimension: it would be a speck. */
const MIN_HEIGHT_M = 1;

/** Where a label sits next to its point: centred on it, or beside it (vertical dimensions). */
export type LabelSide = 'center' | 'left' | 'right';
export interface DimensionLabel {
  at: Cartesian3;
  text: string;
  side: LabelSide;
}
export interface Dimension {
  kind: 'distance' | 'area' | 'height' | 'mount';
  /** The polyline. */
  line: Cartesian3[];
  /** A tick across the line at each point, perpendicular to `along` (a unit ECEF vector). */
  ticks: { at: Cartesian3; along: Cartesian3 }[];
  labels: DimensionLabel[];
}

const midpoint = (a: Cartesian3, b: Cartesian3) => Cartesian3.midpoint(a, b, new Cartesian3());
const direction = (a: Cartesian3, b: Cartesian3) => {
  const d = Cartesian3.subtract(b, a, new Cartesian3());
  return Cartesian3.magnitude(d) > 1e-9 ? Cartesian3.normalize(d, d) : up(a);
};
const up = (p: Cartesian3) => ellipsoid.geodeticSurfaceNormal(p, new Cartesian3());

/** A vertical dimension from `top` straight down to `height` (ellipsoidal metres). */
function vertical(
  top: Cartesian3,
  height: number,
  kind: 'height' | 'mount',
  text: string,
  side: LabelSide = 'left',
) {
  const c = ellipsoid.cartesianToCartographic(top, new Cartographic());
  const foot = Cartesian3.fromRadians(c.longitude, c.latitude, height, ellipsoid);
  const axis = up(top);
  return {
    kind,
    line: [foot, Cartesian3.clone(top)],
    ticks: [
      { at: foot, along: axis },
      { at: Cartesian3.clone(top), along: axis },
    ],
    labels: [{ at: midpoint(foot, top), text, side }],
  };
}

/**
 * The dimensions of a measurement. Distance: the line through the points with the length of each
 * segment at its middle and, with more than one segment, the total at the last point; plus the
 * height difference between the first and last point as a vertical dimension at the higher one
 * (unless they are one above the other: then the line already is that dimension). Area: the
 * closed outline with the horizontal area at the centroid.
 */
export function measureDimensions(points: Cartesian3[], mode: 'distance' | 'area'): Dimension[] {
  if (points.length < 2) return [];
  if (mode === 'area') {
    const closed = points.length > 2 ? [...points, points[0]!] : points;
    const centroid = Cartesian3.multiplyByScalar(
      points.reduce((sum, p) => Cartesian3.add(sum, p, sum), new Cartesian3()),
      1 / points.length,
      new Cartesian3(),
    );
    return [
      {
        kind: 'area',
        line: closed,
        ticks: points.map((p, i) => ({ at: p, along: direction(p, closed[i + 1] ?? p) })),
        labels:
          points.length > 2
            ? [{ at: centroid, text: formatArea(horizontalArea(points)), side: 'center' }]
            : [],
      },
    ];
  }
  const labels: DimensionLabel[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const length = Cartesian3.distance(a, b);
    total += length;
    labels.push({ at: midpoint(a, b), text: formatLength(length), side: 'center' });
  }
  if (points.length > 2)
    labels.push({ at: points.at(-1)!, text: `total ${formatLength(total)}`, side: 'center' });
  const dimensions: Dimension[] = [
    {
      kind: 'distance',
      line: points,
      ticks: points.map((p, i) => ({
        at: p,
        along: i === 0 ? direction(p, points[1]!) : direction(points[i - 1]!, p),
      })),
      labels,
    },
  ];
  const first = ellipsoid.cartesianToCartographic(points[0]!);
  const last = ellipsoid.cartesianToCartographic(points.at(-1)!);
  const dh = last.height - first.height;
  if (
    Math.abs(dh) >= MIN_HEIGHT_M &&
    groundDistance([points[0]!, points.at(-1)!]) >= VERTICAL_SPREAD_M
  ) {
    const [high, low] = dh > 0 ? [points.at(-1)!, first] : [points[0]!, last];
    // Its value goes to the right: the segment's value sits at the middle of the line.
    dimensions.push(vertical(high, low.height, 'height', `desnivel ${formatHeight(dh)}`, 'right'));
  }
  return dimensions;
}

/** «41,9 m sobre el suelo»: from the ground model up to an asset's mounting point. */
export function mountText(metres: number) {
  return `${number(metres, 1)} m sobre el suelo`;
}
/** The selected asset's mounting height: a vertical dimension from the ground to its mark. */
export function mountDimension(lng: number, lat: number, ground: number, mount: number) {
  return vertical(
    Cartesian3.fromDegrees(lng, lat, ground + mount),
    ground,
    'mount',
    mountText(mount),
  );
}

const SIG = Color.fromCssColorString('#FFD21A'),
  SIG_INK = Color.fromCssColorString('#191500'),
  INK = Color.fromCssColorString('#0E0E0D');
export const DIMENSION_FONT = '500 13px "IBM Plex Mono", monospace';

let tickImage: HTMLCanvasElement | undefined;
/** A 14 × 4 px yellow bar with a dark edge: across the line once aligned to it. */
function tick() {
  if (tickImage) return tickImage;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 5;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#0E0E0D';
    g.fillRect(0, 0, 16, 5);
    g.fillStyle = '#FFD21A';
    g.fillRect(1, 1, 14, 3);
  }
  tickImage = canvas;
  return canvas;
}

let fonts: Promise<unknown> | undefined;
/** Labels are rasterised once: the mono font has to be in before the first one is drawn. */
export function dimensionFontReady() {
  fonts ??= document.fonts?.load(DIMENSION_FONT).catch(() => undefined) ?? Promise.resolve();
  return fonts;
}

/**
 * Adds the dimensions to a data source as entities with ids `<prefix>:linea:<n>`,
 * `<prefix>:marca:<n>:<m>` and `<prefix>:etiqueta:<n>:<m>`. Returns the entities added.
 */
export function drawDimensions(source: CustomDataSource, dimensions: Dimension[], prefix: string) {
  const added = [];
  for (const [n, d] of dimensions.entries()) {
    added.push(
      source.entities.add({
        id: `${prefix}:linea:${n}`,
        polyline: {
          positions: d.line,
          // 1,5 px of yellow inside a dark halo; dashed where the cloud is in front.
          width: 3.5,
          arcType: ArcType.NONE,
          material: new PolylineOutlineMaterialProperty({
            color: SIG,
            outlineColor: INK.withAlpha(0.85),
            outlineWidth: 1,
          }),
          depthFailMaterial: new PolylineDashMaterialProperty({
            color: SIG,
            gapColor: INK.withAlpha(0.35),
            dashLength: 10,
          }),
        },
      }),
    );
    for (const [m, t] of d.ticks.entries())
      added.push(
        source.entities.add({
          id: `${prefix}:marca:${n}:${m}`,
          position: t.at,
          billboard: {
            image: tick(),
            alignedAxis: new ConstantProperty(t.along),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    for (const [m, label] of d.labels.entries())
      added.push(
        source.entities.add({
          id: `${prefix}:etiqueta:${n}:${m}`,
          position: label.at,
          label: {
            text: label.text,
            font: DIMENSION_FONT,
            fillColor: SIG_INK,
            style: LabelStyle.FILL,
            showBackground: true,
            backgroundColor: SIG,
            backgroundPadding: new Cartesian2(5, 3),
            horizontalOrigin:
              label.side === 'left'
                ? HorizontalOrigin.RIGHT
                : label.side === 'right'
                  ? HorizontalOrigin.LEFT
                  : HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(
              label.side === 'left' ? -10 : label.side === 'right' ? 10 : 0,
              0,
            ),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
  }
  return added;
}
