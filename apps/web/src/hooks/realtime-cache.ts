import type { QueryClient } from '@tanstack/react-query';
import type { Asset, Reading, RealtimeEvent, Sensor } from '@geotwin/shared';
// Matches the history size the inspector requests (api.readings).
export const READINGS_WINDOW = 120;
type AssetWithDistance = Asset & { distance_m?: number };
/**
 * Applies realtime events to the TanStack Query cache.
 *
 * Readings, status changes and renames carry everything the views need, so they are
 * written straight into the cached data (no request). Alert events change counts and
 * lists the payload cannot patch safely, so they invalidate the alert and summary
 * queries and those refetch over REST. Reconnects still trigger a full resync.
 */
export function applyRealtimeEvents(client: QueryClient, events: RealtimeEvent[]) {
  let alertsChanged = false;
  for (const event of events) {
    switch (event.type) {
      case 'sensor:reading':
        applyReading(client, event.data);
        break;
      case 'asset:status_changed':
        patchAssets(client, event.data.asset_id, { status: event.data.status });
        break;
      case 'asset:updated':
        patchAssets(client, event.data.id, event.data);
        alertsChanged = true; // alert cards show the asset name
        break;
      case 'alert:created':
      case 'alert:resolved':
        alertsChanged = true;
        break;
      case 'sync:required':
        break;
    }
  }
  if (alertsChanged)
    for (const queryKey of [
      ['geo', 'alerts'],
      ['geo', 'incident'],
      ['geo', 'summary'],
    ])
      void client.invalidateQueries({ queryKey });
}
function applyReading(client: QueryClient, reading: Reading) {
  client.setQueriesData<Sensor[]>({ queryKey: ['geo', 'sensors'] }, (sensors) =>
    sensors?.some((s) => s.id === reading.sensor_id)
      ? sensors.map((s) =>
          s.id === reading.sensor_id
            ? { ...s, latest_value: reading.value, latest_at: reading.recorded_at }
            : s,
        )
      : sensors,
  );
  // Inspector history: ['geo', 'readings', assetId, sensorId].
  client.setQueriesData<Reading[]>(
    { queryKey: ['geo', 'readings', reading.asset_id, reading.sensor_id] },
    (history) => {
      if (!history) return history;
      const last = history.at(-1);
      if (last && last.recorded_at >= reading.recorded_at) return history;
      return [...history, reading].slice(-READINGS_WINDOW);
    },
  );
}
function patchAssets(client: QueryClient, id: string, patch: Partial<Asset>) {
  client.setQueriesData<AssetWithDistance[]>({ queryKey: ['geo', 'assets'] }, (list) =>
    patchList(list, id, patch),
  );
  client.setQueriesData<AssetWithDistance[]>({ queryKey: ['geo', 'nearby'] }, (list) =>
    patchList(list, id, patch),
  );
  client.setQueryData<Asset>(['geo', 'asset', id], (asset) =>
    asset ? { ...asset, ...patch } : asset,
  );
}
function patchList(list: AssetWithDistance[] | undefined, id: string, patch: Partial<Asset>) {
  return list?.some((a) => a.id === id)
    ? list.map((a) => (a.id === id ? { ...a, ...patch } : a))
    : list;
}
