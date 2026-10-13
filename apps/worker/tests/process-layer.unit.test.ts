import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalStorage } from '@geotwin/storage';
import { processLayer, type Deps, type LayerJobContext } from '../src/process-layer.js';
import { LayerGoneError, type LayerRepository, type LayerToProcess } from '../src/layers.js';

const python = process.env.LIDAR_TEST_PYTHON ?? 'python3';
const script = new URL('./fake_lidar.py', import.meta.url).pathname;
const LAYER = '11111111-1111-4111-8111-111111111111';

/** In-memory stand-in for the layers table that records every transition. */
class FakeRepo {
  row: LayerToProcess | null;
  log: string[] = [];
  goneAfterProgress = Infinity;
  constructor(status: LayerToProcess['status'] = 'queued') {
    this.row = {
      id: LAYER,
      status,
      source_key: `layers/${LAYER}/source`,
      source_format: 'laz',
      crs_in: 'EPSG:25830',
      vertical_datum: 'orthometric',
      geoid_override_m: null,
    };
  }
  async find() {
    return this.row;
  }
  async start() {
    if (!this.row || this.row.status === 'ready') return false;
    this.row.status = 'processing';
    this.log.push('start');
    return true;
  }
  async progress(_id: string, _job: string, stage: string, value: number) {
    if (this.log.filter((l) => l.startsWith('progress')).length >= this.goneAfterProgress) {
      this.row = null;
      throw new LayerGoneError(LAYER);
    }
    this.log.push(`progress:${stage}:${value}`);
  }
  ready: (id: string, job: string, meta: object) => Promise<void> = async (_id, _job, meta) => {
    this.row!.status = 'ready';
    this.log.push(`ready:${JSON.stringify(meta)}`);
  };
  async fail(_id: string, _job: string, message: string) {
    this.row!.status = 'failed';
    this.log.push(`fail:${message}`);
  }
  async requeue() {
    this.row!.status = 'queued';
    this.log.push('requeue');
  }
}

let dir: string;
let storage: LocalStorage;
let argsFile: string;
const logs: string[] = [];
const log = {
  info: (_o: object, m: string) => logs.push(m),
  warn: (_o: object, m: string) => logs.push(m),
  error: (_o: object, m: string) => logs.push(m),
};
function deps(repo: FakeRepo, overrides: Partial<Deps['env']> = {}): Deps {
  return {
    repo: repo as unknown as LayerRepository,
    storage,
    log,
    env: {
      LIDAR_PYTHON: python,
      LIDAR_SCRIPT: script,
      WORKER_TMP_DIR: dir,
      TILER_JOBS: 1,
      TILER_CACHE_MB: undefined,
      GEOID_GRID_DIR: undefined,
      GEOID_OFFSET_M: undefined,
      LAYER_JOB_TIMEOUT_SECONDS: 1800,
      ...overrides,
    },
  };
}
function job(overrides: Partial<LayerJobContext> = {}): LayerJobContext {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    layerId: LAYER,
    retryCount: 0,
    retryLimit: 2,
    signal: new AbortController().signal,
    ...overrides,
  };
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geotwin-worker-test-'));
  storage = new LocalStorage(join(dir, 'storage'));
  argsFile = join(dir, 'args.json');
  process.env.FAKE_LIDAR_ARGS = argsFile;
  process.env.FAKE_LIDAR_MODE = 'ok';
  await storage.put(`layers/${LAYER}/source`, Readable.from([Buffer.from('LASF')]));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Layer job state machine', () => {
  it('goes queued → processing (download, inspect, tile, upload) → ready', async () => {
    const repo = new FakeRepo();
    expect(await processLayer(job(), deps(repo))).toBe('ready');
    const stages = repo.log.filter((l) => l.startsWith('progress')).map((l) => l.split(':')[1]);
    expect([...new Set(stages)]).toEqual(['downloading', 'inspecting', 'tiling', 'uploading']);
    const values = repo.log
      .filter((l) => l.startsWith('progress'))
      .map((l) => Number(l.split(':')[2]));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    const ready = JSON.parse(repo.log.at(-1)!.slice('ready:'.length));
    expect(ready).toMatchObject({
      point_count: 5540,
      point_format: 7, // LAZ bit stripped
      geoid_method: 'egm96_centre',
      tileset_root_key: `layers/${LAYER}/tiles/22222222-2222-4222-8222-222222222222/tileset.json`,
    });
    expect(ready.geoid_offset_m).toBeCloseTo(53.6, 1);
    // The constant correction reaches the converter, the temp folder is gone, tiles are stored.
    const args = JSON.parse(await readFile(argsFile, 'utf8'));
    expect(args).toContain('--z-offset');
    expect(args[args.indexOf('--z-offset') + 1]).toBe(String(ready.geoid_offset_m));
    expect(await storage.list(`layers/${LAYER}/tiles/`)).toEqual([
      `layers/${LAYER}/tiles/22222222-2222-4222-8222-222222222222/points/r.pnts`,
      `layers/${LAYER}/tiles/22222222-2222-4222-8222-222222222222/tileset.json`,
    ]);
    expect(existsSync(join(dir, `geotwin-layer-${LAYER}-`))).toBe(false);
  });
  it('replaces an older run when a layer is processed again', async () => {
    await storage.put(`layers/${LAYER}/tiles/old-run/tileset.json`, Readable.from(['{}']));
    await processLayer(job(), deps(new FakeRepo('failed')));
    const keys = await storage.list(`layers/${LAYER}/tiles/`);
    expect(keys.some((k) => k.includes('old-run'))).toBe(false);
    expect(keys).toHaveLength(2);
  });
  it('skips a layer that is already ready or no longer exists (idempotent re-delivery)', async () => {
    const ready = new FakeRepo('ready');
    expect(await processLayer(job(), deps(ready))).toBe('skipped');
    expect(ready.log).toEqual([]);
    const gone = new FakeRepo();
    gone.row = null;
    expect(await processLayer(job(), deps(gone))).toBe('skipped');
  });
  it('fails at once, without retrying, when the file itself is bad', async () => {
    process.env.FAKE_LIDAR_MODE = 'corrupt';
    const repo = new FakeRepo();
    expect(await processLayer(job(), deps(repo))).toBe('failed');
    expect(repo.log.at(-1)).toBe('fail:El fichero está incompleto.');
  });
  it('re-queues on an unexpected error and only fails on the last attempt', async () => {
    process.env.FAKE_LIDAR_MODE = 'internal';
    const first = new FakeRepo();
    await expect(processLayer(job({ retryCount: 0 }), deps(first))).rejects.toThrow(/disk full/);
    expect(first.log.at(-1)).toBe('requeue');
    const last = new FakeRepo();
    await expect(processLayer(job({ retryCount: 2 }), deps(last))).rejects.toThrow(/disk full/);
    expect(last.log.at(-1)).toBe('fail:OSError: disk full');
  });
  it('reports a crash of the converter with its last stderr line', async () => {
    process.env.FAKE_LIDAR_MODE = 'crash';
    const repo = new FakeRepo();
    await expect(processLayer(job({ retryCount: 2 }), deps(repo))).rejects.toThrow(
      /something exploded/,
    );
    expect(repo.log.at(-1)).toMatch(/^fail:El conversor terminó con código 1/);
  });
  it('kills the converter on timeout and says so', async () => {
    process.env.FAKE_LIDAR_MODE = 'slow';
    const controller = new AbortController();
    const repo = new FakeRepo();
    setTimeout(() => controller.abort(new Error('job expired')), 300);
    const started = Date.now();
    await expect(
      processLayer(job({ retryCount: 2, signal: controller.signal }), deps(repo)),
    ).rejects.toThrow('job expired');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(repo.log.at(-1)).toMatch(/^fail:El procesamiento se canceló o superó el tiempo máximo/);
  });
  it('stops and cleans up when the layer is deleted mid-run', async () => {
    const repo = new FakeRepo();
    repo.goneAfterProgress = 3;
    expect(await processLayer(job(), deps(repo))).toBe('skipped');
    expect(await storage.list(`layers/${LAYER}/`)).toEqual([]);
  });
  it('honours a worker-wide override and passes the grid only when configured', async () => {
    const repo = new FakeRepo();
    await processLayer(job(), deps(repo, { GEOID_OFFSET_M: 51.25 }));
    expect(JSON.parse(repo.log.at(-1)!.slice('ready:'.length))).toMatchObject({
      geoid_method: 'override',
      geoid_offset_m: 51.25,
    });
    const args = JSON.parse(await readFile(argsFile, 'utf8'));
    expect(args).not.toContain('--grid-dir');
    await writeFile(argsFile, '');
  });
});
