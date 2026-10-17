import type { Alert, AssetStatus, RealtimeEvent, Sensor } from '@geotwin/shared';
import { transaction, type Database, type Transaction } from '../db/pool.js';
import { Repository, alertColumns } from './repository.js';
import { decimal, evaluate, generatedValue, metricLabel } from '../simulator/domain.js';
import { notFound } from './errors.js';
interface Measurement {
  sensor: Sensor;
  value: number;
}
export class TelemetryService {
  private repository: Repository;
  constructor(
    private db: Database,
    private publish: (events: RealtimeEvent[]) => void,
  ) {
    this.repository = new Repository(db);
  }
  // One row lock serializes tick, overrides, manual incidents and resolution across processes.
  // The timestamp is read after the lock is held, so commit order and time order agree.
  // It travels as text to keep PostgreSQL's microsecond precision.
  private async lock(client: Transaction) {
    await client.query('SELECT sequence FROM telemetry_state WHERE singleton=true FOR UPDATE');
  }
  private async lockedAt(client: Transaction) {
    await this.lock(client);
    return (await client.query<{ at: string }>('SELECT clock_timestamp()::text AS at')).rows[0]!.at;
  }
  // One aggregate and one UPDATE for every affected asset, whatever the batch size.
  private async refreshStatuses(
    client: Transaction,
    assetIds: string[],
    at: string,
    events: RealtimeEvent[],
  ) {
    if (!assetIds.length) return;
    const changed = await client.query<{ id: string; status: AssetStatus }>(
      `WITH computed AS (
        SELECT a.id, CASE WHEN bool_or(al.severity='critical') THEN 'critical'
          WHEN bool_or(al.severity='warning') THEN 'warning' ELSE 'healthy' END AS status
        FROM assets a LEFT JOIN alerts al ON al.asset_id=a.id AND al.status='active'
        WHERE a.id = ANY($1::uuid[]) GROUP BY a.id
      )
      UPDATE assets a SET status=c.status, updated_at=$2::timestamptz FROM computed c
      WHERE a.id=c.id AND a.status IS DISTINCT FROM c.status
      RETURNING a.id, a.status`,
      [[...new Set(assetIds)], at],
    );
    for (const row of changed.rows.sort((x, y) => x.id.localeCompare(y.id)))
      events.push({ type: 'asset:status_changed', data: { asset_id: row.id, status: row.status } });
  }
  private async alertsById(client: Transaction, ids: string[]) {
    if (!ids.length) return [];
    return (
      await client.query<Alert>(
        `SELECT ${alertColumns} FROM alerts al JOIN assets a ON a.id=al.asset_id
        WHERE al.id = ANY($1::uuid[]) ORDER BY al.triggered_at, al.id`,
        [ids],
      )
    ).rows;
  }
  /**
   * Persists a batch of readings with a fixed number of statements:
   * readings (unnest), new or escalated alerts, natural recoveries and one status recompute.
   */
  private async record(
    client: Transaction,
    batch: Measurement[],
    at: string,
    events: RealtimeEvent[],
  ) {
    if (!batch.length) return;
    const inserted = await client.query<{ sensor_id: string; recorded_at: string }>(
      `INSERT INTO sensor_readings(sensor_id,value,recorded_at)
      SELECT t.sensor_id, t.value, $3::timestamptz FROM unnest($1::uuid[], $2::float8[]) AS t(sensor_id,value)
      RETURNING sensor_id, recorded_at`,
      [batch.map((m) => m.sensor.id), batch.map((m) => m.value), at],
    );
    const recordedAt = new Map(inserted.rows.map((r) => [r.sensor_id, r.recorded_at]));
    for (const { sensor, value } of batch)
      events.push({
        type: 'sensor:reading',
        data: {
          sensor_id: sensor.id,
          asset_id: sensor.asset_id,
          metric_type: sensor.metric_type,
          unit: sensor.unit,
          value,
          recorded_at: recordedAt.get(sensor.id)!,
          simulated: true,
        },
      });
    const anomalies = batch.flatMap((m) => {
      const severity = evaluate(m.value, m.sensor);
      return severity === 'healthy' ? [] : [{ ...m, severity }];
    });
    // A new anomaly opens one alert per sensor (partial unique index); a critical reading
    // escalates an existing warning. Both CTEs read the same snapshot, so they never overlap.
    const opened = anomalies.length
      ? await client.query<{ id: string; kind: 'created' | 'escalated' }>(
          `WITH input AS (
            SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
            AS t(sensor_id, asset_id, severity, message)
          ), inserted AS (
            INSERT INTO alerts(asset_id,sensor_id,severity,message,source,triggered_at)
            SELECT asset_id, sensor_id, severity, message, 'telemetry', $5::timestamptz FROM input
            ON CONFLICT(sensor_id) WHERE status='active' AND sensor_id IS NOT NULL DO NOTHING
            RETURNING id
          ), escalated AS (
            UPDATE alerts al SET severity='critical', message=i.message, acknowledged_at=NULL FROM input i
            WHERE al.sensor_id=i.sensor_id AND al.status='active'
              AND al.severity='warning' AND i.severity='critical'
            RETURNING al.id
          ) SELECT id, 'created' AS kind FROM inserted
          UNION ALL SELECT id, 'escalated' AS kind FROM escalated`,
          [
            anomalies.map((m) => m.sensor.id),
            anomalies.map((m) => m.sensor.asset_id),
            anomalies.map((m) => m.severity),
            anomalies.map((m) => alertMessage(m.sensor, m.value, m.severity)),
            at,
          ],
        )
      : { rows: [] };
    // A new alert is alert:created; an escalation changes an existing one (alert:updated).
    const escalated = new Set(opened.rows.filter((r) => r.kind === 'escalated').map((r) => r.id));
    for (const alert of await this.alertsById(
      client,
      opened.rows.map((r) => r.id),
    ))
      events.push({
        type: escalated.has(alert.id) ? 'alert:updated' : 'alert:created',
        data: alert,
      });
    // Natural simulator anomalies close themselves once the reading is back in range.
    // Injected anomalies keep their override and manual incidents have no sensor, so both
    // stay active until someone resolves them.
    const healthy = batch.filter((m) => evaluate(m.value, m.sensor) === 'healthy');
    const recovered = healthy.length
      ? await client.query<{ id: string }>(
          `UPDATE alerts al SET status='resolved', resolved_at=$2::timestamptz, resolved_by='auto_recovery'
          WHERE al.status='active' AND al.source='telemetry' AND al.sensor_id = ANY($1::uuid[])
            AND NOT EXISTS(SELECT 1 FROM simulation_overrides o WHERE o.sensor_id=al.sensor_id)
          RETURNING al.id`,
          [healthy.map((m) => m.sensor.id), at],
        )
      : { rows: [] };
    for (const alert of await this.alertsById(
      client,
      recovered.rows.map((r) => r.id),
    ))
      events.push({ type: 'alert:resolved', data: alert });
    await this.refreshStatuses(
      client,
      batch.map((m) => m.sensor.asset_id),
      at,
      events,
    );
  }
  async tick() {
    const events = await transaction(this.db, async (client) => {
      await this.lock(client);
      const state = (
        await client.query<{ sequence: string; at: string }>(
          'UPDATE telemetry_state SET sequence=sequence+1 RETURNING sequence, clock_timestamp()::text AS at',
        )
      ).rows[0]!;
      const overrides = (
        await client.query<{ sensor_id: string; mode: 'warning' | 'critical' }>(
          'SELECT sensor_id,mode FROM simulation_overrides',
        )
      ).rows;
      const modes = new Map(overrides.map((o) => [o.sensor_id, o.mode]));
      const sensors = await this.repository.sensors(undefined, client);
      const events: RealtimeEvent[] = [];
      await this.record(
        client,
        sensors.map((sensor) => ({
          sensor,
          value: generatedValue(sensor, Number(state.sequence), modes.get(sensor.id)),
        })),
        state.at,
        events,
      );
      return events;
    });
    this.publish(events);
  }
  async simulate(sensorId: string, mode: 'warning' | 'critical') {
    const result = await transaction(this.db, async (client) => {
      const at = await this.lockedAt(client);
      const sensor = (await this.repository.sensors(undefined, client)).find(
        (s) => s.id === sensorId,
      );
      if (!sensor) notFound('Sensor');
      await client.query(
        `INSERT INTO simulation_overrides(sensor_id,mode,created_at) VALUES($1,$2,$3::timestamptz)
        ON CONFLICT(sensor_id) DO UPDATE SET mode=excluded.mode,created_at=excluded.created_at`,
        [sensorId, mode, at],
      );
      const events: RealtimeEvent[] = [];
      await this.record(client, [{ sensor, value: generatedValue(sensor, 0, mode) }], at, events);
      const alerts = await client.query<{ id: string }>(
        "SELECT id FROM alerts WHERE sensor_id=$1 AND status='active'",
        [sensorId],
      );
      return { events, alert: (await this.repository.alert(alerts.rows[0]!.id, client))! };
    });
    this.publish(result.events);
    return result.alert;
  }
  async resolve(alertId: string): Promise<Alert> {
    const result = await transaction(this.db, async (client) => {
      const at = await this.lockedAt(client);
      const alert = await this.repository.alert(alertId, client);
      if (!alert) notFound('Incidencia', 'f');
      const events: RealtimeEvent[] = [];
      if (alert.status === 'resolved') return { alert, events };
      await client.query(
        "UPDATE alerts SET status='resolved',resolved_at=$2::timestamptz,resolved_by='operator' WHERE id=$1",
        [alertId, at],
      );
      if (alert.sensor_id) {
        await client.query('DELETE FROM simulation_overrides WHERE sensor_id=$1', [
          alert.sensor_id,
        ]);
        const sensor = (await this.repository.sensors(alert.asset_id, client)).find(
          (s) => s.id === alert.sensor_id,
        )!;
        await this.record(client, [{ sensor, value: sensor.baseline }], at, events);
      }
      await this.refreshStatuses(client, [alert.asset_id], at, events);
      const resolved = (await this.repository.alert(alertId, client))!;
      events.push({ type: 'alert:resolved', data: resolved });
      return { alert: resolved, events };
    });
    this.publish(result.events);
    return result.alert;
  }
  /**
   * «Reconocer»: an operator has seen the alert. Idempotent: an acknowledged or resolved alert is
   * returned as it is, without an event.
   */
  async acknowledge(alertId: string): Promise<Alert> {
    const result = await transaction(this.db, async (client) => {
      const at = await this.lockedAt(client);
      const alert = await this.repository.alert(alertId, client);
      if (!alert) notFound('Incidencia', 'f');
      const events: RealtimeEvent[] = [];
      if (alert.status === 'resolved' || alert.acknowledged_at) return { alert, events };
      await client.query('UPDATE alerts SET acknowledged_at=$2::timestamptz WHERE id=$1', [
        alertId,
        at,
      ]);
      const acknowledged = (await this.repository.alert(alertId, client))!;
      events.push({ type: 'alert:updated', data: acknowledged });
      return { alert: acknowledged, events };
    });
    this.publish(result.events);
    return result.alert;
  }
  async createManual(assetId: string, severity: 'warning' | 'critical', message: string) {
    const result = await transaction(this.db, async (client) => {
      const at = await this.lockedAt(client);
      if (!(await this.repository.asset(assetId, client))) notFound('Activo');
      const result = await client.query<{ id: string }>(
        "INSERT INTO alerts(asset_id,severity,message,source,triggered_at) VALUES($1,$2,$3,'manual',$4::timestamptz) RETURNING id",
        [assetId, severity, message, at],
      );
      const alert = (await this.repository.alert(result.rows[0]!.id, client))!;
      const events: RealtimeEvent[] = [{ type: 'alert:created', data: alert }];
      await this.refreshStatuses(client, [assetId], at, events);
      return { alert, events };
    });
    this.publish(result.events);
    return result.alert;
  }
  /**
   * Retention for the simulated history. Deletes per sensor through the
   * (sensor_id, recorded_at) index, in bounded batches, outside the telemetry lock.
   */
  async pruneReadings(retentionHours: number, batchPerSensor = 2000) {
    const result = await this.db.query(
      `DELETE FROM sensor_readings WHERE id IN (
        SELECT old.id FROM sensors s CROSS JOIN LATERAL (
          SELECT id FROM sensor_readings
          WHERE sensor_id=s.id AND recorded_at < now() - make_interval(hours => $1::int)
          ORDER BY recorded_at LIMIT $2
        ) old
      )`,
      [retentionHours, batchPerSensor],
    );
    return result.rowCount ?? 0;
  }
}
export function alertMessage(
  sensor: Pick<Sensor, 'metric_type' | 'unit' | 'warning_threshold' | 'critical_threshold'>,
  value: number,
  severity: 'warning' | 'critical',
) {
  const threshold = severity === 'critical' ? sensor.critical_threshold : sensor.warning_threshold;
  const level = severity === 'critical' ? 'crítico' : 'de advertencia';
  return `${metricLabel(sensor.metric_type)}: ${decimal(value)} ${sensor.unit} (umbral ${level} ${decimal(threshold)} ${sensor.unit}) · telemetría simulada`;
}
