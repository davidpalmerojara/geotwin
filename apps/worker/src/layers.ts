import type pg from 'pg';
import { REALTIME_CHANNEL, type LayerStage } from '@geotwin/shared';

/** The row moved on (deleted, or taken over by a newer attempt): stop working on it. */
export class LayerGoneError extends Error {
  constructor(id: string) {
    super(`Layer ${id} was deleted or is handled by another attempt`);
  }
}
export interface LayerToProcess {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  source_key: string;
  source_format: 'las' | 'laz';
  crs_in: string;
  vertical_datum: 'orthometric' | 'ellipsoidal';
  geoid_override_m: number | null;
}
export interface ReadyLayer {
  point_count: number;
  point_format: number;
  crs_in: string;
  bbox: [number, number, number, number];
  center: { lng: number; lat: number };
  height_range: [number, number];
  geoid_offset_m: number;
  geoid_method: string;
  tileset_root_key: string;
}
// Every state change is one statement that updates the row and NOTIFYs listeners with values
// read from that same row; outside an explicit transaction it is delivered when it commits.
const notifyProgress = `SELECT pg_notify('${REALTIME_CHANNEL}', json_build_object(
  'event','progress','id',id,'status',status,'stage',stage,'progress',progress)::text) FROM u`;
const notifyEvent = (event: string) =>
  `SELECT pg_notify('${REALTIME_CHANNEL}', json_build_object('event','${event}','id',id)::text) FROM u`;

export class LayerRepository {
  constructor(private readonly db: pg.Pool) {}
  async find(id: string) {
    const result = await this.db.query<LayerToProcess>(
      `SELECT id, status, source_key, source_format, crs_in, vertical_datum, geoid_override_m
       FROM layers WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
  /** Claims the layer for this job attempt. Ready layers are left alone (idempotent re-run). */
  async start(id: string, jobId: string) {
    const result = await this.db.query(
      `WITH u AS (UPDATE layers SET status='processing', stage='downloading', progress=1,
         error=NULL, job_id=$2, updated_at=now()
       WHERE id=$1 AND status <> 'ready' RETURNING id, status, stage, progress) ${notifyProgress}`,
      [id, jobId],
    );
    return result.rowCount === 1;
  }
  async progress(id: string, jobId: string, stage: LayerStage, progress: number) {
    const result = await this.db.query(
      `WITH u AS (UPDATE layers SET stage=$3, progress=$4, updated_at=now()
       WHERE id=$1 AND job_id=$2 AND status='processing' RETURNING id, status, stage, progress)
       ${notifyProgress}`,
      [id, jobId, stage, Math.max(0, Math.min(99, Math.round(progress)))],
    );
    if (result.rowCount !== 1) throw new LayerGoneError(id);
  }
  async ready(id: string, jobId: string, meta: ReadyLayer) {
    const result = await this.db.query(
      `WITH u AS (UPDATE layers SET status='ready', stage='done', progress=100, error=NULL,
         point_count=$3, point_format=$4, crs_in=$5,
         bbox=ST_MakeEnvelope($6,$7,$8,$9,4326), center=ST_SetSRID(ST_MakePoint($10,$11),4326),
         min_height_m=$12, max_height_m=$13, geoid_offset_m=$14, geoid_method=$15,
         tileset_root_key=$16, updated_at=now()
       WHERE id=$1 AND job_id=$2 AND status='processing' RETURNING id) ${notifyEvent('ready')}`,
      [
        id,
        jobId,
        meta.point_count,
        meta.point_format,
        meta.crs_in,
        ...meta.bbox,
        meta.center.lng,
        meta.center.lat,
        ...meta.height_range,
        meta.geoid_offset_m,
        meta.geoid_method,
        meta.tileset_root_key,
      ],
    );
    if (result.rowCount !== 1) throw new LayerGoneError(id);
  }
  async fail(id: string, jobId: string, message: string) {
    await this.db.query(
      `WITH u AS (UPDATE layers SET status='failed', error=$3, updated_at=now()
       WHERE id=$1 AND job_id=$2 AND status IN ('queued','processing') RETURNING id)
       ${notifyEvent('failed')}`,
      [id, jobId, message.slice(0, 1000)],
    );
  }
  /** Back to the queue before a retry, so the interface does not show a frozen progress bar. */
  async requeue(id: string, jobId: string) {
    await this.db.query(
      `WITH u AS (UPDATE layers SET status='queued', stage='queued', progress=0, updated_at=now()
       WHERE id=$1 AND job_id=$2 AND status='processing' RETURNING id, status, stage, progress)
       ${notifyProgress}`,
      [id, jobId],
    );
  }
}
