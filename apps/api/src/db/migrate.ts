import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Database } from './pool.js';
import { transaction } from './pool.js';
export async function migrate(db: Database) {
  const folder = fileURLToPath(new URL('../../../../database/migrations/', import.meta.url));
  await transaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(741205)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = await readFile(`${folder}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration ${name} changed after applying it`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
    }
  });
}
/** Demo scenarios in database/seeds (one SQL file each). Laguna de Duero is the default. */
export const DEFAULT_SEED = 'laguna-de-duero';
export async function seedNames() {
  const folder = fileURLToPath(new URL('../../../../database/seeds/', import.meta.url));
  return (await readdir(folder))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .sort();
}
/**
 * Runs one demo scenario (idempotent: it only inserts what is missing). A database keeps the
 * scenario it was first seeded with, because both share the same ids.
 */
export async function seed(db: Database, name = process.env.DEMO_SEED || DEFAULT_SEED) {
  const names = await seedNames();
  if (!names.includes(name))
    throw new Error(`Unknown seed "${name}". Available: ${names.join(', ')}`);
  const file = fileURLToPath(new URL(`../../../../database/seeds/${name}.sql`, import.meta.url));
  await transaction(db, async (client) => {
    await client.query(await readFile(file, 'utf8'));
  });
}
