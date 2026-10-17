/**
 * Where the PNOA orthophoto comes from, without importing Cesium: the viewer builds the imagery
 * providers from these descriptions, and the tests check the URLs, the probe and the failover.
 *
 * Sources are tried in order (VITE_PNOA_SOURCES, default "local,idee,ign"):
 *  - local: XYZ tiles unpacked into apps/web/public/ortho/ (scripts/fetch-ortho.sh), z13-z19 over
 *    the 8 LiDAR sheets of Laguna de Duero. Only present when someone downloaded them.
 *  - idee:  the TMS mirror of the PNOA at tms-pnoa-ma.idee.es (rows counted from the south).
 *  - ign:   the IGN WMTS (KVP GetTile), the service the viewer used before.
 * Each source is probed with one tile at Torrelago before it is added: the first that answers
 * with an image is used. Under it there is only the dark ground of the globe («Neutro»): when no
 * source works the base falls back to it. The Natural Earth atlas (shipped with Cesium, no network)
 * is an option of its own, never the fallback.
 */
export type PnoaSourceId = 'local' | 'idee' | 'ign';
export type BaseImagery = 'pnoa' | 'neutral' | 'natural-earth';
export type PnoaState = 'off' | 'probing' | 'on' | 'error';

/** West, south, east, north in degrees. */
export type DegreesRectangle = [number, number, number, number];

export interface PnoaSource {
  id: PnoaSourceId;
  /** `template`: XYZ/TMS URL with {z} {x} {y} {reverseY}; `wmts`: KVP GetTile base URL. */
  kind: 'template' | 'wmts';
  url: string;
  minimumLevel: number;
  maximumLevel: number;
  rectangle: DegreesRectangle;
  /** A tile that must exist if the source works (Torrelago, z15). */
  probeUrl: string;
}

// The 8 LiDAR sheets (ETRS89 UTM 30N X 355000-358000, Y 4603000-4606000) with ~150 m of margin.
export const LAGUNA_BBOX: DegreesRectangle = [-4.7418, 41.5642, -4.7012, 41.5945];
// Peninsular Spain and the Balearics, as the WMTS was configured before.
export const PNOA_COVERAGE: DegreesRectangle = [-10, 35, 5, 45];
// z19 is 0.22 m/px at 41.58° N, the native 25 cm of the PNOA: deeper levels add no detail.
export const PNOA_MAX_LEVEL = 19;
// Torrelago, z15, XYZ rows (counted from the north).
export const PROBE_TILE = { z: 15, x: 15953, y: 12214 } as const;

export const IDEE_TEMPLATE = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{reverseY}.jpeg';
export const IGN_WMTS = 'https://www.ign.es/wmts/pnoa-ma';
export const IGN_WMTS_LAYER = 'OI.OrthoimageCoverage';
export const LOCAL_TEMPLATE = '/ortho/{z}/{x}/{y}.jpg';
export const DEFAULT_SOURCES: PnoaSourceId[] = ['local', 'idee', 'ign'];

/**
 * On-screen credit while the orthophoto is visible: the licence formula of Orden FOM/2807/2015
 * (<identificador> CC-BY 4.0 scne.es) and the IGN as the producer. No year: the "máxima
 * actualidad" mosaic changes over time.
 */
export const PNOA_CREDIT_HTML =
  'Ortofoto PNOA máxima actualidad CC-BY 4.0 <a href="https://www.scne.es/" target="_blank" rel="noopener">scne.es</a> · cedido por © Instituto Geográfico Nacional';

export const PNOA_UNAVAILABLE =
  'No se pudo cargar la ortofoto PNOA (sin conexión o bloqueada por el navegador). Se muestra el fondo neutro.';

/** TMS row (counted from the south) of an XYZ row (counted from the north). */
export const tmsY = (z: number, y: number) => 2 ** z - 1 - y;

/** Fills an XYZ/TMS template: {z}, {x}, {y} (from the north) and {reverseY} (from the south). */
export function expandTemplate(template: string, tile: { z: number; x: number; y: number }) {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{reverseY}', String(tmsY(tile.z, tile.y)))
    .replaceAll('{y}', String(tile.y));
}

/** KVP GetTile URL, with the same parameters Cesium's WMTS provider sends. */
export function wmtsTileUrl(base: string, tile: { z: number; x: number; y: number }) {
  const query = new URLSearchParams({
    service: 'WMTS',
    version: '1.0.0',
    request: 'GetTile',
    layer: IGN_WMTS_LAYER,
    style: 'default',
    format: 'image/jpeg',
    tilematrixset: 'GoogleMapsCompatible',
    tilematrix: String(tile.z),
    tilerow: String(tile.y),
    tilecol: String(tile.x),
  });
  return `${base}?${query.toString()}`;
}

/** "local,idee" → ['local', 'idee']; unknown names and repeats are dropped, empty → default. */
export function parseSources(value: string | undefined): PnoaSourceId[] {
  const known = new Set<string>(DEFAULT_SOURCES);
  const ids = (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PnoaSourceId => known.has(s));
  const unique = [...new Set(ids)];
  return unique.length ? unique : [...DEFAULT_SOURCES];
}

export function pnoaSources(env: { sources?: string; tileUrl?: string } = {}): PnoaSource[] {
  const idee = env.tileUrl?.trim() || IDEE_TEMPLATE;
  const all: Record<PnoaSourceId, PnoaSource> = {
    local: {
      id: 'local',
      kind: 'template',
      url: LOCAL_TEMPLATE,
      minimumLevel: 13,
      maximumLevel: PNOA_MAX_LEVEL,
      rectangle: LAGUNA_BBOX,
      probeUrl: expandTemplate(LOCAL_TEMPLATE, PROBE_TILE),
    },
    idee: {
      id: 'idee',
      kind: 'template',
      url: idee,
      minimumLevel: 0,
      maximumLevel: PNOA_MAX_LEVEL,
      rectangle: PNOA_COVERAGE,
      probeUrl: expandTemplate(idee, PROBE_TILE),
    },
    ign: {
      id: 'ign',
      kind: 'wmts',
      url: IGN_WMTS,
      minimumLevel: 0,
      maximumLevel: PNOA_MAX_LEVEL,
      rectangle: PNOA_COVERAGE,
      probeUrl: wmtsTileUrl(IGN_WMTS, PROBE_TILE),
    },
  };
  return parseSources(env.sources).map((id) => all[id]);
}

export type PnoaProblem = 'access' | 'service' | 'offline' | 'not-image' | 'unknown';

/** HTTP status of a failed tile: Cesium's RequestErrorEvent (statusCode) or a Response. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || !error) return undefined;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  if (typeof statusCode === 'number') return statusCode;
  if (typeof status === 'number') return status;
  return undefined;
}

/**
 * 401/403/404 mean the service refuses this page (or the tile does not exist), 5xx and 429 that
 * the service is down or busy. No answer at all (a fetch TypeError, a RequestErrorEvent without
 * status) is either no connection or a response the browser blocked for lacking CORS headers:
 * from inside the page the two cannot be told apart.
 */
export function classifyPnoaError(error: unknown): PnoaProblem {
  const status = statusOf(error);
  if (status === 401 || status === 403 || status === 404) return 'access';
  if (status === 429 || (status !== undefined && status >= 500)) return 'service';
  if (error instanceof TypeError) return 'offline';
  if (status === undefined && typeof error === 'object' && error !== null && 'statusCode' in error)
    return 'offline';
  if (error instanceof DOMException && error.name === 'AbortError') return 'offline';
  return 'unknown';
}

export interface ProbeResult {
  ok: boolean;
  problem?: PnoaProblem;
}
type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'headers'>>;

/**
 * Asks for the probe tile as the imagery provider will (a CORS request). Passes only with a 2xx
 * image: an HTML 200 is a SPA fallback (no /ortho folder) or a captive portal, not a tile.
 */
export async function probeSource(
  source: Pick<PnoaSource, 'probeUrl'>,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source.probeUrl, {
      mode: 'cors',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, problem: classifyPnoaError(response) };
    const type = response.headers.get('content-type') ?? '';
    return type.toLowerCase().startsWith('image/')
      ? { ok: true }
      : { ok: false, problem: 'not-image' };
  } catch (error) {
    return { ok: false, problem: classifyPnoaError(error) };
  } finally {
    clearTimeout(timer);
  }
}

export type PickResult =
  | { source: PnoaSource; index: number; failures: { id: PnoaSourceId; problem: PnoaProblem }[] }
  | { source: undefined; index: -1; failures: { id: PnoaSourceId; problem: PnoaProblem }[] };

/** The first source, from `start`, whose probe passes; otherwise none, with every failure. */
export async function pickSource(
  sources: PnoaSource[],
  probe: (source: PnoaSource) => Promise<ProbeResult>,
  start = 0,
): Promise<PickResult> {
  const failures: { id: PnoaSourceId; problem: PnoaProblem }[] = [];
  for (let index = start; index < sources.length; index++) {
    const source = sources[index]!;
    const result = await probe(source);
    if (result.ok) return { source, index, failures };
    failures.push({ id: source.id, problem: result.problem ?? 'unknown' });
  }
  return { source: undefined, index: -1, failures };
}

/**
 * Watches the tiles of the source in use: a refusal (401/403) or a run of failures in a row
 * means it has stopped working and the next source should take over. A loaded tile resets the
 * run, so a few missing tiles at the edge of the coverage never trigger it.
 */
export class ImageryFailureWatch {
  private run = 0;
  constructor(private readonly limit = 8) {}
  loaded() {
    this.run = 0;
  }
  /** True when the source should be abandoned. */
  failed(error: unknown): boolean {
    const status = statusOf(error);
    if (status === 401 || status === 403) return true;
    // 404 is a tile outside the coverage: not a sign that the service is down.
    if (status === 404) return false;
    this.run++;
    return this.run >= this.limit;
  }
}

/**
 * The base actually drawn: the chosen one, except that a failed orthophoto (every source refused
 * or unreachable) falls back to the neutral dark ground.
 */
export function effectiveBase(base: BaseImagery, state: PnoaState): BaseImagery {
  return base === 'pnoa' && state === 'error' ? 'neutral' : base;
}

/** Name of the base map, for the credits plate («map-base»). */
export function baseImageryLabel(
  base: BaseImagery,
  state: PnoaState,
  source: PnoaSourceId | undefined,
) {
  if (base === 'natural-earth') return 'Atlas Natural Earth';
  if (base === 'neutral') return 'Fondo neutro';
  if (state === 'error') return 'Fondo neutro (PNOA no disponible)';
  if (state !== 'on') return 'Ortofoto PNOA (cargando)';
  return source === 'local' ? 'Ortofoto PNOA (descargada)' : 'Ortofoto PNOA';
}

/** What the ground of the scene is made of, after the base map in the credits plate. */
export function sceneLabel(
  base: BaseImagery,
  state: PnoaState,
  source: PnoaSourceId | undefined,
  terrain: 'lidar' | 'world' | 'ellipsoid',
  photoreal: boolean,
) {
  if (photoreal) return 'Fotorrealista (Google)';
  const relief =
    terrain === 'lidar'
      ? 'relieve LiDAR'
      : terrain === 'world'
        ? 'relieve 3D (Cesium ion)'
        : 'globo básico';
  return `${baseImageryLabel(base, state, source)} · ${relief}`;
}
