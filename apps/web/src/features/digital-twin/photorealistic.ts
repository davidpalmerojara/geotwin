/**
 * Optional Google Photorealistic 3D Tiles, streamed through Cesium ion (asset 2275207). Only the
 * loading and error logic lives here, without importing Cesium: the viewer passes the real
 * loader and the tests pass mocks.
 */
export const GOOGLE_PHOTOREALISTIC_ASSET = 2275207;

export type PhotorealProblem = 'access' | 'quota' | 'offline' | 'unknown';

const MESSAGES: Record<PhotorealProblem, string> = {
  access:
    'El token de Cesium ion no da acceso a Google Photorealistic 3D Tiles (asset 2275207) o no autoriza esta URL. Sigue la vista LiDAR.',
  quota:
    'La cuenta de Cesium ion ha agotado su cuota de Google Photorealistic 3D Tiles. Sigue la vista LiDAR.',
  offline:
    'Sin conexión con Cesium ion o con Google: no se pueden cargar las teselas fotorrealistas. Sigue la vista LiDAR.',
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
 * (or a message about a quota) that the monthly quota is used up. Without a status, the browser
 * being offline, or a request that never got an answer (Cesium's RequestErrorEvent with no
 * status code, a fetch TypeError), means there is no connection.
 */
export function classifyPhotorealError(error: unknown, online = true): PhotorealProblem {
  const status = statusOf(error);
  if (status === 429 || /quota|cuota|limit exceeded/i.test(messageOf(error))) return 'quota';
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

/**
 * Watches tile failures once the tileset is shown. A refused request (no access, quota) stops
 * the layer at once; other failures only after `limit` of them in a row, so one lost tile does
 * not switch the view back. Any tile that loads resets the count.
 */
export class TileFailureWatch {
  private failures = 0;
  constructor(
    private readonly limit = 8,
    private readonly online: () => boolean = isOnline,
  ) {}
  loaded() {
    this.failures = 0;
  }
  failed(error: unknown): PhotorealProblem | undefined {
    const problem = classifyPhotorealError(error, this.online());
    if (problem === 'access' || problem === 'quota') return problem;
    this.failures += 1;
    return this.failures >= this.limit ? problem : undefined;
  }
}
