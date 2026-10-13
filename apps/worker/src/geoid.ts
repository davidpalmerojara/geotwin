import { meanSeaLevel } from 'egm96-universal';
import type { GeoidMethod } from '@geotwin/shared';

/**
 * Vertical datum: PNOA-LiDAR heights are orthometric (H, above the REDNAP geoid); Cesium and 3D
 * Tiles in EPSG:4978 need ellipsoidal heights (h, above GRS80/WGS84). h = H + N, where N is the
 * geoid undulation, about +53 m around Valladolid. See docs/architecture.md for the error budget.
 */

/**
 * N (m) from the EGM96 15' grid bundled in the `egm96-universal` npm package (MIT; EGM96 itself is
 * public-domain NGA data), bilinearly interpolated. Against the official EGM08-REDNAP grid it is
 * +0.49 m high at Laguna de Duero and 0.06 to 0.93 m high across Valladolid province.
 */
export function egm96Undulation(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90)
    throw new RangeError(`Invalid coordinates ${lat}, ${lng}`);
  return meanSeaLevel(lat, lng);
}

export interface VerticalInput {
  datum: 'orthometric' | 'ellipsoidal';
  /** Per-layer override chosen at upload (m). */
  layerOverride: number | null;
  /** Worker-wide override from GEOID_OFFSET_M (m). */
  envOverride: number | undefined;
  /** N from the official grid at the tile centre, when the grid is installed. */
  gridOffset: number | null;
  center: { lat: number; lng: number };
}
export interface VerticalPlan {
  method: GeoidMethod;
  /** N applied (or, for the grid method, N at the centre; PROJ applies it per point). */
  offset_m: number;
  /** True: per-point transformation through PROJ and the official grid. */
  exact: boolean;
}

/**
 * Chooses how to turn orthometric heights into ellipsoidal ones, most explicit first:
 * 1. source already ellipsoidal → nothing to do;
 * 2. a per-layer override, then a worker-wide override → that constant;
 * 3. the official EGM08-REDNAP grid installed → per point through PROJ (EPSG:25830+5782);
 * 4. otherwise → EGM96 N at the tile centre as a constant.
 * Over a 1 x 1 km PNOA tile N varies by under 2 cm, so a constant at the centre is enough; the
 * model error (EGM96 vs EGM08-REDNAP, ~0.5 m here) dominates.
 */
export function planVertical(input: VerticalInput): VerticalPlan {
  if (input.datum === 'ellipsoidal') return { method: 'none', offset_m: 0, exact: false };
  if (input.layerOverride !== null)
    return { method: 'override', offset_m: input.layerOverride, exact: false };
  if (input.envOverride !== undefined)
    return { method: 'override', offset_m: input.envOverride, exact: false };
  if (input.gridOffset !== null)
    return { method: 'egm08_rednap_grid', offset_m: round(input.gridOffset), exact: true };
  return {
    method: 'egm96_centre',
    offset_m: round(egm96Undulation(input.center.lat, input.center.lng)),
    exact: false,
  };
}
function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
