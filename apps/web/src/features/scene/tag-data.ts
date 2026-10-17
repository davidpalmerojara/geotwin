/**
 * What each asset's tag in the scene says: its state and the latest value of its worst sensor,
 * from the realtime cache (sensor:reading events patch the sensor list in place), and whether an
 * active alert still waits to be acknowledged. No Cesium here: the hidden list of the scene's
 * assets reads the same text.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Alert, Asset, AssetStatus, Sensor } from '@geotwin/shared';
import { api } from '../../lib/api';
import { useNetworkAlerts } from '../../hooks/data';
import { metricLabel, number } from '../../lib/format';

/** A sensor's state from its latest value and thresholds. */
export const sensorLevel = (s: Sensor): AssetStatus =>
  s.latest_value === null
    ? 'healthy'
    : s.latest_value >= s.critical_threshold
      ? 'critical'
      : s.latest_value >= s.warning_threshold
        ? 'warning'
        : 'healthy';
const severity: Record<AssetStatus, number> = { healthy: 0, warning: 1, critical: 2 };

/** The sensor in the worst state; the first one when none is worse than the others. */
export function worstSensor(sensors: Sensor[]) {
  let worst: Sensor | undefined;
  for (const s of sensors)
    if (!worst || severity[sensorLevel(s)] > severity[sensorLevel(worst)]) worst = s;
  return worst;
}

/** A reading as the card shows it: two decimals under 10, one above, decimal comma. */
export function readingText(value: number | null, unit: string) {
  if (value === null) return '—';
  return `${number(value, Math.abs(value) < 10 ? 2 : 1)} ${unit}`;
}

export const STATUS_WORD: Record<AssetStatus, string> = {
  healthy: 'operativo',
  warning: 'advertencia',
  critical: 'crítico',
};

export interface TagInfo {
  id: string;
  name: string;
  status: AssetStatus;
  /** «41,20 °C», or «—» with no reading. */
  value: string;
  /** «Temperatura», the metric of the value shown. */
  metric: string;
  /** What a screen reader hears; always ends in «simulado». */
  label: string;
  /** The asset has an active alert (a beam in the scene). */
  alert: boolean;
  /** An active alert not acknowledged yet (its pulse runs). */
  pulse: boolean;
}

/** The tags of these assets from the network's sensors and active alerts. */
export function tagInfos(assets: Asset[], sensors: Sensor[], alerts: Alert[]): TagInfo[] {
  const byAsset = new Map<string, Sensor[]>();
  for (const s of sensors) byAsset.set(s.asset_id, [...(byAsset.get(s.asset_id) ?? []), s]);
  const active = alerts.filter((a) => a.status === 'active');
  return assets.map((asset) => {
    const worst = worstSensor(byAsset.get(asset.id) ?? []);
    const value = worst ? readingText(worst.latest_value, worst.unit) : '—';
    const metric = worst ? metricLabel(worst.metric_type) : '';
    const mine = active.filter((a) => a.asset_id === asset.id);
    return {
      id: asset.id,
      name: asset.name,
      status: asset.status,
      value,
      metric,
      label: `${asset.name}, ${STATUS_WORD[asset.status]}${
        worst ? `, ${metric.toLowerCase()} ${value}` : ''
      }, simulado`,
      alert: asset.status !== 'healthy' && mine.length > 0,
      pulse: asset.status !== 'healthy' && mine.some((a) => !a.acknowledged_at),
    };
  });
}

/** Every sensor of the network, kept current by the realtime cache. */
export const useNetworkSensors = () =>
  useQuery({ queryKey: ['geo', 'sensors', 'network'], queryFn: () => api.sensors() });

export function useTagInfos(assets: Asset[] | undefined) {
  const sensors = useNetworkSensors().data,
    alerts = useNetworkAlerts('active').data;
  return useMemo(
    () => tagInfos(assets ?? [], sensors ?? [], alerts ?? []),
    [assets, sensors, alerts],
  );
}
