import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { createPool } from '../src/db/pool.js';
import { migrate, seed } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { TelemetryService } from '../src/modules/telemetry-service.js';
import { generatedValue } from '../src/simulator/domain.js';
import type { Database } from '../src/db/pool.js';
import {
  assetSchema,
  alertSchema,
  summarySchema,
  sensorSchema,
  organizationSchema,
  realtimeEventSchema,
  type RealtimeEvent,
} from '@geotwin/shared';
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://geotwin:geotwin_local@localhost:55432/geotwin_test';
if (new URL(url).pathname !== '/geotwin_test')
  throw new Error('Refusing to run tests outside geotwin_test');
const db = createPool(url);
let app: FastifyInstance;
const assetId = '20000000-0000-4000-8000-000000000001';
const sensorId = '30000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  await migrate(db);
  app = await buildApp(db, { demo: true, simulator: false, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
});
beforeEach(async () => {
  await db.query('TRUNCATE organizations CASCADE');
  await db.query('UPDATE telemetry_state SET sequence=0');
  await seed(db);
});
afterAll(async () => {
  await app?.close();
  await db.end();
});
describe('Real API and PostgreSQL/PostGIS', () => {
  it('reports PostGIS health and serves OpenAPI with response/input schemas', async () => {
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json().postgis).toMatch(/^3\./);
    const docs = await app.inject('/api/openapi.json');
    expect(docs.json().paths['/api/assets/nearby'].get.parameters).toHaveLength(3);
    expect((await app.inject('/api/docs/')).statusCode).toBe(200);
  });
  it('returns seeded assets, installations and sensors through typed contracts', async () => {
    const assets = await app.inject('/api/assets');
    expect(assets.json()).toHaveLength(18);
    expect(assetSchema.safeParse(assets.json()[0]).success).toBe(true);
    expect((await app.inject('/api/installations')).json()).toHaveLength(3);
    expect((await app.inject('/api/sensors')).json()).toHaveLength(36);
    expect((await app.inject(`/api/assets/${assetId}/readings?limit=5`)).json()).toHaveLength(5);
  });
  it('validates parameters consistently and distinguishes missing resources', async () => {
    for (const path of [
      '/api/assets/not-a-uuid',
      '/api/assets/nearby?lat=91&lng=-4',
      '/api/assets/nearby?lat=41&lng=-4&radius=-1',
      `/api/assets/${assetId}/readings?limit=9999`,
    ]) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await app.inject('/api/assets/20000000-0000-4000-8000-000000009999')).statusCode).toBe(
      404,
    );
  });
  it('performs spatial proximity in meters and returns true distances', async () => {
    // Centre of the «Depósito elevado del cerro» installation: its six assets lie within 60 m.
    const centre = 'lat=41.584019&lng=-4.710608';
    const nearby = await app.inject(`/api/assets/nearby?${centre}&radius=100`);
    expect(nearby.json()).toHaveLength(6);
    for (const a of nearby.json()) {
      expect(a.distance_m).toBeGreaterThan(0);
      expect(a.distance_m).toBeLessThan(60);
    }
    expect((await app.inject(`/api/assets/nearby?${centre}&radius=5`)).json()).toHaveLength(0);
    const asset = assetSchema.parse((await app.inject(`/api/assets/${assetId}`)).json());
    expect(
      (
        await app.inject(
          `/api/assets/nearby?lat=${asset.location.lat}&lng=${asset.location.lng}&radius=1`,
        )
      ).json(),
    ).toHaveLength(1);
  });
  it('has GiST indexes on geometry and the geography expression used by ST_DWithin', async () => {
    const result = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename='assets'",
    );
    expect(result.rows.some((r) => r.indexdef.includes('USING gist (location)'))).toBe(true);
    expect(result.rows.some((r) => r.indexdef.includes('geography'))).toBe(true);
  });
  it('keeps a single btree on readings (sensor_id, recorded_at)', async () => {
    const result = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename='sensor_readings' AND indexdef LIKE '%(sensor_id, recorded_at%'",
    );
    expect(result.rows).toHaveLength(1);
  });
  it('treats hostile search input as data and LIKE wildcards as literal text', async () => {
    const response = await app.inject(
      `/api/assets?search=${encodeURIComponent("'; DROP TABLE assets; --")}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(0);
    expect((await app.inject('/api/assets')).json()).toHaveLength(18);
    for (const wildcard of ['%', '_', '\\'])
      expect(
        (await app.inject(`/api/assets?search=${encodeURIComponent(wildcard)}`)).json(),
      ).toHaveLength(0);
    expect((await app.inject('/api/assets?search=PASARELA')).json()).toHaveLength(4);
  });
  it('persists one deterministic reading per sensor and tick', async () => {
    const events: RealtimeEvent[] = [];
    const service = new TelemetryService(db, (e) => events.push(...e));
    await service.tick();
    expect(events.filter((e) => e.type === 'sensor:reading')).toHaveLength(36);
    const count = await db.query<{ count: string }>('SELECT count(*) FROM sensor_readings');
    expect(Number(count.rows[0]!.count)).toBe(2196);
  });
  it('publishes a tick only after COMMIT, so a subscriber already sees its rows', async () => {
    const seen: Promise<number>[] = [];
    const service = new TelemetryService(db, () => {
      // Runs synchronously inside publish, on another connection (READ COMMITTED):
      // it can only count the new readings if the transaction has already committed.
      seen.push(
        db
          .query<{ n: number }>('SELECT count(*)::int AS n FROM sensor_readings')
          .then((r) => r.rows[0]!.n),
      );
    });
    await service.tick();
    expect(seen).toHaveLength(1);
    expect(await seen[0]).toBe(2196);
  });
  it('publishes nothing and keeps the sequence when the tick rolls back', async () => {
    let published = 0;
    const service = new TelemetryService(db, () => published++);
    await db.query(`CREATE FUNCTION fail_reading() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN RAISE EXCEPTION 'forced failure'; END$$`);
    await db.query(`CREATE TRIGGER fail_reading BEFORE INSERT ON sensor_readings
      FOR EACH STATEMENT EXECUTE FUNCTION fail_reading()`);
    try {
      await expect(service.tick()).rejects.toThrow('forced failure');
    } finally {
      await db.query('DROP TRIGGER fail_reading ON sensor_readings');
      await db.query('DROP FUNCTION fail_reading()');
    }
    expect(published).toBe(0);
    expect((await db.query('SELECT sequence FROM telemetry_state')).rows[0].sequence).toBe('0');
    expect((await db.query('SELECT count(*)::int AS n FROM sensor_readings')).rows[0].n).toBe(2160);
  });
  it('runs a tick with a fixed number of statements, not one batch per sensor', async () => {
    let statements = 0;
    const counting = Object.create(db) as Database;
    counting.connect = (async () => {
      const client = await db.connect();
      const query = client.query;
      const release = client.release;
      client.query = ((...args: Parameters<typeof query>) => {
        statements++;
        return (query as (...a: unknown[]) => unknown).apply(client, args);
      }) as typeof query;
      client.release = (error?: Error | boolean) => {
        client.query = query;
        client.release = release;
        return release.call(client, error);
      };
      return client;
    }) as Database['connect'];
    await new TelemetryService(counting, () => {}).tick();
    // BEGIN, lock, sequence, overrides, sensors, readings, recoveries, statuses, COMMIT…
    expect(statements).toBeLessThanOrEqual(12);
  });
  it('stamps readings after the lock is acquired, not at transaction start', async () => {
    // Only rows written by this tick: ids above the seeded history.
    const lastId = (await db.query('SELECT max(id) AS id FROM sensor_readings')).rows[0].id;
    const holder = await db.connect();
    let releasedAt: string;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM telemetry_state FOR UPDATE');
      const tick = new TelemetryService(db, () => {}).tick();
      await new Promise((resolve) => setTimeout(resolve, 300));
      releasedAt = (await holder.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
      await holder.query('COMMIT');
      await tick;
    } finally {
      holder.release();
    }
    const earliest = await db.query<{ late: boolean; n: number }>(
      `SELECT min(recorded_at) > $1::timestamptz AS late, count(*)::int AS n
      FROM sensor_readings WHERE id > $2`,
      [releasedAt, lastId],
    );
    expect(earliest.rows[0]).toEqual({ late: true, n: 36 });
  });
  it('opens natural anomalies once per sensor and closes them when the reading recovers', async () => {
    const events: RealtimeEvent[] = [];
    const service = new TelemetryService(db, (e) => events.push(...e));
    // An injected anomaly on another asset must stay active through the recovery.
    const injected = await service.simulate('30000000-0000-4000-8000-000000000002', 'critical');
    await db.query('UPDATE telemetry_state SET sequence=235');
    events.length = 0;
    await service.tick(); // phase 236: eligible sensors read critical
    const opened = events.filter((e) => e.type === 'alert:created');
    expect(opened.length).toBeGreaterThan(0);
    const statusChanges = events.filter((e) => e.type === 'asset:status_changed');
    const assetIds = statusChanges.map((e) =>
      e.type === 'asset:status_changed' ? e.data.asset_id : '',
    );
    expect(new Set(assetIds).size).toBe(assetIds.length);
    await service.tick(); // phase 237: still critical, no duplicates
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM alerts WHERE status='active' AND source='telemetry'",
        )
      ).rows[0].n,
    ).toBe(opened.length + 1);
    await db.query('UPDATE telemetry_state SET sequence=239');
    events.length = 0;
    await service.tick(); // phase 0: readings are back in range
    const recovered = events.filter((e) => e.type === 'alert:resolved');
    expect(recovered).toHaveLength(opened.length);
    for (const e of recovered)
      if (e.type === 'alert:resolved') expect(e.data.resolved_by).toBe('auto_recovery');
    const active = await db.query<{ id: string }>("SELECT id FROM alerts WHERE status='active'");
    expect(active.rows.map((r) => r.id)).toEqual([injected.id]);
    const statuses = await db.query<{ status: string; n: number }>(
      'SELECT status, count(*)::int AS n FROM assets GROUP BY status ORDER BY status',
    );
    expect(statuses.rows).toEqual([
      { status: 'critical', n: 1 },
      { status: 'healthy', n: 17 },
    ]);
  });
  it('prunes readings older than the retention window and keeps recent ones', async () => {
    await db.query(
      `INSERT INTO sensor_readings(sensor_id,value,recorded_at)
      SELECT id, baseline, now() - interval '25 hours' FROM sensors`,
    );
    const service = new TelemetryService(db, () => {});
    expect(await service.pruneReadings(24)).toBe(36);
    expect((await db.query('SELECT count(*)::int AS n FROM sensor_readings')).rows[0].n).toBe(2160);
    expect(await service.pruneReadings(24)).toBe(0);
  });
  it('seeds history with the same per-sensor phase as the live generator', async () => {
    // 0x0010 = 16: a decimal parse (10) would give a different series.
    const sensor = sensorSchema.parse(
      (await app.inject('/api/sensors')).json().find((s: { id: string }) => s.id.endsWith('0010')),
    );
    const oldest = await db.query<{ value: number }>(
      'SELECT value FROM sensor_readings WHERE sensor_id=$1 ORDER BY recorded_at LIMIT 1',
      [sensor.id],
    );
    expect(oldest.rows[0]!.value).toBe(generatedValue(sensor, 0));
  });
  it('creates a failure, broadcasts it, deduplicates it, then resolves it durably', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No listening port');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws`);
    const events: RealtimeEvent[] = [];
    socket.on('message', (data) => {
      events.push(realtimeEventSchema.parse(JSON.parse(data.toString())));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/demo/anomalies',
        payload: { sensor_id: sensorId, mode: 'critical' },
      });
      expect(response.statusCode).toBe(201);
      const alert = alertSchema.parse(response.json());
      await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({
            method: 'POST',
            url: '/api/demo/anomalies',
            payload: { sensor_id: sensorId, mode: 'critical' },
          }),
        ),
      );
      const active = await db.query("SELECT * FROM alerts WHERE sensor_id=$1 AND status='active'", [
        sensorId,
      ]);
      expect(active.rowCount).toBe(1);
      expect(assetSchema.parse((await app.inject(`/api/assets/${assetId}`)).json()).status).toBe(
        'critical',
      );
      expect(
        summarySchema.parse((await app.inject('/api/dashboard/summary')).json()).active_alerts,
      ).toBe(1);
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('WS event missing')), 4000);
        const poll = setInterval(() => {
          if (
            events.some((e) => e.type === 'asset:status_changed' && e.data.status === 'critical')
          ) {
            clearInterval(poll);
            clearTimeout(deadline);
            resolve();
          }
        }, 20);
      });
      expect(events.some((e) => e.type === 'alert:created' && e.data.id === alert.id)).toBe(true);
      const resolved = await app.inject({
        method: 'PATCH',
        url: `/api/alerts/${alert.id}/resolve`,
      });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json().resolved_at).toBeTruthy();
      expect(assetSchema.parse((await app.inject(`/api/assets/${assetId}`)).json()).status).toBe(
        'healthy',
      );
      expect(
        summarySchema.parse((await app.inject('/api/dashboard/summary')).json()).active_alerts,
      ).toBe(0);
      expect((await db.query('SELECT * FROM simulation_overrides')).rowCount).toBe(0);
      const service = new TelemetryService(db, () => {});
      await service.tick();
      expect((await db.query("SELECT * FROM alerts WHERE status='active'")).rowCount).toBe(0);
      const repeated = await app.inject({
        method: 'PATCH',
        url: `/api/alerts/${alert.id}/resolve`,
      });
      expect(repeated.json().resolved_at).toBe(resolved.json().resolved_at);
    } finally {
      socket.close();
    }
  });
  it('escalates a warning without duplicating the anomaly', async () => {
    const warning = (
      await app.inject({
        method: 'POST',
        url: '/api/demo/anomalies',
        payload: { sensor_id: sensorId, mode: 'warning' },
      })
    ).json();
    const critical = (
      await app.inject({
        method: 'POST',
        url: '/api/demo/anomalies',
        payload: { sensor_id: sensorId, mode: 'critical' },
      })
    ).json();
    expect(critical.id).toBe(warning.id);
    expect(critical.severity).toBe('critical');
  });
  it('announces an escalation as alert:updated, not as a new alert', async () => {
    const events: RealtimeEvent[] = [];
    const service = new TelemetryService(db, (e) => events.push(...e));
    const warning = await service.simulate(sensorId, 'warning');
    expect(events.filter((e) => e.type === 'alert:created')).toHaveLength(1);
    events.length = 0;
    await service.simulate(sensorId, 'critical');
    const alertEvents = events.filter((e) => e.type.startsWith('alert:'));
    expect(alertEvents).toEqual([
      {
        type: 'alert:updated',
        data: expect.objectContaining({ id: warning.id, severity: 'critical' }),
      },
    ]);
  });
  it('keeps the asset critical until all its incidents are resolved', async () => {
    const a = (
      await app.inject({
        method: 'POST',
        url: '/api/alerts',
        payload: {
          asset_id: assetId,
          severity: 'critical',
          message: 'Inspección manual de prueba',
        },
      })
    ).json();
    const b = (
      await app.inject({
        method: 'POST',
        url: '/api/demo/anomalies',
        payload: { sensor_id: sensorId, mode: 'critical' },
      })
    ).json();
    await app.inject({ method: 'PATCH', url: `/api/alerts/${b.id}/resolve` });
    expect((await app.inject(`/api/assets/${assetId}`)).json().status).toBe('critical');
    await app.inject({ method: 'PATCH', url: `/api/alerts/${a.id}/resolve` });
    expect((await app.inject(`/api/assets/${assetId}`)).json().status).toBe('healthy');
  });
  it('rejects invalid incidents without writing and persists asset edits', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM alerts')).rows[0].n;
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: { asset_id: assetId, severity: 'critical', message: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: {
        asset_id: '20000000-0000-4000-8000-000000009999',
        severity: 'critical',
        message: 'Activo inexistente',
      },
    });
    expect(missing.statusCode).toBe(404);
    expect((await db.query('SELECT count(*)::int AS n FROM alerts')).rows[0].n).toBe(before);
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/assets/${assetId}`,
      payload: { name: 'Pump inspected' },
    });
    expect(renamed.json().name).toBe('Pump inspected');
    expect((await db.query('SELECT name FROM assets WHERE id=$1', [assetId])).rows[0].name).toBe(
      'Pump inspected',
    );
  });
  it('broadcasts a rename so other clients update without refetching', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No listening port');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws`);
    const events: RealtimeEvent[] = [];
    socket.on('message', (data) =>
      events.push(realtimeEventSchema.parse(JSON.parse(data.toString()))),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/assets/${assetId}`,
        payload: { name: 'Pump 01 · Revisada' },
      });
      await expect
        .poll(() => events.find((e) => e.type === 'asset:updated'), { timeout: 4000 })
        .toMatchObject({ data: { id: assetId, name: 'Pump 01 · Revisada' } });
    } finally {
      socket.close();
    }
  });
  it('words not-found messages with the right grammatical gender', async () => {
    const missing = '/api/alerts/00000000-0000-4000-8000-00000000ffff';
    expect((await app.inject(missing)).json().error.message).toBe('Incidencia no encontrada');
    expect(
      (await app.inject('/api/assets/20000000-0000-4000-8000-000000009999')).json().error.message,
    ).toBe('Activo no encontrado');
  });
  it('keeps 4xx status codes for client errors', async () => {
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: { asset_id: assetId, severity: 'warning', message: 'x'.repeat(20000) },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    const wrongType = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      headers: { 'content-type': 'application/xml' },
      payload: '<alert/>',
    });
    expect(wrongType.statusCode).toBe(415);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      headers: { 'content-type': 'application/json' },
      payload: '{"asset_id":',
    });
    expect(malformed.statusCode).toBe(400);
  });
  it("answers malformed HTTP with the API error envelope, not Node's own", async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No listening port');
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, '127.0.0.1', () =>
        socket.write('NOT HTTP AT ALL\r\n\r\n'),
      );
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    const body = JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4));
    expect(body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('sends baseline security headers, also on errors', async () => {
    for (const path of ['/api/health', '/api/assets/not-a-uuid', '/api/no-such-route']) {
      const response = await app.inject(path);
      expect(response.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-frame-options': 'DENY',
      });
    }
  });
  it('serves the organization and its place name from the database', async () => {
    const organization = organizationSchema.parse((await app.inject('/api/organization')).json());
    expect(organization.region).toBe('Laguna de Duero (Valladolid)');
  });
  it('returns the newest readings per asset in ascending time, per sensor when asked', async () => {
    const all = (await app.inject(`/api/assets/${assetId}/readings?limit=5`)).json();
    expect(all).toHaveLength(5);
    const times = all.map((r: { recorded_at: string }) => r.recorded_at);
    expect([...times].sort()).toEqual(times);
    const one = (
      await app.inject(`/api/assets/${assetId}/readings?limit=3&sensor_id=${sensorId}`)
    ).json();
    expect(one).toHaveLength(3);
    expect(new Set(one.map((r: { sensor_id: string }) => r.sensor_id))).toEqual(
      new Set([sensorId]),
    );
    const newest = await db.query<{ recorded_at: string }>(
      'SELECT max(recorded_at) AS recorded_at FROM sensor_readings WHERE sensor_id=$1',
      [sensorId],
    );
    expect(one.at(-1).recorded_at).toBe(newest.rows[0]!.recorded_at);
  });
  it('does not expose the anomaly endpoint outside demo mode', async () => {
    const secure = await buildApp(db, { demo: false, simulator: false, logger: false });
    try {
      const response = await secure.inject({
        method: 'POST',
        url: '/api/demo/anomalies',
        payload: { sensor_id: sensorId, mode: 'critical' },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await secure.close();
    }
  });
  it('seeds Laguna de Duero by default: assets on measured places, mounting heights, levels', async () => {
    const assets = z.array(assetSchema).parse((await app.inject('/api/assets')).json());
    expect(assets).toHaveLength(18);
    // Every asset inside the eight PNOA tiles loaded for the demo (X 355-358 km, Y 4603-4606 km).
    for (const a of assets) {
      expect(a.location.lng).toBeGreaterThan(-4.74);
      expect(a.location.lng).toBeLessThan(-4.7);
      expect(a.location.lat).toBeGreaterThan(41.56);
      expect(a.location.lat).toBeLessThan(41.6);
    }
    const byName = (name: string) => assets.find((a) => a.name === name)!;
    expect(byName('Pasarela LoRa · torre sur').mount_height_m).toBeCloseTo(41.9, 1);
    expect(byName('Depósito elevado').mount_height_m).toBeCloseTo(33.1, 1);
    expect(byName('Sonda de nivel · laguna').mount_height_m).toBe(0);
    const probe = byName('Sonda de nivel · laguna');
    expect(probe.type).toBe('level_probe');
    expect(byName('Depósito elevado').type).toBe('reservoir');
    const sensors = (await app.inject(`/api/sensors?asset_id=${probe.id}`)).json();
    expect(
      sensors.map((s: { metric_type: string; unit: string }) => [s.metric_type, s.unit]),
    ).toEqual([
      ['level', 'm'],
      ['temperature', '°C'],
    ]);
    // A simulated anomaly words its values with a decimal comma (2.1 × 1.12 = 2.352 m).
    const level = sensors.find((s: { metric_type: string }) => s.metric_type === 'level');
    await app.inject({
      method: 'POST',
      url: '/api/demo/anomalies',
      payload: { sensor_id: level.id, mode: 'critical' },
    });
    const [alert] = (await app.inject(`/api/alerts?asset_id=${probe.id}&status=active`)).json();
    expect(alert.message).toBe('Nivel: 2,35 m (umbral crítico 2,1 m) · telemetría simulada');
    await app.inject({ method: 'PATCH', url: `/api/alerts/${alert.id}/resolve` });
    // A database seeded before the level probe type: the migration retypes the lake probe.
    await db.query("UPDATE assets SET type='reservoir' WHERE id=$1", [probe.id]);
    await db.query(
      await readFile(
        new URL('../../../database/migrations/008_asset_type_level_probe.sql', import.meta.url),
        'utf8',
      ),
    );
    expect((await db.query('SELECT type FROM assets WHERE id=$1', [probe.id])).rows[0].type).toBe(
      'level_probe',
    );
    const installations = (await app.inject('/api/installations')).json();
    expect(installations.map((i: { name: string }) => i.name).sort()).toEqual([
      'Depósito elevado del cerro',
      'Laguna y zona deportiva',
      'Torrelago · torres residenciales',
    ]);
  });
  it('keeps the Valladolid scenario available as a second seed', async () => {
    await db.query('TRUNCATE organizations CASCADE');
    await seed(db, 'valladolid');
    const organization = organizationSchema.parse((await app.inject('/api/organization')).json());
    expect(organization.region).toBe('Valladolid, España');
    const assets = (await app.inject('/api/assets')).json();
    expect(assets).toHaveLength(18);
    expect(assets.every((a: { mount_height_m: number }) => a.mount_height_m === 0)).toBe(true);
    expect((await app.inject('/api/sensors')).json()).toHaveLength(36);
    await expect(seed(db, 'atlantis')).rejects.toThrow(/Unknown seed/);
  });
  it('reruns seeds without replacing readings or active incidents', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/demo/anomalies',
      payload: { sensor_id: sensorId, mode: 'critical' },
    });
    await seed(db);
    expect((await app.inject('/api/assets')).json()).toHaveLength(18);
    expect((await db.query("SELECT * FROM alerts WHERE status='active'")).rowCount).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM sensor_readings')).rows[0].n).toBe(2161);
  });
});
