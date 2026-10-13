import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  LocalStorage,
  S3Storage,
  assertSafeKey,
  contentTypeFor,
  createStorage,
  storageEnvSchema,
} from '../src/index.js';
import { storageContract } from './contract.js';

describe('Storage', () => {
  it('local driver honours the storage contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geotwin-local-'));
    try {
      await storageContract(new LocalStorage(join(root, 'objects')), 'layers/abc/');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('local driver never leaves a half-written object behind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geotwin-local-'));
    try {
      const storage = new LocalStorage(root);
      const failing = new Readable({
        read() {
          this.push(Buffer.from('LASF partial'));
          this.destroy(new Error('client went away'));
        },
      });
      await expect(storage.put('layers/x/source', failing)).rejects.toThrow('client went away');
      expect(await storage.head('layers/x/source')).toBeNull();
      expect(await readdir(join(root, 'layers/x'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('accepts only relative keys made of safe segments', () => {
    expect(assertSafeKey('layers/0b6c/tiles/run/points/r04.pnts')).toBeTruthy();
    for (const bad of ['..', 'a/../b', '.hidden', 'a/', '/a', 'a b', 'ñ', 'x'.repeat(513)])
      expect(() => assertSafeKey(bad)).toThrow();
  });
  it('serves 3D Tiles files with their content types', () => {
    expect(contentTypeFor('tileset.json')).toBe('application/json');
    expect(contentTypeFor('points/r0.pnts')).toBe('application/octet-stream');
    expect(contentTypeFor('a.glb')).toBe('model/gltf-binary');
    expect(contentTypeFor('noextension')).toBe('application/octet-stream');
  });
  it('picks the driver from the environment', () => {
    expect(createStorage(storageEnvSchema.parse({}), '/tmp').driver).toBe('local');
    const s3 = createStorage(
      storageEnvSchema.parse({
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_FORCE_PATH_STYLE: 'true',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    );
    expect(s3).toBeInstanceOf(S3Storage);
    expect(() => storageEnvSchema.parse({ STORAGE_DRIVER: 'ftp' })).toThrow();
  });
});
describe('waitForStorage', () => {
  it('retries until the storage service answers, then gives up', async () => {
    const { waitForStorage } = await import('../src/index.js');
    let calls = 0;
    const flaky = {
      ensureReady: async () => {
        if (++calls < 3) throw new Error('connect ECONNREFUSED');
      },
    } as unknown as Parameters<typeof waitForStorage>[0];
    await waitForStorage(flaky, 5, 1);
    expect(calls).toBe(3);
    calls = -100;
    await expect(waitForStorage(flaky, 2, 1)).rejects.toThrow('ECONNREFUSED');
  });
});
