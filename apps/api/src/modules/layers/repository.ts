import type { Layer } from '@geotwin/shared';
import type { Database, Transaction } from '../../db/pool.js';
import { ORGANIZATION_ID } from '../../config/env.js';

type Queryable = Database | Transaction;
const columns = `l.id, l.organization_id, l.name, l.kind, l.status, l.stage, l.progress, l.error,
  json_build_object('filename', l.original_filename, 'format', l.source_format,
    'size_bytes', l.source_size::float8, 'sha256', l.source_sha256) AS source,
  l.crs_in,
  json_build_object('datum', l.vertical_datum, 'override_m', l.geoid_override_m,
    'geoid_offset_m', l.geoid_offset_m, 'method', l.geoid_method) AS vertical,
  l.point_count::float8 AS point_count, l.point_format,
  CASE WHEN l.bbox IS NULL THEN NULL
    ELSE json_build_array(ST_XMin(l.bbox), ST_YMin(l.bbox), ST_XMax(l.bbox), ST_YMax(l.bbox)) END AS bbox,
  CASE WHEN l.center IS NULL THEN NULL
    ELSE json_build_object('lat', ST_Y(l.center), 'lng', ST_X(l.center)) END AS center,
  CASE WHEN l.min_height_m IS NULL THEN NULL
    ELSE json_build_object('min', l.min_height_m, 'max', l.max_height_m) END AS height_range_m,
  CASE WHEN l.excluded_points IS NULL THEN NULL
    ELSE json_build_object('points', l.excluded_points::float8,
      'classes', coalesce(to_json(l.excluded_classes), '[]'::json)) END AS excluded,
  l.tileset_root_key, l.dtm_key, l.attribution, l.created_at, l.updated_at`;
type LayerRow = Omit<Layer, 'tileset_url' | 'terrain_url'> & {
  tileset_root_key: string | null;
  dtm_key: string | null;
};

/** Public URL of a stored tiles object: `layers/<id>/tiles/<run>/x` → `/api/layers/<id>/tiles/<run>/x`. */
export function tilesUrl(id: string, key: string | null) {
  const prefix = `layers/${id}/tiles/`;
  return key?.startsWith(prefix) ? `/api/layers/${id}/tiles/${key.slice(prefix.length)}` : null;
}
function toLayer({ tileset_root_key, dtm_key, ...row }: LayerRow): Layer {
  const ready = row.status === 'ready';
  return {
    ...row,
    tileset_url: ready ? tilesUrl(row.id, tileset_root_key) : null,
    terrain_url: ready ? tilesUrl(row.id, dtm_key) : null,
  };
}
export interface NewLayer {
  id: string;
  name: string;
  sourceKey: string;
  sourceSize: number;
  sourceFormat: 'las' | 'laz';
  originalFilename: string;
  sha256: string;
  crsIn: string;
  verticalDatum: 'orthometric' | 'ellipsoidal';
  geoidOverride: number | null;
  attribution: string | null;
}

export class LayerRepository {
  constructor(private readonly db: Database) {}
  async list(client: Queryable = this.db) {
    const result = await client.query<LayerRow>(
      `SELECT ${columns} FROM layers l WHERE l.organization_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [ORGANIZATION_ID],
    );
    return result.rows.map(toLayer);
  }
  async get(id: string, client: Queryable = this.db) {
    const result = await client.query<LayerRow>(
      `SELECT ${columns} FROM layers l WHERE l.id=$1 AND l.organization_id=$2`,
      [id, ORGANIZATION_ID],
    );
    return result.rows[0] ? toLayer(result.rows[0]) : null;
  }
  async bySha256(sha256: string) {
    const result = await this.db.query<{ id: string; name: string }>(
      'SELECT id, name FROM layers WHERE organization_id=$1 AND source_sha256=$2',
      [ORGANIZATION_ID, sha256],
    );
    return result.rows[0] ?? null;
  }
  async insert(client: Transaction, layer: NewLayer) {
    await client.query(
      `INSERT INTO layers(id, organization_id, name, source_key, source_size, source_format,
         original_filename, source_sha256, crs_in, vertical_datum, geoid_override_m, attribution)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        layer.id,
        ORGANIZATION_ID,
        layer.name,
        layer.sourceKey,
        layer.sourceSize,
        layer.sourceFormat,
        layer.originalFilename,
        layer.sha256,
        layer.crsIn,
        layer.verticalDatum,
        layer.geoidOverride,
        layer.attribution,
      ],
    );
  }
  async setJob(client: Transaction, id: string, jobId: string | null) {
    await client.query('UPDATE layers SET job_id=$2 WHERE id=$1', [id, jobId]);
  }
  /** Puts a finished or failed layer back in the queue; null when it is still running. */
  async requeue(client: Transaction, id: string, geoidOverride: number | null | undefined) {
    const result = await client.query<{ id: string }>(
      `UPDATE layers SET status='queued', stage='queued', progress=0, error=NULL,
         geoid_override_m = CASE WHEN $3 THEN $4::float8 ELSE geoid_override_m END,
         updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND status IN ('ready','failed') RETURNING id`,
      [id, ORGANIZATION_ID, geoidOverride !== undefined, geoidOverride ?? null],
    );
    return result.rowCount === 1;
  }
  async remove(client: Transaction, id: string) {
    const result = await client.query<{ job_id: string | null }>(
      'DELETE FROM layers WHERE id=$1 AND organization_id=$2 RETURNING job_id',
      [id, ORGANIZATION_ID],
    );
    return result.rows[0] ?? null;
  }
  async tilesetKey(id: string) {
    const result = await this.db.query<{ status: string; tileset_root_key: string | null }>(
      'SELECT status, tileset_root_key FROM layers WHERE id=$1 AND organization_id=$2',
      [id, ORGANIZATION_ID],
    );
    return result.rows[0] ?? null;
  }
}
