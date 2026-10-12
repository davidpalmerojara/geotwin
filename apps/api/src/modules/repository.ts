import type {
  Asset,
  Installation,
  Organization,
  Sensor,
  Reading,
  Alert,
  Summary,
} from '@geotwin/shared';
import type { Database, Transaction } from '../db/pool.js';
import { ORGANIZATION_ID } from '../config/env.js';
export const assetColumns = `a.id,a.organization_id,a.installation_id,a.name,a.type,a.status,
 json_build_object('lat',ST_Y(a.location),'lng',ST_X(a.location)) AS location,a.created_at,a.updated_at`;
export const alertColumns = `al.*,a.name AS asset_name`;
type Queryable = Database | Transaction;
// The search box matches literal text: % and _ are not wildcards for the user.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
export class Repository {
  constructor(public db: Database) {}
  async assets(filters: { installation_id?: string; status?: string; search?: string } = {}) {
    return (
      await this.db.query<Asset>(
        `SELECT ${assetColumns} FROM assets a
      WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.installation_id=$2)
      AND ($3::text IS NULL OR a.status=$3) AND ($4::text IS NULL OR a.name ILIKE '%'||$4||'%' ESCAPE '\\') ORDER BY a.name`,
        [
          ORGANIZATION_ID,
          filters.installation_id ?? null,
          filters.status ?? null,
          filters.search === undefined ? null : escapeLike(filters.search),
        ],
      )
    ).rows;
  }
  async asset(id: string, client: Queryable = this.db) {
    return (
      await client.query<Asset>(
        `SELECT ${assetColumns} FROM assets a WHERE a.id=$1 AND a.organization_id=$2`,
        [id, ORGANIZATION_ID],
      )
    ).rows[0];
  }
  async renameAsset(id: string, name: string) {
    return (
      await this.db.query<Asset>(
        `UPDATE assets a SET name=$1,updated_at=now() WHERE a.id=$2 AND a.organization_id=$3
        RETURNING ${assetColumns}`,
        [name, id, ORGANIZATION_ID],
      )
    ).rows[0];
  }
  async organization() {
    return (
      await this.db.query<Organization>('SELECT id,name,region FROM organizations WHERE id=$1', [
        ORGANIZATION_ID,
      ])
    ).rows[0];
  }
  async installations() {
    return (
      await this.db.query<Installation>(
        `SELECT i.id,i.organization_id,i.name,i.description,
      json_build_object('lat',ST_Y(i.location),'lng',ST_X(i.location)) AS location,count(a.id)::int AS asset_count
      FROM installations i LEFT JOIN assets a ON a.installation_id=i.id
      WHERE i.organization_id=$1 GROUP BY i.id ORDER BY i.name`,
        [ORGANIZATION_ID],
      )
    ).rows;
  }
  async nearby(lat: number, lng: number, radius: number) {
    return (
      await this.db.query<Asset & { distance_m: number }>(
        `SELECT ${assetColumns},
      ST_Distance(a.location::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS distance_m
      FROM assets a WHERE a.organization_id=$1
      AND ST_DWithin(a.location::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4)
      ORDER BY distance_m`,
        [ORGANIZATION_ID, lng, lat, radius],
      )
    ).rows;
  }
  async sensors(assetId?: string, client: Queryable = this.db) {
    return (
      await client.query<Sensor>(
        `SELECT s.*,r.value AS latest_value,r.recorded_at AS latest_at
      FROM sensors s JOIN assets a ON a.id=s.asset_id
      LEFT JOIN LATERAL (SELECT value,recorded_at FROM sensor_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) r ON true
      WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.id=$2) ORDER BY s.id`,
        [ORGANIZATION_ID, assetId ?? null],
      )
    ).rows;
  }
  // Top-N per sensor through the (sensor_id, recorded_at) index, then the newest N overall.
  async readings(assetId: string, limit: number, sensorId?: string) {
    return (
      await this.db.query<Reading>(
        `SELECT sensor_id,asset_id,metric_type,unit,value,recorded_at,simulated FROM (
        SELECT s.id AS sensor_id,s.asset_id,s.metric_type,s.unit,r.value,r.recorded_at,r.simulated,r.id
        FROM sensors s JOIN assets a ON a.id=s.asset_id
        CROSS JOIN LATERAL (
          SELECT id,value,recorded_at,simulated FROM sensor_readings
          WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT $3
        ) r
        WHERE a.id=$1 AND a.organization_id=$2 AND ($4::uuid IS NULL OR s.id=$4)
        ORDER BY r.recorded_at DESC,r.id DESC LIMIT $3
      ) recent ORDER BY recorded_at ASC,id ASC`,
        [assetId, ORGANIZATION_ID, limit, sensorId ?? null],
      )
    ).rows;
  }
  async alerts(
    filters: { installation_id?: string; asset_id?: string; status?: string; limit?: number } = {},
  ) {
    return (
      await this.db.query<Alert>(
        `SELECT ${alertColumns} FROM alerts al JOIN assets a ON a.id=al.asset_id
      WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR al.asset_id=$2)
      AND ($3::text IS NULL OR al.status=$3) AND ($4::uuid IS NULL OR a.installation_id=$4)
      ORDER BY al.triggered_at DESC LIMIT $5`,
        [
          ORGANIZATION_ID,
          filters.asset_id ?? null,
          filters.status ?? null,
          filters.installation_id ?? null,
          filters.limit ?? 100,
        ],
      )
    ).rows;
  }
  async alert(id: string, client: Queryable = this.db) {
    return (
      await client.query<Alert>(
        `SELECT ${alertColumns} FROM alerts al JOIN assets a ON a.id=al.asset_id
      WHERE al.id=$1 AND a.organization_id=$2`,
        [id, ORGANIZATION_ID],
      )
    ).rows[0];
  }
  async summary(installationId?: string) {
    const result = await this.db.query<Summary>(
      `WITH scoped AS (
      SELECT * FROM assets WHERE organization_id=$1 AND ($2::uuid IS NULL OR installation_id=$2)
    ), points AS (
      SELECT date_trunc('minute',r.recorded_at) AS recorded_at,
      coalesce(avg(r.value) FILTER(WHERE s.metric_type='temperature'),0)::float8 AS temperature,
      coalesce(avg(r.value) FILTER(WHERE s.metric_type='vibration'),0)::float8 AS vibration
      FROM sensor_readings r JOIN sensors s ON s.id=r.sensor_id JOIN scoped a ON a.id=s.asset_id
      WHERE r.recorded_at > now()-interval '30 minutes' GROUP BY 1 ORDER BY 1
    ) SELECT count(*)::int AS total_assets,
      count(*) FILTER(WHERE status='healthy')::int AS operational_assets,
      count(*) FILTER(WHERE status='warning')::int AS warning_assets,
      count(*) FILTER(WHERE status='critical')::int AS critical_assets,
      (SELECT count(*)::int FROM alerts al JOIN scoped a ON a.id=al.asset_id WHERE al.status='active') AS active_alerts,
      (SELECT count(*)::int FROM alerts al JOIN scoped a ON a.id=al.asset_id WHERE al.status='active' AND severity='critical') AS critical_incidents,
      (SELECT count(*)::int FROM sensors s JOIN scoped a ON a.id=s.asset_id
       WHERE EXISTS(SELECT 1 FROM sensor_readings r WHERE r.sensor_id=s.id AND recorded_at>now()-interval '2 minutes')) AS active_sensors,
      (SELECT count(*)::int FROM installations WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2)) AS installations,
      true AS simulated,coalesce((SELECT json_agg(points ORDER BY recorded_at) FROM points),'[]') AS trend
      FROM scoped`,
      [ORGANIZATION_ID, installationId ?? null],
    );
    return result.rows[0]!;
  }
}
