import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Storage } from '@geotwin/storage';
import { contentTypeFor } from '@geotwin/storage';
import type { LayerStage } from '@geotwin/shared';
import { LayerGoneError, type LayerRepository } from './layers.js';
import { LidarToolError, runLidarTool } from './python.js';
import { planVertical } from './geoid.js';
import { z } from 'zod';
import type { WorkerEnv } from './config.js';

export interface LayerJobContext {
  id: string;
  layerId: string;
  /** 0 on the first attempt. */
  retryCount: number;
  retryLimit: number;
  signal: AbortSignal;
}
export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
export interface Deps {
  repo: LayerRepository;
  storage: Storage;
  env: Pick<
    WorkerEnv,
    | 'LIDAR_PYTHON'
    | 'LIDAR_SCRIPT'
    | 'WORKER_TMP_DIR'
    | 'TILER_JOBS'
    | 'TILER_CACHE_MB'
    | 'GEOID_GRID_DIR'
    | 'GEOID_OFFSET_M'
    | 'LAYER_JOB_TIMEOUT_SECONDS'
  >;
  log: Logger;
}
export type Outcome = 'ready' | 'failed' | 'skipped';

/** Where a layer's objects live in storage. Everything for one layer is under one prefix. */
export const layerPrefix = (id: string) => `layers/${id}/`;
export const tilesPrefix = (id: string) => `layers/${id}/tiles/`;
export const runPrefix = (id: string, jobId: string) => `${tilesPrefix(id)}${jobId}/`;

// Progress budget per stage (percent of the whole job).
const STAGES: Record<Exclude<LayerStage, 'queued' | 'done'>, [number, number]> = {
  downloading: [1, 5],
  inspecting: [5, 15],
  tiling: [15, 90],
  uploading: [90, 99],
};

/**
 * One attempt at turning an uploaded LAS/LAZ into a 3D Tiles tileset.
 *
 * Idempotent: a ready layer is skipped, and each attempt starts from the source object in a fresh
 * temp folder and replaces the whole tiles prefix. Bad input (corrupt file, wrong CRS…) fails the
 * layer at once with a readable message; anything else is rethrown so pg-boss retries with
 * backoff, and only the last attempt marks the layer failed.
 */
export async function processLayer(job: LayerJobContext, deps: Deps): Promise<Outcome> {
  const { repo, storage, env, log } = deps;
  const layer = await repo.find(job.layerId);
  if (!layer || layer.status === 'ready') {
    log.info({ layerId: job.layerId, status: layer?.status }, 'Layer job skipped');
    return 'skipped';
  }
  if (!(await repo.start(layer.id, job.id))) return 'skipped';
  const dir = await mkdtemp(join(env.WORKER_TMP_DIR, `geotwin-layer-${layer.id}-`));
  // Progress writes are throttled: at most one per second unless the stage changes.
  let last = { stage: '', at: 0, value: -1 };
  const report = async (stage: keyof typeof STAGES, fraction: number) => {
    const [from, to] = STAGES[stage];
    const value = Math.round(from + (to - from) * Math.max(0, Math.min(1, fraction)));
    const now = Date.now();
    if (stage === last.stage && (value === last.value || now - last.at < 1000)) return;
    last = { stage, at: now, value };
    await repo.progress(layer.id, job.id, stage, value);
  };
  // Progress callbacks fire synchronously from the child's output; keep their writes in order.
  let chain = Promise.resolve();
  const queueReport = (stage: keyof typeof STAGES, fraction: number) => {
    chain = chain
      .then(() => report(stage, fraction))
      .catch((error: unknown) => {
        if (error instanceof LayerGoneError) gone.abort(error);
      });
  };
  // Stops the converter early when the layer disappears (deleted from the API) mid-run.
  const gone = new AbortController();
  const signal = AbortSignal.any([job.signal, gone.signal]);
  const python = { python: env.LIDAR_PYTHON, script: env.LIDAR_SCRIPT, signal };
  try {
    const source = join(dir, `source.${layer.source_format}`);
    await report('downloading', 0);
    await storage.download(layer.source_key, source);
    await report('inspecting', 0);
    const info = inspectSchema.parse(
      await runLidarTool(
        [
          'inspect',
          source,
          '--crs-in',
          layer.crs_in,
          ...(env.GEOID_GRID_DIR ? ['--grid-dir', env.GEOID_GRID_DIR] : []),
        ],
        { ...python, onProgress: (f) => queueReport('inspecting', f) },
      ),
    );
    await chain;
    const plan = planVertical({
      datum: layer.vertical_datum,
      layerOverride: layer.geoid_override_m,
      envOverride: env.GEOID_OFFSET_M,
      gridOffset: info.grid_offset_m,
      center: info.center,
    });
    log.info({ layerId: layer.id, plan, points: info.point_count }, 'Vertical datum plan');
    await report('tiling', 0);
    const out = join(dir, 'tiles');
    await runLidarTool(
      [
        'convert',
        source,
        out,
        '--crs-in',
        info.crs_in,
        '--jobs',
        String(env.TILER_JOBS),
        ...(plan.exact
          ? ['--exact-geoid', '--grid-dir', env.GEOID_GRID_DIR ?? '']
          : ['--z-offset', String(plan.offset_m)]),
        ...(info.color_scale ? ['--color-scale', String(info.color_scale)] : []),
        ...(env.TILER_CACHE_MB ? ['--cache-mb', String(env.TILER_CACHE_MB)] : []),
      ],
      { ...python, onProgress: (f) => queueReport('tiling', f) },
    );
    await chain;
    await report('uploading', 0);
    // Each job writes to its own folder, so tile URLs never change content and can be cached
    // as immutable; a retry of the same job first clears what an earlier attempt left there.
    const run = runPrefix(layer.id, job.id);
    await storage.deletePrefix(run);
    const files = await listFiles(out);
    const total = files.reduce((sum, f) => sum + f.size, 0) || 1;
    let sent = 0;
    await mapLimit(files, 4, async (file) => {
      signal.throwIfAborted();
      await storage.putFile(run + file.key, file.path, contentTypeFor(file.key));
      sent += file.size;
      queueReport('uploading', sent / total);
    });
    await chain;
    await repo.ready(layer.id, job.id, {
      point_count: info.point_count,
      point_format: info.point_format & 0x3f,
      crs_in: info.crs_in,
      bbox: info.bbox,
      center: info.center,
      height_range: info.height_range,
      geoid_offset_m: plan.offset_m,
      geoid_method: plan.method,
      tileset_root_key: `${run}tileset.json`,
    });
    // Older runs (a reprocessed layer) are no longer referenced.
    const runs = new Set(
      (await storage.list(tilesPrefix(layer.id))).map(
        (key) =>
          `${tilesPrefix(layer.id)}${key.slice(tilesPrefix(layer.id).length).split('/')[0]}/`,
      ),
    );
    for (const old of runs) if (old !== run) await storage.deletePrefix(old);
    log.info({ layerId: layer.id, files: files.length, bytes: total }, 'Layer ready');
    return 'ready';
  } catch (error) {
    // Deleted meanwhile (DELETE also cancels the job, which aborts us): the API removed the row
    // and its objects, so drop whatever this attempt uploaded afterwards.
    if (error instanceof LayerGoneError || !(await repo.find(layer.id).catch(() => layer))) {
      await storage.deletePrefix(layerPrefix(layer.id)).catch(() => undefined);
      log.info({ layerId: layer.id }, 'Layer deleted while processing');
      return 'skipped';
    }
    const permanent = error instanceof LidarToolError && error.permanent;
    const lastAttempt = job.retryCount >= job.retryLimit;
    const message = userMessage(error, job.signal, env.LAYER_JOB_TIMEOUT_SECONDS);
    if (permanent || lastAttempt) {
      await repo.fail(layer.id, job.id, message);
      log.warn({ layerId: layer.id, err: error, permanent }, 'Layer failed');
      if (permanent) return 'failed';
      throw error;
    }
    await repo.requeue(layer.id, job.id).catch(() => undefined);
    log.warn({ layerId: layer.id, err: error, retry: job.retryCount + 1 }, 'Layer will retry');
    throw error;
  } finally {
    await chain;
    await rm(dir, { recursive: true, force: true });
  }
}

function userMessage(error: unknown, signal: AbortSignal, timeoutSeconds: number) {
  if (signal.aborted)
    return `El procesamiento se canceló o superó el tiempo máximo (${Math.round(timeoutSeconds / 60)} min).`;
  if (error instanceof LidarToolError) return error.message;
  return `Error al procesar la capa: ${error instanceof Error ? error.message : String(error)}`;
}

const inspectSchema = z.object({
  point_count: z.number().int().positive(),
  point_format: z.number().int().min(0),
  crs_in: z.string().regex(/^EPSG:\d{4,6}$/),
  color_scale: z.number().positive().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  center: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }),
  height_range: z.tuple([z.number(), z.number()]),
  grid_offset_m: z.number().nullable(),
});

async function listFiles(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: { key: string; path: string; size: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push({
      key: relative(root, path).split(sep).join('/'),
      path,
      size: (await stat(path)).size,
    });
  }
  return files.sort((a, b) => a.key.localeCompare(b.key));
}
async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(runners);
}
