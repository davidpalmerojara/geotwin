import { expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import type { Storage } from '../src/index.js';

/** Behaviour every driver must share; run against LocalStorage and against S3/MinIO. */
export async function storageContract(storage: Storage, prefix: string) {
  await storage.ensureReady();
  await storage.ensureReady(); // idempotent
  const key = `${prefix}tiles/run/tileset.json`;
  const body = JSON.stringify({ asset: { version: '1.0' } });
  expect(await storage.put(key, Readable.from([Buffer.from(body)]))).toEqual({
    size: body.length,
  });
  const head = await storage.head(key);
  expect(head?.size).toBe(body.length);
  expect(head?.etag).toMatch(/^"[^"]+"$/);
  const object = await storage.get(key);
  expect(object?.etag).toBe(head?.etag);
  expect(await text(object!.body)).toBe(body);
  // A multi-chunk stream larger than one read buffer arrives intact.
  const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
  const chunks = Array.from({ length: 50 }, (_, i) =>
    big.subarray((i * big.length) / 50, ((i + 1) * big.length) / 50),
  );
  await storage.put(`${prefix}tiles/run/points/r0.pnts`, Readable.from(chunks));
  const dir = await mkdtemp(join(tmpdir(), 'geotwin-storage-'));
  try {
    await storage.download(`${prefix}tiles/run/points/r0.pnts`, join(dir, 'r0.pnts'));
    expect((await readFile(join(dir, 'r0.pnts'))).equals(big)).toBe(true);
    await writeFile(join(dir, 'source.laz'), 'LASF');
    await storage.putFile(`${prefix}source`, join(dir, 'source.laz'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  expect(await storage.list(prefix)).toEqual([
    `${prefix}source`,
    `${prefix}tiles/run/points/r0.pnts`,
    `${prefix}tiles/run/tileset.json`,
  ]);
  expect(await storage.get(`${prefix}missing.json`)).toBeNull();
  expect(await storage.head(`${prefix}missing.json`)).toBeNull();
  await storage.delete(`${prefix}source`);
  await storage.delete(`${prefix}source`); // deleting twice is fine
  expect(await storage.deletePrefix(`${prefix}tiles/`)).toBe(2);
  expect(await storage.list(prefix)).toEqual([]);
  // Keys are validated before they reach the driver.
  for (const bad of ['../etc/passwd', `${prefix}../x`, '/abs', 'a//b', 'a/./b', 'a\\b', ''])
    await expect(storage.get(bad)).rejects.toThrow(/Unsafe storage key/);
}
