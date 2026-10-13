import { number } from '../../lib/format';

/** Size in MiB (1024² bytes), the unit of the upload limit everywhere: API, interface and docs. */
export function mebibytes(bytes: number, digits = 1) {
  return `${number(bytes / 1024 ** 2, digits)} MiB`;
}

/**
 * Quick checks before sending anything, with a readable message. The API still decides by the
 * content (LASF signature) and enforces the size; this only saves a useless transfer.
 */
export function validateFile(file: Pick<File, 'name' | 'size'>, maxBytes?: number) {
  if (!/\.la[sz]$/i.test(file.name)) return `«${file.name}» no es un fichero .las o .laz.`;
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (maxBytes && file.size > maxBytes)
    return `«${file.name}» ocupa ${mebibytes(file.size)} y el límite es ${mebibytes(maxBytes, 0)}.`;
  return '';
}

/** The worker reports progress every few seconds and pg-boss checks its heartbeat every 60 s. */
export const QUIET_AFTER_MS = 90_000;
/**
 * Whole minutes since the last progress the interface saw, or null while news keep coming. After
 * a worker crash the job only retries once pg-boss notices it, so the bar can freeze for minutes.
 */
export function quietMinutes(lastChangeMs: number, nowMs: number, after = QUIET_AFTER_MS) {
  const quiet = nowMs - lastChangeMs;
  return quiet < after ? null : Math.max(1, Math.floor(quiet / 60_000));
}
