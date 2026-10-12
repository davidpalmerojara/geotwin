import { describe, it, expect } from 'vitest';
import { evaluate, generatedValue } from '../src/simulator/domain.js';
import { nearbyQuery, realtimeEventSchema, type Sensor } from '@geotwin/shared';
const sensor: Sensor = {
  id: '30000000-0000-4000-8000-000000000001',
  asset_id: '20000000-0000-4000-8000-000000000001',
  metric_type: 'temperature',
  unit: '°C',
  baseline: 42,
  warning_threshold: 70,
  critical_threshold: 85,
  latest_value: null,
  latest_at: null,
};
describe('Telemetry domain', () => {
  it('treats the exact threshold as an anomaly', () => {
    expect(evaluate(69.99, sensor)).toBe('healthy');
    expect(evaluate(70, sensor)).toBe('warning');
    expect(evaluate(85, sensor)).toBe('critical');
  });
  it('generates reproducible healthy values and explicit failures', () => {
    expect(generatedValue(sensor, 17)).toBe(generatedValue(sensor, 17));
    expect(evaluate(generatedValue(sensor, 17), sensor)).toBe('healthy');
    expect(evaluate(generatedValue(sensor, 17, 'warning'), sensor)).toBe('warning');
    expect(evaluate(generatedValue(sensor, 17, 'critical'), sensor)).toBe('critical');
  });
  it('simulates a periodic natural anomaly for eligible sensors', () => {
    const eligible = { ...sensor, id: '30000000-0000-4000-8000-000000000003' };
    expect(evaluate(generatedValue(eligible, 232), eligible)).toBe('warning');
    expect(evaluate(generatedValue(eligible, 239), eligible)).toBe('critical');
  });
});
it('supports sensor UUIDs containing hexadecimal letters', () => {
  const value = generatedValue({ ...sensor, id: '30000000-0000-4000-8000-00000000a81d' }, 17);
  expect(Number.isFinite(value)).toBe(true);
  expect(evaluate(value, sensor)).toBe('healthy');
});
describe('Shared contracts', () => {
  it('rejects coordinates, excessive radius and invalid WS messages', () => {
    expect(nearbyQuery.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(nearbyQuery.safeParse({ lat: 41, lng: -4, radius: 50001 }).success).toBe(false);
    expect(nearbyQuery.parse({ lat: '41.65', lng: '-4.7' }).radius).toBe(500);
    expect(
      realtimeEventSchema.safeParse({
        type: 'asset:status_changed',
        data: { asset_id: sensor.asset_id, status: 'fake' },
      }).success,
    ).toBe(false);
  });
});
