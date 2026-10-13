import { number } from '../../lib/format';

/** Size in MB of 1024² bytes, the unit the API uses in its size-limit message. */
export function megabytes(bytes: number, digits = 1) {
  return `${number(bytes / 1024 ** 2, digits)} MB`;
}

/**
 * Quick checks before sending anything, with a readable message. The API still decides by the
 * content (LASF signature) and enforces the size; this only saves a useless transfer.
 */
export function validateFile(file: Pick<File, 'name' | 'size'>, maxBytes?: number) {
  if (!/\.la[sz]$/i.test(file.name)) return `«${file.name}» no es un fichero .las o .laz.`;
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (maxBytes && file.size > maxBytes)
    return `«${file.name}» ocupa ${megabytes(file.size)} y el límite es ${megabytes(maxBytes, 0)}.`;
  return '';
}
