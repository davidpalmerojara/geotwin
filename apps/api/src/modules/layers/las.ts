import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/** Bytes needed to validate a LAS header: the fixed part common to LAS 1.0-1.4. */
export const LAS_HEADER_MIN = 227;
export interface LasSignature {
  format: 'las' | 'laz';
  version: string;
  pointFormat: number;
  headerSize: number;
}
export class LasFormatError extends Error {}

/**
 * Identifies LAS/LAZ by content, never by file name: the "LASF" signature, a 1.0-1.4 version,
 * a sane header size and an ASPRS point format 0-10. LAZ is the same header with bit 7 (LASzip
 * convention; bit 6 in some writers) set in the point format byte.
 */
export function parseLasHeader(bytes: Buffer): LasSignature {
  if (bytes.length < 4 || bytes.toString('latin1', 0, 4) !== 'LASF')
    throw new LasFormatError('El fichero no es LAS ni LAZ: falta la firma "LASF".');
  if (bytes.length < LAS_HEADER_MIN)
    throw new LasFormatError('El fichero es demasiado pequeño para ser un LAS/LAZ válido.');
  const major = bytes.readUInt8(24);
  const minor = bytes.readUInt8(25);
  if (major !== 1 || minor > 4)
    throw new LasFormatError(`Versión LAS no admitida: ${major}.${minor} (se admite 1.0-1.4).`);
  const headerSize = bytes.readUInt16LE(94);
  if (headerSize < LAS_HEADER_MIN)
    throw new LasFormatError('Cabecera LAS no válida: tamaño de cabecera incorrecto.');
  const formatByte = bytes.readUInt8(104);
  const compressed = (formatByte & 0xc0) !== 0;
  const pointFormat = formatByte & 0x3f;
  if (pointFormat > 10) throw new LasFormatError(`Formato de punto LAS no válido: ${pointFormat}.`);
  return {
    format: compressed ? 'laz' : 'las',
    version: `${major}.${minor}`,
    pointFormat,
    headerSize,
  };
}

/**
 * Pass-through stream for uploads: holds back the first bytes until the LAS header is
 * validated (so nothing reaches storage for a non-LAS file), then streams the rest while
 * hashing (SHA-256) and counting. Memory use is one header plus one chunk, whatever the size.
 */
export class LasUploadInspector extends Transform {
  readonly hash = createHash('sha256');
  size = 0;
  signature: LasSignature | undefined;
  private head: Buffer[] = [];
  private headLength = 0;
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.size += chunk.length;
    this.hash.update(chunk);
    if (this.signature) {
      done(null, chunk);
      return;
    }
    this.head.push(chunk);
    this.headLength += chunk.length;
    if (this.headLength < LAS_HEADER_MIN) {
      done();
      return;
    }
    this.release(done);
  }
  override _flush(done: TransformCallback) {
    if (this.signature) done();
    else this.release(done);
  }
  private release(done: TransformCallback) {
    const head = Buffer.concat(this.head);
    this.head = [];
    try {
      this.signature = parseLasHeader(head);
    } catch (error) {
      done(error as Error);
      return;
    }
    done(null, head);
  }
  digest() {
    return this.hash.digest('hex');
  }
}
