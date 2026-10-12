import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createPool } from '../src/db/pool.js';
import { migrate, seed } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { TelemetryService } from '../src/modules/telemetry-service.js';
import {
  assetSchema,
  alertSchema,
  summarySchema,
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
    const nearby = await app.inject('/api/assets/nearby?lat=41.655&lng=-4.737&radius=500');
    expect(nearby.json()).toHaveLength(6);
    for (const a of nearby.json()) {
      expect(a.distance_m).toBeGreaterThan(0);
      expect(a.distance_m).toBeLessThan(500);
    }
    expect(
      (await app.inject('/api/assets/nearby?lat=41.655&lng=-4.737&radius=50')).json(),
    ).toHaveLength(0);
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
    expect((await app.inject('/api/assets?search=pump')).json()).toHaveLength(3);
  });
  it('persists deterministic ticks and emits only after commit', async () => {
    const events: RealtimeEvent[] = [];
    const service = new TelemetryService(db, (e) => events.push(...e));
    await service.tick();
    expect(events.filter((e) => e.type === 'sensor:reading')).toHaveLength(36);
    const count = await db.query<{ count: string }>('SELECT count(*) FROM sensor_readings');
    expect(Number(count.rows[0]!.count)).toBe(2196);
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
  it('rolls back malformed incident creation and persists asset edits', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/alerts',
          payload: { asset_id: assetId, severity: 'critical', message: 'x' },
        })
      ).statusCode,
    ).toBe(400);
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
