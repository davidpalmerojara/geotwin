import type { Alert, AssetStatus, RealtimeEvent, Sensor } from '@geotwin/shared';
import { transaction, type Database, type Transaction } from '../db/pool.js';
import { Repository } from './repository.js';
import { evaluate, generatedValue } from '../simulator/domain.js';
import { notFound } from './errors.js';
export class TelemetryService {
  private repository: Repository;
  constructor(
    private db: Database,
    private publish: (events: RealtimeEvent[]) => void,
  ) {
    this.repository = new Repository(db);
  }
  // One row lock serializes tick, overrides, manual incidents and resolution across processes.
  private async lock(client: Transaction) {
    await client.query('SELECT sequence FROM telemetry_state WHERE singleton=true FOR UPDATE');
  }
  private async refreshStatus(client: Transaction, assetId: string, events: RealtimeEvent[]) {
    const previous = await this.repository.asset(assetId, client);
    if (!previous) notFound('Activo');
    const result = await client.query<{ status: AssetStatus }>(
      `SELECT CASE
      WHEN bool_or(severity='critical') THEN 'critical' WHEN bool_or(severity='warning') THEN 'warning' ELSE 'healthy' END AS status
      FROM alerts WHERE asset_id=$1 AND status='active'`,
      [assetId],
    );
    const status = result.rows[0]!.status;
    if (previous.status !== status) {
      await client.query('UPDATE assets SET status=$1,updated_at=now() WHERE id=$2', [
        status,
        assetId,
      ]);
      events.push({ type: 'asset:status_changed', data: { asset_id: assetId, status } });
    }
  }
  private async record(
    client: Transaction,
    sensor: Sensor,
    value: number,
    events: RealtimeEvent[],
  ) {
    const result = await client.query<{ recorded_at: string }>(
      `INSERT INTO sensor_readings(sensor_id,value) VALUES($1,$2) RETURNING recorded_at`,
      [sensor.id, value],
    );
    events.push({
      type: 'sensor:reading',
      data: {
        sensor_id: sensor.id,
        asset_id: sensor.asset_id,
        metric_type: sensor.metric_type,
        unit: sensor.unit,
        value,
        recorded_at: result.rows[0]!.recorded_at,
        simulated: true,
      },
    });
    const severity = evaluate(value, sensor);
    if (severity !== 'healthy') {
      const message = `${sensor.metric_type}: ${value} ${sensor.unit} — umbral ${severity === 'critical' ? sensor.critical_threshold : sensor.warning_threshold} ${sensor.unit} (telemetría simulada)`;
      const result = await client.query<{ id: string }>(
        `INSERT INTO alerts(asset_id,sensor_id,severity,message,source)
        VALUES($1,$2,$3,$4,'telemetry') ON CONFLICT(sensor_id) WHERE status='active' AND sensor_id IS NOT NULL DO NOTHING RETURNING id`,
        [sensor.asset_id, sensor.id, severity, message],
      );
      if (result.rows[0])
        events.push({
          type: 'alert:created',
          data: (await this.repository.alert(result.rows[0].id, client))!,
        });
      else if (severity === 'critical') {
        const updated = await client.query<{ id: string }>(
          `UPDATE alerts SET severity='critical',message=$1
          WHERE sensor_id=$2 AND status='active' AND severity='warning' RETURNING id`,
          [message, sensor.id],
        );
        if (updated.rows[0])
          events.push({
            type: 'alert:created',
            data: (await this.repository.alert(updated.rows[0].id, client))!,
          });
      }
    }
    await this.refreshStatus(client, sensor.asset_id, events);
  }
  async tick() {
    const events = await transaction(this.db, async (client) => {
      await this.lock(client);
      const sequence = (
        await client.query<{ sequence: string }>(
          'UPDATE telemetry_state SET sequence=sequence+1 RETURNING sequence',
        )
      ).rows[0]!.sequence;
      const overrides = (
        await client.query<{ sensor_id: string; mode: 'warning' | 'critical' }>(
          'SELECT sensor_id,mode FROM simulation_overrides',
        )
      ).rows;
      const modes = new Map(overrides.map((o) => [o.sensor_id, o.mode]));
      const sensors = await this.repository.sensors(undefined, client);
      const events: RealtimeEvent[] = [];
      for (const sensor of sensors)
        await this.record(
          client,
          sensor,
          generatedValue(sensor, Number(sequence), modes.get(sensor.id)),
          events,
        );
      return events;
    });
    this.publish(events);
  }
  async simulate(sensorId: string, mode: 'warning' | 'critical') {
    const result = await transaction(this.db, async (client) => {
      await this.lock(client);
      const sensor = (await this.repository.sensors(undefined, client)).find(
        (s) => s.id === sensorId,
      );
      if (!sensor) notFound('Sensor');
      await client.query(
        `INSERT INTO simulation_overrides(sensor_id,mode) VALUES($1,$2)
        ON CONFLICT(sensor_id) DO UPDATE SET mode=excluded.mode,created_at=now()`,
        [sensorId, mode],
      );
      const events: RealtimeEvent[] = [];
      await this.record(client, sensor, generatedValue(sensor, 0, mode), events);
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
      await this.lock(client);
      const alert = await this.repository.alert(alertId, client);
      if (!alert) notFound('Incidencia');
      const events: RealtimeEvent[] = [];
      if (alert.status === 'resolved') return { alert, events };
      await client.query("UPDATE alerts SET status='resolved',resolved_at=now() WHERE id=$1", [
        alertId,
      ]);
      if (alert.sensor_id) {
        await client.query('DELETE FROM simulation_overrides WHERE sensor_id=$1', [
          alert.sensor_id,
        ]);
        const sensor = (await this.repository.sensors(alert.asset_id, client)).find(
          (s) => s.id === alert.sensor_id,
        )!;
        await this.record(client, sensor, sensor.baseline, events);
      }
      await this.refreshStatus(client, alert.asset_id, events);
      const resolved = (await this.repository.alert(alertId, client))!;
      events.push({ type: 'alert:resolved', data: resolved });
      return { alert: resolved, events };
    });
    this.publish(result.events);
    return result.alert;
  }
  async createManual(assetId: string, severity: 'warning' | 'critical', message: string) {
    const result = await transaction(this.db, async (client) => {
      await this.lock(client);
      if (!(await this.repository.asset(assetId, client))) notFound('Activo');
      const result = await client.query<{ id: string }>(
        "INSERT INTO alerts(asset_id,severity,message,source) VALUES($1,$2,$3,'manual') RETURNING id",
        [assetId, severity, message],
      );
      const alert = (await this.repository.alert(result.rows[0]!.id, client))!;
      const events: RealtimeEvent[] = [{ type: 'alert:created', data: alert }];
      await this.refreshStatus(client, assetId, events);
      return { alert, events };
    });
    this.publish(result.events);
    return result.alert;
  }
}
