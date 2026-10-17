import { describe, expect, it } from 'vitest';
import type { Alert, Asset, Sensor } from '@geotwin/shared';
import { readingText, tagInfos, worstSensor } from './tag-data';

const sensor = (id: string, value: number | null, metric = 'temperature', unit = '°C'): Sensor =>
  ({
    id,
    asset_id: 'a1',
    metric_type: metric,
    unit,
    baseline: 40,
    warning_threshold: 70,
    critical_threshold: 85,
    latest_value: value,
    latest_at: value === null ? null : '2026-10-17T10:00:00.000Z',
  }) as Sensor;
const asset = (status: Asset['status']): Asset =>
  ({ id: 'a1', name: 'Pasarela LoRa · torre sur', status }) as Asset;
const alert = (acknowledged: string | null): Alert =>
  ({
    id: 'x',
    asset_id: 'a1',
    status: 'active',
    severity: 'critical',
    acknowledged_at: acknowledged,
  }) as Alert;

describe('tag values', () => {
  it('takes the sensor in the worst state, or the first one', () => {
    expect(worstSensor([sensor('t', 41), sensor('v', 2.3, 'vibration', 'mm/s')])?.id).toBe('t');
    expect(worstSensor([sensor('t', 41), { ...sensor('v', 7), warning_threshold: 6 }])?.id).toBe(
      'v',
    );
    expect(worstSensor([sensor('t', 72), sensor('u', 86)])?.id).toBe('u');
    expect(worstSensor([])).toBeUndefined();
  });
  it('writes readings with a decimal comma, as the card does', () => {
    expect(readingText(41.234, '°C')).toBe('41,2 °C');
    expect(readingText(2.345, 'm')).toBe('2,35 m');
    expect(readingText(4.3, 'bar')).toBe('4,30 bar');
    expect(readingText(1234.5, 'l')).toBe('1234,5 l');
    expect(readingText(null, '°C')).toBe('—');
  });
  it('labels every tag for screen readers, ending in «simulado»', () => {
    const [info] = tagInfos([asset('critical')], [sensor('t', 86.4)], [alert(null)]);
    expect(info).toMatchObject({ value: '86,4 °C', status: 'critical', alert: true, pulse: true });
    expect(info!.label).toBe('Pasarela LoRa · torre sur, crítico, temperatura 86,4 °C, simulado');
    const [quiet] = tagInfos([asset('healthy')], [], []);
    expect(quiet!.label).toBe('Pasarela LoRa · torre sur, operativo, simulado');
    expect(quiet!.value).toBe('—');
  });
  it('keeps the beam of an acknowledged alert and stops its pulse', () => {
    const [info] = tagInfos(
      [asset('critical')],
      [sensor('t', 86.4)],
      [alert('2026-10-17T10:01:00.000Z')],
    );
    expect(info).toMatchObject({ alert: true, pulse: false });
    const [resolved] = tagInfos([asset('healthy')], [sensor('t', 40)], []);
    expect(resolved).toMatchObject({ alert: false, pulse: false });
  });
});
