import pg from 'pg';
import { env } from '../config/env.js';
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());
export function createPool(url = env.DATABASE_URL) {
  return new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
export type Database = pg.Pool;
export type Transaction = pg.PoolClient;
export async function transaction<T>(
  db: Database,
  work: (client: Transaction) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
