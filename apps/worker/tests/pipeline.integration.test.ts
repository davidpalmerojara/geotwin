import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import WebSocket from 'ws';
import { PgBoss } from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import { LocalStorage } from '@geotwin/storage';
import {
  dtmMetaSchema,
  LAYER_QUEUE,
  layerSchema,
  realtimeEventSchema,
  sectionSchema,
  type RealtimeEvent,
} from '@geotwin/shared';
import { createPool } from '../../api/src/db/pool.js';
import { migrate, seed } from '../../api/src/db/migrate.js';
import { buildApp } from '../../api/src/app.js';
import { LayerRepository } from '../src/layers.js';
import { startLayerWorker } from '../src/worker.js';

/**
 * End to end against real PostgreSQL/PostGIS, real pg-boss, a real worker and a real
 * py3dtiles conversion of the SYNTHETIC fixtures. The worker shares nothing with the API but the
 * database and the storage folder, as in Docker; its events reach the browser socket through
 * Postgres NOTIFY.
 */
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://geotwin:geotwin_local@localhost:55432/geotwin_test';
if (new URL(url).pathname !== '/geotwin_test')
  throw new Error('Refusing to run tests outside geotwin_test');
const python = process.env.LIDAR_PYTHON ?? 'python3';
const pythonReady =
  spawnSync(python, ['-c', 'import py3dtiles, laspy, lazrs, pyproj'], { stdio: 'ignore' })
    .status === 0;
if (!pythonReady && process.env.REQUIRE_LIDAR_TESTS === 'true')
  throw new Error(`LIDAR_PYTHON (${python}) cannot import py3dtiles, laspy and lazrs`);
const gridDir = process.env.GEOID_GRID_DIR;
const hasGrid =
  Boolean(gridDir) && spawnSync('test', ['-f', `${gridDir}/es_ign_egm08-rednap.tif`]).status === 0;
const fixtures = new URL('./fixtures/', import.meta.url);
const laz = readFileSync(new URL('synthetic-laguna-duero.laz', fixtures));
const las = readFileSync(new URL('synthetic-laguna-duero.las', fixtures));
const lazPath = new URL('synthetic-laguna-duero.laz', fixtures).pathname;
const referenceScript = new URL('./section_reference.py', import.meta.url).pathname;
const SYNTHETIC = 'Nube SINTÉTICA de prueba generada por GeoTwin (no son datos medidos)';
const MAX_UPLOAD = 150_000; // the 56 KB LAZ fits; the 202 KB LAS does not

let db: pg.Pool;
let workerDb: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;
let storage: LocalStorage;
let storageRoot: string;
let base: string;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function upload(bytes: Buffer, filename: string, query = '') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)]), filename);
  return fetch(`${base}/api/layers${query}`, { method: 'POST', body: form });
}
function listen() {
  const events: RealtimeEvent[] = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/api/ws`);
  socket.on('message', (data) => {
    const parsed = realtimeEventSchema.safeParse(JSON.parse(String(data)));
    if (parsed.success) events.push(parsed.data);
  });
  const opened = new Promise((resolve) => socket.once('open', resolve));
  async function waitFor(match: (event: RealtimeEvent) => boolean, timeout = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = events.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Event not received; got ${events.map((e) => e.type).join(', ')}`);
  }
  return { events, opened, waitFor, close: () => socket.close() };
}
async function uploadAndWait(bytes: Buffer, filename: string, query = '') {
  const ws = listen();
  await ws.opened;
  const response = await upload(bytes, filename, query);
  expect(response.status).toBe(201);
  const created = layerSchema.parse(await response.json());
  const done = await ws.waitFor(
    (e) => (e.type === 'layer:ready' || e.type === 'layer:failed') && e.data.id === created.id,
  );
  ws.close();
  return { created, done, events: ws.events };
}

beforeAll(async () => {
  db = createPool(url);
  workerDb = new pg.Pool({ connectionString: url, max: 3 });
  await migrate(db);
  storageRoot = await mkdtemp(join(tmpdir(), 'geotwin-pipeline-'));
  storage = new LocalStorage(storageRoot);
  app = await buildApp(db, {
    demo: false,
    simulator: false,
    logger: false,
    storage,
    maxUploadBytes: MAX_UPLOAD,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  boss = new PgBoss({ connectionString: url, max: 3, instanceName: 'test-worker' });
  boss.on('error', () => undefined);
  await boss.start();
  await startLayerWorker(
    boss,
    {
      repo: new LayerRepository(workerDb),
      storage,
      log: silent,
      env: {
        LIDAR_PYTHON: python,
        LIDAR_SCRIPT: new URL('../python/geotwin_lidar.py', import.meta.url).pathname,
        WORKER_TMP_DIR: storageRoot,
        TILER_JOBS: 2,
        TILER_CACHE_MB: 256,
        GEOID_GRID_DIR: hasGrid ? gridDir : undefined,
        GEOID_OFFSET_M: undefined,
        LAYER_JOB_TIMEOUT_SECONDS: 120,
        LIDAR_EXCLUDE_CLASSES: [7, 12, 18],
        DTM_CELL_M: 2,
      },
    },
    { timeoutSeconds: 120, retryLimit: 1, concurrency: 1 },
  );
});
beforeEach(async () => {
  await storage.deletePrefix('layers/');
  await db.query('TRUNCATE organizations CASCADE');
  await seed(db);
  await boss.deleteAllJobs(LAYER_QUEUE);
});
afterAll(async () => {
  await boss?.stop({ graceful: false, close: true });
  await app?.close();
  await workerDb?.end();
  await db?.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

describe.skipIf(!pythonReady)('LiDAR pipeline: upload → queue → worker → 3D Tiles', () => {
  it('converts an uploaded LAZ and serves its tileset with cache headers', async () => {
    const { created, done, events } = await uploadAndWait(
      laz,
      'synthetic-laguna-duero.laz',
      `?name=Laguna%20sint%C3%A9tica&attribution=${encodeURIComponent(SYNTHETIC)}`,
    );
    expect(created).toMatchObject({
      name: 'Laguna sintética',
      status: 'queued',
      kind: 'pointcloud',
      crs_in: 'EPSG:25830',
      attribution: SYNTHETIC,
      tileset_url: null,
      source: { filename: 'synthetic-laguna-duero.laz', format: 'laz', size_bytes: laz.length },
    });
    expect(created.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(done.type).toBe('layer:ready');
    // Progress reached the socket stage by stage, through Postgres NOTIFY.
    const stages = events
      .filter((e) => e.type === 'layer:progress' && e.data.id === created.id)
      .map((e) => (e.type === 'layer:progress' ? e.data.stage : ''));
    expect(stages).toEqual(expect.arrayContaining(['downloading', 'tiling', 'uploading']));
    const layer = layerSchema.parse(await (await fetch(`${base}/api/layers/${created.id}`)).json());
    expect(layer).toMatchObject({ status: 'ready', stage: 'done', progress: 100, error: null });
    expect(layer.point_count).toBe(5540);
    expect(layer.point_format).toBe(7);
    expect(layer.height_range_m?.min).toBeCloseTo(698.5, 2);
    expect(layer.height_range_m?.max).toBeCloseTo(710.09, 2);
    expect(layer.center?.lat).toBeCloseTo(41.58295, 3);
    expect(layer.center?.lng).toBeCloseTo(-4.7191, 3);
    const [west, south, east, north] = layer.bbox!;
    expect(west).toBeLessThan(layer.center!.lng);
    expect(east).toBeGreaterThan(layer.center!.lng);
    expect(south).toBeLessThan(layer.center!.lat);
    expect(north).toBeGreaterThan(layer.center!.lat);
    if (hasGrid)
      expect(layer.vertical).toMatchObject({ datum: 'orthometric', method: 'egm08_rednap_grid' });
    else expect(layer.vertical).toMatchObject({ datum: 'orthometric', method: 'egm96_centre' });
    expect(layer.vertical.geoid_offset_m).toBeCloseTo(hasGrid ? 53.106 : 53.6, 1);
    expect(layer.tileset_url).toMatch(
      new RegExp(`^/api/layers/${layer.id}/tiles/[0-9a-f-]{36}/tileset\\.json$`),
    );
    const tileset = await fetch(base + layer.tileset_url);
    expect(tileset.status).toBe(200);
    expect(tileset.headers.get('content-type')).toMatch(/^application\/json/);
    expect(tileset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const etag = tileset.headers.get('etag');
    expect(etag).toMatch(/^"[^"]+"$/);
    const json = (await tileset.json()) as { root: { children?: { content?: { uri: string } }[] } };
    const uri = JSON.stringify(json).match(/"uri":"([^"]+\.pnts)"/)?.[1];
    expect(uri).toBeTruthy();
    const pnts = await fetch(new URL(uri!, base + layer.tileset_url));
    expect(pnts.status).toBe(200);
    expect(pnts.headers.get('content-type')).toBe('application/octet-stream');
    const body = Buffer.from(await pnts.arrayBuffer());
    expect(body.subarray(0, 4).toString()).toBe('pnts');
    expect(Number(pnts.headers.get('content-length'))).toBe(body.length);
    const again = await fetch(base + layer.tileset_url, { headers: { 'If-None-Match': etag! } });
    expect(again.status).toBe(304);
    const list = await (await fetch(`${base}/api/layers`)).json();
    expect(list.map((l: { id: string }) => l.id)).toEqual([layer.id]);
    // Nothing of the synthetic tile is noise or overlap; its ground (class 2) became a DTM.
    expect(layer.excluded).toEqual({ points: 0, classes: [] });
    expect(layer.terrain_url).toMatch(
      new RegExp(`^/api/layers/${layer.id}/tiles/[0-9a-f-]{36}/terrain/dtm\\.json$`),
    );
    const meta = dtmMetaSchema.parse(await (await fetch(base + layer.terrain_url)).json());
    const heights = Buffer.from(
      await (await fetch(new URL(meta.data, base + layer.terrain_url))).arrayBuffer(),
    );
    expect(heights.length).toBe(meta.width * meta.height * 2);
    const centre = heights.readUInt16LE(
      2 * (Math.floor(meta.height / 2) * meta.width + Math.floor(meta.width / 2)),
    );
    // Synthetic ground: 700 m ± 1.3 m orthometric, plus the geoid undulation.
    const n = layer.vertical.geoid_offset_m!;
    expect(meta.offset + centre * meta.scale).toBeGreaterThan(698.6 + n);
    expect(meta.offset + centre * meta.scale).toBeLessThan(701.4 + n);
    expect(meta.ground_points).toBe(2953);
  }, 90000);

  it('cuts a section with exactly the source points of the slab (independent laspy reference)', async () => {
    const { created } = await uploadAndWait(laz, 'seccion.laz');
    const layer = layerSchema.parse(await (await fetch(`${base}/api/layers/${created.id}`)).json());
    const n = layer.vertical.geoid_offset_m!;
    // A–B crosses both synthetic buildings and starts and ends outside the 120 m patch, so only
    // the long borders of the slab cut through points. The reference reads the SOURCE LAZ with
    // laspy and pyproj (not the tiles), without the excluded classes.
    const run = spawnSync(
      python,
      [
        '-I',
        referenceScript,
        lazPath,
        '--a=356795,4604865',
        '--b=356630,4604975',
        '--half=1.5',
        '--exclude=7,12,18',
        `--geoid-n=${n}`,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(run.status, run.stderr).toBe(0);
    const ref = JSON.parse(run.stdout) as {
      a: [number, number];
      b: [number, number];
      length: number;
      count: number;
      border: number;
      s: number[];
      d: number[];
      h: number[];
      cls: number[];
    };
    expect(ref.count).toBeGreaterThan(300);
    const response = await fetch(
      `${base}/api/layers/${layer.id}/section?a=${ref.a.join(',')}&b=${ref.b.join(',')}&half=1.5`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const section = sectionSchema.parse(await response.json());
    expect(section.layer_id).toBe(layer.id);
    expect(section.length_m).toBeCloseTo(ref.length, 1);
    expect(section.geoid_offset_m).toBe(n);
    expect(section.count).toBe(section.s.length);
    // Every sure reference point is in the answer, and nothing else but border points.
    expect(section.count).toBeGreaterThanOrEqual(ref.count);
    expect(section.count).toBeLessThanOrEqual(ref.count + ref.border);
    const used = new Set<number>();
    const unmatched: string[] = [];
    let j0 = 0;
    const byS = ref.s.map((_, i) => i).sort((x, y) => ref.s[x]! - ref.s[y]!);
    for (const i of byS) {
      const [s, d, h, cls] = [ref.s[i]!, ref.d[i]!, ref.h[i]!, ref.cls[i]!];
      while (j0 < section.count && section.s[j0]! < s - 0.02) j0++;
      // Wall points of the synthetic buildings stack at one spot: take the closest height.
      let found = -1;
      for (let j = j0; j < section.count && section.s[j]! <= s + 0.02; j++)
        if (
          !used.has(j) &&
          section.cls[j] === cls &&
          Math.abs(section.d[j]! - d) <= 0.012 &&
          Math.abs(section.s[j]! - s) <= 0.012 &&
          Math.abs(section.h[j]! - h) <= 0.05 &&
          (found < 0 || Math.abs(section.h[j]! - h) < Math.abs(section.h[found]! - h))
        )
          found = j;
      if (found < 0) unmatched.push(`s=${s} d=${d} h=${h} cls=${cls}`);
      else used.add(found);
    }
    expect(unmatched).toEqual([]);
    // Sorted by s, within the slab, with colours.
    expect(section.s).toEqual([...section.s].sort((x, y) => x - y));
    expect(Math.max(...section.d.map(Math.abs))).toBeLessThanOrEqual(1.5);
    expect(new Set(section.cls)).toEqual(new Set(ref.cls));
    expect(section.rgb.every((c) => c >= 0 && c <= 0xffffff)).toBe(true);
    // Cached, with an ETag and gzip when asked.
    const etag = response.headers.get('etag')!;
    const again = await fetch(response.url, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    const zipped = await fetch(response.url, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(sectionSchema.parse(await zipped.json()).count).toBe(section.count);
  }, 90000);

  it('answers 400, 404, 409 and 413 for a section it cannot cut', async () => {
    const { created } = await uploadAndWait(laz, 'limites.laz');
    const url = (id: string, query: string) => `${base}/api/layers/${id}/section?${query}`;
    // Across both synthetic buildings (the line of the previous test).
    const line = 'a=-4.717950,41.582649&b=-4.719955,41.583609';
    for (const query of [
      'a=foo&b=-4.72,41.58',
      'b=-4.72,41.58',
      'a=-4.72,41.58&b=-4.72,95',
      `${line}&half=0.1`,
      `${line}&half=6`,
      'a=-4.70,41.58&b=-4.73,41.58', // 2.5 km
      'a=-4.72,41.58&b=-4.72,41.58',
    ]) {
      const response = await fetch(url(created.id, query));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    const missing = await fetch(url('00000000-0000-4000-8000-00000000abcd', line));
    expect(missing.status).toBe(404);
    await db.query(`UPDATE layers SET status='processing' WHERE id=$1`, [created.id]);
    const busy = await fetch(url(created.id, line));
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe('LAYER_NOT_READY');
    await db.query(`UPDATE layers SET status='ready' WHERE id=$1`, [created.id]);
    // A small point limit stands in for the 400,000 of production.
    const small = await buildApp(db, {
      demo: false,
      simulator: false,
      logger: false,
      storage,
      sectionMaxPoints: 50,
    });
    try {
      const over = await small.inject({
        url: `/api/layers/${created.id}/section?${line}&half=5`,
      });
      expect(over.statusCode, over.body).toBe(413);
      expect(over.json().error).toMatchObject({
        code: 'SECTION_TOO_LARGE',
        message: expect.stringMatching(/más de 50 puntos/),
      });
    } finally {
      await small.close();
    }
    const spec = await (await fetch(`${base}/api/openapi.json`)).json();
    const get = spec.paths['/api/layers/{id}/section'].get;
    expect(get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['id', 'a', 'b', 'half']),
    );
    expect(Object.keys(get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '404', '409', '413']),
    );
    expect(Object.keys(get.responses['200'].content['application/json'].schema.properties)).toEqual(
      expect.arrayContaining(['s', 'd', 'h', 'cls', 'rgb', 'count', 'geoid_offset_m']),
    );
  }, 90000);

  it('answers 409 for a file that is already a layer and keeps one copy', async () => {
    const first = await upload(laz, 'a.laz', `?attribution=${encodeURIComponent(SYNTHETIC)}`);
    expect(first.status).toBe(201);
    const second = await upload(laz, 'otro-nombre.laz');
    expect(second.status).toBe(409);
    const error = (await second.json()).error;
    expect(error.code).toBe('DUPLICATE_LAYER');
    expect(error.message).toMatch(/ya está cargado como la capa «a»/);
    const sources = (await storage.list('layers/')).filter((k) => k.endsWith('/source'));
    expect(sources).toHaveLength(1);
  }, 60000);

  it('publishes the accepted formats and the upload limit for the interface', async () => {
    const limits = await fetch(`${base}/api/layers/limits`);
    expect(limits.status).toBe(200);
    expect(await limits.json()).toEqual({
      max_upload_bytes: MAX_UPLOAD,
      formats: ['las', 'laz'],
      extensions: ['.las', '.laz'],
    });
  });

  it('checks the type by content (415) and the size (413) before keeping anything', async () => {
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000)]);
    const disguised = await upload(png, 'nube.laz');
    expect(disguised.status, await disguised.clone().text()).toBe(415);
    expect((await disguised.json()).error.message).toMatch(/LASF/);
    expect((await upload(Buffer.from('x y z\n1 2 3\n'), 'nube.las')).status).toBe(415);
    const json = await fetch(`${base}/api/layers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(json.status).toBe(415);
    // Over the limit with a Content-Length: rejected before reading the body.
    const big = await upload(las, 'grande.las');
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El fichero supera el límite de 0,1 MiB.',
    });
    // Over the limit while streaming (chunked, no Content-Length): stopped mid-upload.
    const boundary = 'geotwin-boundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="g.las"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const chunks = [
      head,
      ...Array.from({ length: 8 }, (_, i) => las.subarray(i * 25600, (i + 1) * 25600)),
      tail,
    ];
    const streamed = await fetch(`${base}/api/layers`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new ReadableStream({
        pull(controller) {
          const next = chunks.shift();
          if (next) controller.enqueue(new Uint8Array(next));
          else controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(await storage.list('layers/')).toEqual([]);
    const rows = await db.query('SELECT count(*)::int AS n FROM layers');
    expect(rows.rows[0].n).toBe(0);
  }, 60000);

  it('answers 400, keeping nothing, when the multipart body is cut short', async () => {
    const boundary = 'geotwin-cut';
    // Headers and part of the file, then the body ends without the closing boundary, as when a
    // client gives up mid-upload behind a proxy that completes the request.
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.laz"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      laz.subarray(0, 20000),
    ]);
    const response = await fetch(`${base}/api/layers`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: 'INCOMPLETE_UPLOAD',
      message: expect.stringMatching(/se cortó/),
    });
    expect(await storage.list('layers/')).toEqual([]);
    const rows = await db.query('SELECT count(*)::int AS n FROM layers');
    expect(rows.rows[0].n).toBe(0);
  });

  it('marks a corrupt file as failed with a readable message', async () => {
    const broken = laz.subarray(0, Math.floor(laz.length / 2));
    const { created, done } = await uploadAndWait(broken, 'roto.laz');
    expect(done.type).toBe('layer:failed');
    const layer = layerSchema.parse(await (await fetch(`${base}/api/layers/${created.id}`)).json());
    expect(layer.status).toBe('failed');
    expect(layer.error).toMatch(/dañado o incompleto|incompleto/);
    expect(layer.tileset_url).toBeNull();
  }, 60000);

  it('reprocesses with a per-layer override into a new immutable tileset', async () => {
    const { created } = await uploadAndWait(laz, 'r.laz', `?geoid_offset_m=52`);
    const first = layerSchema.parse(await (await fetch(`${base}/api/layers/${created.id}`)).json());
    expect(first.vertical).toMatchObject({
      method: 'override',
      geoid_offset_m: 52,
      override_m: 52,
    });
    const ws = listen();
    await ws.opened;
    const response = await fetch(`${base}/api/layers/${created.id}/reprocess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geoid_offset_m: null }),
    });
    expect(response.status).toBe(202);
    expect((await response.json()).status).toBe('queued');
    const busy = await fetch(`${base}/api/layers/${created.id}/reprocess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(busy.status, await busy.clone().text()).toBe(409);
    await ws.waitFor((e) => e.type === 'layer:ready' && e.data.id === created.id);
    ws.close();
    const second = layerSchema.parse(
      await (await fetch(`${base}/api/layers/${created.id}`)).json(),
    );
    expect(second.vertical.override_m).toBeNull();
    expect(second.vertical.method).toBe(hasGrid ? 'egm08_rednap_grid' : 'egm96_centre');
    expect(second.tileset_url).not.toBe(first.tileset_url);
    expect((await fetch(base + second.tileset_url)).status).toBe(200);
    expect((await fetch(base + first.tileset_url)).status).toBe(404);
  }, 90000);

  it('deletes the row and every stored object, and tells connected clients', async () => {
    const { created } = await uploadAndWait(laz, 'borrar.laz');
    const layer = layerSchema.parse(await (await fetch(`${base}/api/layers/${created.id}`)).json());
    expect((await storage.list(`layers/${created.id}/`)).length).toBeGreaterThan(2);
    const ws = listen();
    await ws.opened;
    const response = await fetch(`${base}/api/layers/${created.id}`, { method: 'DELETE' });
    expect(response.status).toBe(204);
    await ws.waitFor((e) => e.type === 'layer:deleted' && e.data.id === created.id);
    ws.close();
    expect(await storage.list(`layers/${created.id}/`)).toEqual([]);
    expect((await fetch(`${base}/api/layers/${created.id}`)).status).toBe(404);
    expect((await fetch(base + layer.tileset_url)).status).toBe(404);
    expect((await fetch(`${base}/api/layers/${created.id}`, { method: 'DELETE' })).status).toBe(
      404,
    );
  }, 90000);

  it('never serves anything outside the layer tiles folder', async () => {
    const { created } = await uploadAndWait(laz, 'rutas.laz');
    for (const path of [
      '..%2Fsource',
      '%2e%2e/source',
      '..%2F..%2F..%2Fetc%2Fpasswd',
      'run/..%2F..%2Fsource',
      '.hidden',
      'a%5Cb',
    ]) {
      const response = await fetch(`${base}/api/layers/${created.id}/tiles/${path}`);
      expect([400, 404]).toContain(response.status);
    }
    const other = await fetch(
      `${base}/api/layers/00000000-0000-4000-8000-00000000abcd/tiles/x/tileset.json`,
    );
    expect(other.status).toBe(404);
  }, 60000);

  it('documents the multipart upload in OpenAPI', async () => {
    const spec = await (await fetch(`${base}/api/openapi.json`)).json();
    const post = spec.paths['/api/layers'].post;
    expect(Object.keys(post.requestBody.content)).toEqual(['multipart/form-data']);
    expect(post.requestBody.content['multipart/form-data'].schema.properties.file.format).toBe(
      'binary',
    );
    expect(Object.keys(post.responses)).toEqual(
      expect.arrayContaining(['201', '409', '413', '415']),
    );
    expect(
      spec.paths['/api/layers/{id}/tiles/*'] ?? spec.paths['/api/layers/{id}/tiles/{*}'],
    ).toBeTruthy();
  });
});
