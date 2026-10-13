import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Prefix of each attempt's temp folder (source file and tiles before they are uploaded). */
export const ATTEMPT_PREFIX = 'geotwin-layer-';

/**
 * Removes attempt folders that a killed worker (SIGKILL, out of memory, container restart) could
 * not clean up. Only folders older than `maxAgeMs` go: no live attempt is that old, because the
 * job timeout stops it first, so another worker sharing the folder is never disturbed.
 * Returns the names removed.
 */
export async function removeStaleAttempts(dir: string, maxAgeMs: number, now = Date.now()) {
  const removed: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(ATTEMPT_PREFIX)) continue;
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => undefined);
    if (!info || now - info.mtimeMs < maxAgeMs) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
