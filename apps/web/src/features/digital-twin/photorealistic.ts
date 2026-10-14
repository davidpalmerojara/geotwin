/**
 * Optional Google Photorealistic 3D Tiles, streamed through Cesium ion (asset 2275207). Only the
 * loading and error logic lives here, without importing Cesium: the viewer passes the real
 * loader and the tests pass mocks.
 */
export const GOOGLE_PHOTOREALISTIC_ASSET = 2275207;

export type PhotorealProblem = 'access' | 'quota' | 'offline' | 'timeout' | 'unknown';

/** Seconds the layer may stay on without a single tile loaded before it gives up. */
export const PHOTOREAL_START_TIMEOUT_MS = 30_000;

const MESSAGES: Record<PhotorealProblem, string> = {
  access:
    'El token de Cesium ion no da acceso a Google Photorealistic 3D Tiles (asset 2275207) o no autoriza esta URL. Sigue la vista LiDAR.',
  quota:
    'La cuenta de Cesium ion ha agotado su cuota de Google Photorealistic 3D Tiles. Sigue la vista LiDAR.',
  offline:
    'Sin conexión con Cesium ion o con Google: no se pueden cargar las teselas fotorrealistas. Sigue la vista LiDAR.',
  timeout:
    'La capa fotorrealista de Google no ha cargado ninguna tesela en 30 s (conexión lenta o servicio sin respuesta). Sigue la vista LiDAR.',
  unknown: 'No se pudo cargar la capa fotorrealista de Google. Sigue la vista LiDAR.',
};

export class PhotorealError extends Error {
  constructor(public readonly problem: PhotorealProblem) {
    super(MESSAGES[problem]);
  }
}

const messageOf = (error: unknown) =>
  typeof error === 'string'
    ? error
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

/**
 * The body of a failed request, when Cesium kept it: RequestErrorEvent.response holds what the
 * server answered (ion explains a refusal in JSON, e.g. {"code":"...","message":"..."}).
 */
function bodyOf(error: unknown): string {
  if (typeof error !== 'object' || !error || !('response' in error)) return '';
  const { response } = error as { response: unknown };
  if (typeof response === 'string') return response;
  if (response instanceof ArrayBuffer) return new TextDecoder().decode(response);
  if (typeof response === 'object' && response) {
    try {
      return JSON.stringify(response);
    } catch {
      return '';
    }
  }
  return '';
}

/** HTTP status of a failed request: Cesium's RequestErrorEvent, a response or its message. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error) {
    const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
    if (typeof statusCode === 'number') return statusCode;
    if (typeof status === 'number') return status;
  }
  // RequestErrorEvent#toString and tile failure messages: "... Status Code: 403".
  const match = /status(?:\s*code)?\s*:?\s*(\d{3})/i.exec(messageOf(error));
  return match ? Number(match[1]) : undefined;
}

/**
 * What went wrong, from the error and whether the browser is online. An HTTP status wins:
 * 401, 403 or 404 mean the token has no access to the asset or does not allow this URL, and 429
 * that the monthly quota is used up. So does a message or an answer body (RequestErrorEvent
 * .response) that mentions a quota, whatever its status: the exact answer of Cesium ion to a
 * used-up quota could not be checked, so both are read. Without a status, the browser
 * being offline, or a request that never got an answer (Cesium's RequestErrorEvent with no
 * status code, a fetch TypeError), means there is no connection.
 */
export function classifyPhotorealError(error: unknown, online = true): PhotorealProblem {
  const status = statusOf(error);
  const quota = /quota|cuota|limit exceeded/i;
  if (status === 429 || quota.test(messageOf(error)) || quota.test(bodyOf(error))) return 'quota';
  if (status === 401 || status === 403 || status === 404) return 'access';
  if (!online) return 'offline';
  const noResponse =
    status === undefined &&
    ((typeof error === 'object' && error !== null && 'statusCode' in error) ||
      error instanceof TypeError ||
      /failed to fetch|network/i.test(messageOf(error)));
  return noResponse ? 'offline' : 'unknown';
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Runs the loader and turns any failure into a PhotorealError with a readable message. */
export async function loadPhotorealistic<T>(
  create: () => Promise<T>,
  online: () => boolean = isOnline,
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    throw new PhotorealError(classifyPhotorealError(error, online()));
  }
}

/** A tile of the tileset as far as the failure watch needs it (Cesium3DTile has more). */
export interface TileState {
  /** Cesium3DTile#contentFailed: set before the tileset raises tileFailed. */
  contentFailed?: boolean;
  children?: TileState[];
}

/**
 * Whether the content at the top of the tileset failed: the root's own or, when the root only
 * groups its children (Google's root has no content, its child holds the whole world), that of a
 * child of the root. Nothing below it can load then, so the layer would stay empty.
 */
export function topContentFailed(root: TileState | undefined) {
  if (!root) return false;
  return !!root.contentFailed || (root.children ?? []).some((child) => !!child.contentFailed);
}

/**
 * Watches tile failures once the tileset is shown. These are fatal at once: a refused request
 * (no access, quota), a failure of the content at the top of the tileset, a run of `startLimit`
 * failures before any tile has ever loaded, and `timedOut` with nothing loaded. Once tiles have
 * loaded, other failures only stop the layer after `limit` of them in a row, so one lost tile
 * does not switch the view back; any tile that loads resets the count.
 */
export class TileFailureWatch {
  private failures = 0;
  private anyLoaded = false;
  constructor(
    private readonly limit = 8,
    private readonly online: () => boolean = isOnline,
    private readonly startLimit = 3,
  ) {}
  loaded() {
    this.failures = 0;
    this.anyLoaded = true;
  }
  /** Whether a tile has ever loaded. */
  get started() {
    return this.anyLoaded;
  }
  failed(error: unknown, top = false): PhotorealProblem | undefined {
    const problem = classifyPhotorealError(error, this.online());
    if (problem === 'access' || problem === 'quota' || top) return problem;
    this.failures += 1;
    return this.failures >= (this.anyLoaded ? this.limit : this.startLimit) ? problem : undefined;
  }
  /** The start timeout ran out: fatal unless a tile has loaded. */
  timedOut(): PhotorealProblem | undefined {
    if (this.anyLoaded) return undefined;
    return this.online() ? 'timeout' : 'offline';
  }
}
