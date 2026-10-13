import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeStaleAttempts } from '../src/temp.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geotwin-temp-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function folder(name: string, ageMs: number) {
  const path = join(dir, name);
  await mkdir(join(path, 'tiles'), { recursive: true });
  await writeFile(join(path, 'source.laz'), 'LASF');
  const when = new Date(Date.now() - ageMs);
  await utimes(path, when, when);
  return path;
}

describe('Stale attempt folders', () => {
  it('removes only old attempt folders and keeps live ones and anything else', async () => {
    const hour = 3600_000;
    const crashed = await folder('geotwin-layer-aaaa-x1', 2 * hour);
    const live = await folder('geotwin-layer-bbbb-x2', 60_000);
    const other = await folder('someone-else', 5 * hour);
    await writeFile(join(dir, 'geotwin-layer-file'), 'not a folder');
    const removed = await removeStaleAttempts(dir, hour);
    expect(removed).toEqual(['geotwin-layer-aaaa-x1']);
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(dir, 'geotwin-layer-file'))).toBe(true);
  });

  it('does nothing when the folder does not exist', async () => {
    expect(await removeStaleAttempts(join(dir, 'missing'), 0)).toEqual([]);
  });
});
