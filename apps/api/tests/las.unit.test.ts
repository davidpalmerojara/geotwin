import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { LasFormatError, LasUploadInspector, parseLasHeader } from '../src/modules/layers/las.js';
import { cleanFilename } from '../src/modules/layers/routes.js';
const fixtures = new URL('../../worker/tests/fixtures/', import.meta.url);
const las = readFileSync(new URL('synthetic-laguna-duero.las', fixtures));
const laz = readFileSync(new URL('synthetic-laguna-duero.laz', fixtures));
async function run(bytes: Buffer, chunk = 7) {
  const inspector = new LasUploadInspector();
  const parts: Buffer[] = [];
  const chunks = Array.from({ length: Math.ceil(bytes.length / chunk) }, (_, i) =>
    bytes.subarray(i * chunk, (i + 1) * chunk),
  );
  await pipeline(
    Readable.from(chunks),
    inspector,
    new Writable({
      write(part: Buffer, _encoding, done) {
        parts.push(part);
        done();
      },
    }),
  );
  return { inspector, output: Buffer.concat(parts) };
}
describe('LAS/LAZ detection by content', () => {
  it('recognises LAS and LAZ from the header bytes, whatever the file is called', () => {
    expect(parseLasHeader(las)).toEqual({
      format: 'las',
      version: '1.4',
      pointFormat: 7,
      headerSize: 375,
    });
    expect(parseLasHeader(laz)).toMatchObject({ format: 'laz', version: '1.4', pointFormat: 7 });
  });
  it('rejects other files with a readable reason', () => {
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(400)]);
    expect(() => parseLasHeader(png)).toThrow(/LASF/);
    expect(() => parseLasHeader(Buffer.from('x,y,z\n1,2,3\n'))).toThrow(LasFormatError);
    expect(() => parseLasHeader(las.subarray(0, 100))).toThrow(/pequeño/);
    const v2 = Buffer.from(las.subarray(0, 400));
    v2.writeUInt8(2, 24);
    expect(() => parseLasHeader(v2)).toThrow(/Versión LAS no admitida: 2\.4/);
    const badFormat = Buffer.from(las.subarray(0, 400));
    badFormat.writeUInt8(0x3f, 104);
    expect(() => parseLasHeader(badFormat)).toThrow(/Formato de punto/);
  });
  it('streams the upload unchanged while hashing and counting it', async () => {
    const { inspector, output } = await run(laz);
    expect(output.equals(laz)).toBe(true);
    expect(inspector.size).toBe(laz.length);
    expect(inspector.digest()).toBe(createHash('sha256').update(laz).digest('hex'));
    expect(inspector.signature?.format).toBe('laz');
  });
  it('emits nothing at all for a file that is not LAS', async () => {
    const fake = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(1000)]);
    const parts: Buffer[] = [];
    const inspector = new LasUploadInspector();
    await expect(
      pipeline(
        Readable.from([fake]),
        inspector,
        new Writable({
          write(part: Buffer, _e, done) {
            parts.push(part);
            done();
          },
        }),
      ),
    ).rejects.toThrow(LasFormatError);
    expect(parts).toHaveLength(0);
    await expect(run(Buffer.alloc(0))).rejects.toThrow(LasFormatError);
  });
  it('keeps only a harmless base name of the uploaded file', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\datos\\PNOA_2023.laz')).toBe('PNOA_2023.laz');
    expect(cleanFilename('a\u0000b\u202e.laz')).toBe('ab.laz');
    expect(cleanFilename(undefined)).toBe('nube.laz');
  });
});
