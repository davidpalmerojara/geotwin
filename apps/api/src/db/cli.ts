import { createPool } from './pool.js';
import { migrate, seed } from './migrate.js';
import { env } from '../config/env.js';
const command = process.argv[2];
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://geotwin:geotwin_local@localhost:55432/geotwin_test';
if (command === 'test') {
  const target = new URL(url);
  if (target.pathname !== '/geotwin_test')
    throw new Error('Tests require a dedicated geotwin_test database');
  const admin = createPool(env.DATABASE_URL);
  try {
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname='geotwin_test'");
    if (!result.rowCount) await admin.query('CREATE DATABASE geotwin_test');
  } finally {
    await admin.end();
  }
}
const db = createPool(command === 'test' ? url : env.DATABASE_URL);
try {
  if (command === 'migrate' || command === 'test') await migrate(db);
  else if (command === 'seed') await seed(db);
  else throw new Error('Usage: cli.ts migrate|seed|test');
  console.log(`Database ${command} complete`);
} finally {
  await db.end();
}
