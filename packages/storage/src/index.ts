import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, rename } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { z } from 'zod';

/**
 * Object storage behind one small interface: a local folder for development and tests, or any
 * S3-compatible service (AWS S3, MinIO) in Docker and production. Keys look like
 * `layers/<uuid>/tiles/tileset.json` and are validated before they reach either driver.
 */
export interface StoredObject {
  body: Readable;
  size: number;
  etag: string;
  lastModified?: Date;
}
export interface Storage {
  readonly driver: 'local' | 's3';
  /** Creates the bucket or folder when missing. Safe to call many times. */
  ensureReady(): Promise<void>;
  /** Streams `body` to `key` without holding the whole object in memory. */
  put(key: string, body: Readable, contentType?: string): Promise<{ size: number }>;
  putFile(key: string, path: string, contentType?: string): Promise<{ size: number }>;
  /** `null` when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<{ size: number; etag: string } | null>;
  /** Copies an object to a local file (the worker's temp folder). */
  download(key: string, path: string): Promise<{ size: number }>;
  delete(key: string): Promise<void>;
  /** Deletes every object under `prefix` (which must end with `/`); returns how many. */
  deletePrefix(prefix: string): Promise<number>;
  list(prefix: string): Promise<string[]>;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Throws unless `key` is a relative path of safe segments (no `..`, no empty parts, no `\`). */
export function assertSafeKey(key: string): string {
  if (key.length === 0 || key.length > 512) throw new StorageKeyError(key);
  for (const part of key.split('/')) if (!SEGMENT.test(part)) throw new StorageKeyError(key);
  return key;
}
export function isSafeKey(key: string) {
  try {
    assertSafeKey(key);
    return true;
  } catch {
    return false;
  }
}
function assertPrefix(prefix: string) {
  if (!prefix.endsWith('/')) throw new StorageKeyError(prefix);
  assertSafeKey(prefix.slice(0, -1));
  return prefix;
}
export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Unsafe storage key: ${JSON.stringify(key.slice(0, 80))}`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  pnts: 'application/octet-stream',
  b3dm: 'application/octet-stream',
  i3dm: 'application/octet-stream',
  cmpt: 'application/octet-stream',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  subtree: 'application/octet-stream',
  las: 'application/octet-stream',
  laz: 'application/octet-stream',
};
/** Content type for a 3D Tiles (or source) file, by extension. */
export function contentTypeFor(key: string) {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const target = resolve(this.root, assertSafeKey(key));
    // Belt and braces: the key check already rules out traversal.
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(this.root, rel) !== target)
      throw new StorageKeyError(key);
    return target;
  }
  async ensureReady() {
    await mkdir(this.root, { recursive: true });
  }
  async put(key: string, body: Readable) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write to a temp name and rename, so readers never see a half-written object.
    const temp = `${target}.${randomUUID()}.part`;
    try {
      await pipeline(body, createWriteStream(temp, { flags: 'wx' }));
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { size: (await stat(target)).size };
  }
  async putFile(key: string, path: string) {
    return this.put(key, createReadStream(path));
  }
  async head(key: string) {
    try {
      const info = await stat(this.path(key));
      if (!info.isFile()) return null;
      return {
        size: info.size,
        etag: `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async get(key: string) {
    const info = await this.head(key);
    if (!info) return null;
    const path = this.path(key);
    return {
      body: createReadStream(path),
      size: info.size,
      etag: info.etag,
      lastModified: (await stat(path)).mtime,
    };
  }
  async download(key: string, path: string) {
    const object = await this.get(key);
    if (!object) throw new Error(`Object not found: ${key}`);
    await pipeline(object.body, createWriteStream(path));
    return { size: object.size };
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    const keys = await this.list(prefix);
    await rm(this.path(assertPrefix(prefix).slice(0, -1)), { recursive: true, force: true });
    return keys.length;
  }
  async list(prefix: string) {
    const folder = this.path(assertPrefix(prefix).slice(0, -1));
    try {
      const entries = await readdir(folder, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith('.part'))
        .map((e) => relative(this.root, join(e.parentPath, e.name)).split(sep).join('/'))
        .sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}
function isMissing(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  createBucket: boolean;
}
export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  readonly client: S3Client;
  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      // Without explicit keys the SDK uses its default chain (env, profile, IAM role).
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
          : undefined,
    });
  }
  async ensureReady() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch (error) {
      if (!this.options.createBucket || !isS3Missing(error)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    }
  }
  async put(key: string, body: Readable, contentType = contentTypeFor(key)) {
    let size = 0;
    const counted = body.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          done(null, chunk);
        },
      }),
    );
    body.once('error', (error) => counted.destroy(error));
    // Multipart upload in 8 MB parts, at most 4 in flight: memory stays bounded for any size.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.options.bucket,
        Key: assertSafeKey(key),
        Body: counted,
        ContentType: contentType,
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    });
    await upload.done();
    return { size };
  }
  async putFile(key: string, path: string, contentType = contentTypeFor(key)) {
    return this.put(key, createReadStream(path), contentType);
  }
  async head(key: string) {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: assertSafeKey(key) }),
      );
      return { size: out.ContentLength ?? 0, etag: out.ETag ?? '""' };
    } catch (error) {
      if (isS3Missing(error)) return null;
      throw error;
    }
  }
  async get(key: string) {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: assertSafeKey(key) }),
      );
      if (!out.Body) return null;
      return {
        body: out.Body as Readable,
        size: out.ContentLength ?? 0,
        etag: out.ETag ?? '""',
        lastModified: out.LastModified,
      };
    } catch (error) {
      if (isS3Missing(error)) return null;
      throw error;
    }
  }
  async download(key: string, path: string) {
    const object = await this.get(key);
    if (!object) throw new Error(`Object not found: ${key}`);
    await pipeline(object.body, createWriteStream(path));
    return { size: object.size };
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.options.bucket,
        Delete: { Objects: [{ Key: assertSafeKey(key) }], Quiet: true },
      }),
    );
  }
  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: assertPrefix(prefix),
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }
  async deletePrefix(prefix: string) {
    const keys = await this.list(prefix);
    // DeleteObjects accepts at most 1000 keys per request.
    for (let i = 0; i < keys.length; i += 1000)
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    return keys.length;
  }
}
function isS3Missing(error: unknown) {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String(error.name) : '';
  const status =
    '$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  return name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchBucket' || status === 404;
}

const boolean = z.enum(['true', 'false']).transform((v) => v === 'true');
export const storageEnvSchema = z.object({
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('data/storage'),
  S3_BUCKET: z.string().default('geotwin'),
  S3_REGION: z.string().default('eu-south-2'),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: boolean.default(false),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_CREATE_BUCKET: boolean.default(false),
});
export type StorageEnv = z.infer<typeof storageEnvSchema>;
/** Picks the driver from environment variables (see .env.example). */
export function createStorage(env: StorageEnv, baseDir = process.cwd()): Storage {
  if (env.STORAGE_DRIVER === 'local')
    return new LocalStorage(resolve(baseDir, env.STORAGE_LOCAL_DIR));
  return new S3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    createBucket: env.S3_CREATE_BUCKET,
  });
}
