import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Alert, Asset, Layer, Reading, Sensor } from '@geotwin/shared';
import { applyRealtimeEvents, LAYERS_KEY, READINGS_WINDOW } from './realtime-cache';
const assetId = '20000000-0000-4000-8000-000000000001';
const sensorId = '30000000-0000-4000-8000-000000000001';
const asset: Asset = {
  id: assetId,
  organization_id: '00000000-0000-4000-8000-000000000001',
  installation_id: '10000000-0000-4000-8000-000000000001',
  name: 'Pump 01',
  type: 'pump',
  status: 'healthy',
  location: { lat: 41.65, lng: -4.73 },
  created_at: '2026-10-12T08:00:00.000Z',
  updated_at: '2026-10-12T08:00:00.000Z',
};
const sensor: Sensor = {
  id: sensorId,
  asset_id: assetId,
  metric_type: 'temperature',
  unit: '°C',
  warning_threshold: 70,
  critical_threshold: 85,
  baseline: 42,
  latest_value: 41,
  latest_at: '2026-10-12T08:00:00.000Z',
};
const reading = (value: number, recorded_at: string): Reading => ({
  sensor_id: sensorId,
  asset_id: assetId,
  metric_type: 'temperature',
  unit: '°C',
  value,
  recorded_at,
  simulated: true,
});
function setup() {
  const client = new QueryClient();
  client.setQueryData(['geo', 'assets', ''], [asset]);
  client.setQueryData(['geo', 'asset', assetId], asset);
  client.setQueryData(['geo', 'sensors', assetId], [sensor]);
  client.setQueryData(
    ['geo', 'readings', assetId, sensorId],
    [reading(41, '2026-10-12T08:00:00.000Z')],
  );
  client.setQueryData(['geo', 'summary', ''], { active_alerts: 0 });
  client.setQueryData(['geo', 'alerts', '', undefined, 'active'], []);
  return client;
}
const invalidated = (client: QueryClient, key: unknown[]) =>
  client.getQueryCache().find({ queryKey: key, exact: true })!.state.isInvalidated;
describe('Realtime cache updates', () => {
  it('writes a reading into the sensor and its history without invalidating anything', () => {
    const client = setup();
    applyRealtimeEvents(client, [
      { type: 'sensor:reading', data: reading(43.5, '2026-10-12T08:00:05.000Z') },
    ]);
    expect(client.getQueryData<Sensor[]>(['geo', 'sensors', assetId])![0]).toMatchObject({
      latest_value: 43.5,
      latest_at: '2026-10-12T08:00:05.000Z',
    });
    expect(client.getQueryData<Reading[]>(['geo', 'readings', assetId, sensorId])).toHaveLength(2);
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((q) => q.state.isInvalidated),
    ).toBe(false);
  });
  it('ignores a duplicate or older reading and keeps the history window bounded', () => {
    const client = setup();
    const old = reading(40, '2026-10-12T07:59:55.000Z');
    applyRealtimeEvents(client, [{ type: 'sensor:reading', data: old }]);
    expect(client.getQueryData<Reading[]>(['geo', 'readings', assetId, sensorId])).toHaveLength(1);
    const many = Array.from({ length: READINGS_WINDOW + 10 }, (_, i) => ({
      type: 'sensor:reading' as const,
      data: reading(42, new Date(Date.UTC(2026, 9, 12, 9, 0, i)).toISOString()),
    }));
    applyRealtimeEvents(client, many);
    expect(client.getQueryData<Reading[]>(['geo', 'readings', assetId, sensorId])).toHaveLength(
      READINGS_WINDOW,
    );
  });
  it('patches asset status in lists and in the detail', () => {
    const client = setup();
    applyRealtimeEvents(client, [
      { type: 'asset:status_changed', data: { asset_id: assetId, status: 'critical' } },
    ]);
    expect(client.getQueryData<Asset[]>(['geo', 'assets', ''])![0]!.status).toBe('critical');
    expect(client.getQueryData<Asset>(['geo', 'asset', assetId])!.status).toBe('critical');
    expect(invalidated(client, ['geo', 'assets', ''])).toBe(false);
  });
  it('applies a rename from another client', () => {
    const client = setup();
    applyRealtimeEvents(client, [
      { type: 'asset:updated', data: { ...asset, name: 'Pump 01 · Revisada' } },
    ]);
    expect(client.getQueryData<Asset[]>(['geo', 'assets', ''])![0]!.name).toBe(
      'Pump 01 · Revisada',
    );
    expect(client.getQueryData<Asset>(['geo', 'asset', assetId])!.name).toBe('Pump 01 · Revisada');
  });
  it('invalidates only alert and summary queries on alert events', () => {
    const alert: Alert = {
      id: '40000000-0000-4000-8000-000000000001',
      asset_id: assetId,
      sensor_id: sensorId,
      severity: 'critical',
      message: 'Temperatura: 95.2 °C',
      status: 'active',
      source: 'telemetry',
      triggered_at: '2026-10-12T08:00:05.000Z',
      resolved_at: null,
      resolved_by: null,
      asset_name: 'Pump 01',
    };
    for (const type of ['alert:created', 'alert:updated', 'alert:resolved'] as const) {
      const client = setup();
      applyRealtimeEvents(client, [{ type, data: alert }]);
      expect(invalidated(client, ['geo', 'summary', ''])).toBe(true);
      expect(invalidated(client, ['geo', 'alerts', '', undefined, 'active'])).toBe(true);
      expect(invalidated(client, ['geo', 'assets', ''])).toBe(false);
      expect(invalidated(client, ['geo', 'sensors', assetId])).toBe(false);
    }
  });
});
describe('LiDAR layer events', () => {
  const layer: Layer = {
    id: '50000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000001',
    name: 'Nube sintética',
    kind: 'pointcloud',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    error: null,
    source: { filename: 'nube.laz', format: 'laz', size_bytes: 56000, sha256: 'a'.repeat(64) },
    crs_in: 'EPSG:25830',
    vertical: { datum: 'orthometric', override_m: null, geoid_offset_m: null, method: null },
    point_count: null,
    point_format: null,
    bbox: null,
    center: null,
    height_range_m: null,
    tileset_url: null,
    attribution: null,
    created_at: '2026-10-13T08:00:00.000Z',
    updated_at: '2026-10-13T08:00:00.000Z',
  };
  const list = (client: QueryClient) => client.getQueryData<Layer[]>(LAYERS_KEY);
  it('adds a layer created elsewhere once and patches its progress without a request', () => {
    const client = new QueryClient();
    client.setQueryData(LAYERS_KEY, []);
    applyRealtimeEvents(client, [
      { type: 'layer:created', data: layer },
      { type: 'layer:created', data: layer },
      {
        type: 'layer:progress',
        data: { id: layer.id, status: 'processing', stage: 'tiling', progress: 42 },
      },
    ]);
    expect(list(client)).toHaveLength(1);
    expect(list(client)![0]).toMatchObject({ status: 'processing', stage: 'tiling', progress: 42 });
    expect(invalidated(client, [...LAYERS_KEY])).toBe(false);
  });
  it('replaces the row on ready, keeps the newest row and removes deleted layers', () => {
    const client = new QueryClient();
    client.setQueryData(LAYERS_KEY, [layer]);
    const ready: Layer = {
      ...layer,
      status: 'ready',
      stage: 'done',
      progress: 100,
      tileset_url: `/api/layers/${layer.id}/tiles/job/tileset.json`,
      updated_at: '2026-10-13T08:00:09.000Z',
    };
    applyRealtimeEvents(client, [{ type: 'layer:ready', data: ready }]);
    expect(list(client)![0]!.tileset_url).toBe(ready.tileset_url);
    // An older row arriving late does not undo the newer one.
    applyRealtimeEvents(client, [{ type: 'layer:failed', data: { ...layer, status: 'failed' } }]);
    expect(list(client)![0]!.status).toBe('ready');
    // A reprocess sends the ready layer back to the queue.
    applyRealtimeEvents(client, [
      {
        type: 'layer:progress',
        data: { id: layer.id, status: 'queued', stage: 'queued', progress: 0 },
      },
    ]);
    expect(list(client)![0]!.status).toBe('queued');
    applyRealtimeEvents(client, [{ type: 'layer:deleted', data: { id: layer.id } }]);
    expect(list(client)).toEqual([]);
  });
  it('leaves an unloaded layer list alone (it loads fresh when first needed)', () => {
    const client = new QueryClient();
    applyRealtimeEvents(client, [{ type: 'layer:created', data: layer }]);
    expect(list(client)).toBeUndefined();
  });
});
