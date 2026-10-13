import type { QueryClient } from '@tanstack/react-query';
import type { Asset, Layer, Reading, RealtimeEvent, Sensor } from '@geotwin/shared';
// The LiDAR layer list (api.layers): kept current by layer:* events alone, never polled.
export const LAYERS_KEY = ['geo', 'layers'] as const;
// Matches the history size the inspector requests (api.readings).
export const READINGS_WINDOW = 120;
type AssetWithDistance = Asset & { distance_m?: number };
/**
 * Applies realtime events to the TanStack Query cache.
 *
 * Readings, status changes and renames carry everything the views need, so they are
 * written straight into the cached data (no request). Alert events change counts and
 * lists the payload cannot patch safely, so they invalidate the alert and summary
 * queries and those refetch over REST. Layer events carry the whole layer (or its progress), so
 * the layer list is patched in place too. Reconnects still trigger a full resync.
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
      case 'alert:updated':
      case 'alert:resolved':
        alertsChanged = true;
        break;
      case 'layer:created':
      case 'layer:ready':
      case 'layer:failed':
        upsertLayer(client, event.data);
        break;
      case 'layer:progress':
        client.setQueryData<Layer[]>(LAYERS_KEY, (list) =>
          // Also a reprocess: a ready layer goes back to queued (the worker never reports progress
          // after ready, and one API relays NOTIFYs in order).
          list?.map((layer) => (layer.id === event.data.id ? { ...layer, ...event.data } : layer)),
        );
        break;
      case 'layer:deleted':
        client.setQueryData<Layer[]>(LAYERS_KEY, (list) =>
          list?.filter((layer) => layer.id !== event.data.id),
        );
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
function upsertLayer(client: QueryClient, layer: Layer) {
  client.setQueryData<Layer[]>(LAYERS_KEY, (list) => {
    if (!list) return list;
    const current = list.find((l) => l.id === layer.id);
    if (!current) return [layer, ...list];
    // Events can overtake each other between processes: keep the newest row.
    if (current.updated_at > layer.updated_at) return list;
    return list.map((l) => (l.id === layer.id ? layer : l));
  });
}
