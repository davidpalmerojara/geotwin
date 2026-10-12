import type { Sensor, AssetStatus } from '@geotwin/shared';
export function evaluate(
  value: number,
  sensor: Pick<Sensor, 'warning_threshold' | 'critical_threshold'>,
): AssetStatus {
  if (value >= sensor.critical_threshold) return 'critical';
  if (value >= sensor.warning_threshold) return 'warning';
  return 'healthy';
}
export function generatedValue(
  sensor: Sensor,
  sequence: number,
  override?: 'warning' | 'critical',
): number {
  const salt = Number.parseInt(sensor.id.slice(-4), 16);
  const phase = sequence % 240;
  const mode =
    override ??
    (salt % 3 === 0 && phase >= 236
      ? 'critical'
      : salt % 3 === 0 && phase >= 230
        ? 'warning'
        : undefined);
  const value =
    mode === 'critical'
      ? sensor.critical_threshold * 1.12
      : mode === 'warning'
        ? (sensor.warning_threshold + sensor.critical_threshold) / 2
        : sensor.baseline * (1 + 0.12 * Math.sin(sequence * 0.37 + salt));
  return Math.round(value * 100) / 100;
}
const metricLabels: Record<Sensor['metric_type'], string> = {
  temperature: 'Temperatura',
  vibration: 'Vibración',
  pressure: 'Presión',
};
export const metricLabel = (metric: Sensor['metric_type']) => metricLabels[metric];
