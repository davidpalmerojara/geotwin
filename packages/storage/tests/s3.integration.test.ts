import { describe, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { S3Storage } from '../src/index.js';
import { storageContract } from './contract.js';

// Runs against a real S3-compatible server (MinIO in CI) when S3_TEST_ENDPOINT is set.
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)('S3 driver against a real S3-compatible server', () => {
  it('honours the storage contract (multipart upload, list, delete, missing keys)', async () => {
    const storage = new S3Storage({
      endpoint,
      bucket: process.env.S3_TEST_BUCKET ?? 'geotwin-test',
      region: process.env.S3_TEST_REGION ?? 'us-east-1',
      forcePathStyle: true,
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY,
      createBucket: true,
    });
    await storageContract(storage, `layers/${randomUUID()}/`);
  }, 60000);
});
