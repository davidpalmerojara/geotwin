import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useUI } from '../stores/ui';
import { LAYERS_KEY } from './realtime-cache';
export const useAssets = () => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'assets', id],
    queryFn: () => api.assets(id),
    // Changing installation keeps the previous list until the new one arrives, so the
    // 3D viewer (and its WebGL context, layers and camera) is never unmounted.
    placeholderData: keepPreviousData,
  });
};
export const useInstallations = () =>
  useQuery({ queryKey: ['geo', 'installations'], queryFn: api.installations, staleTime: 60000 });
export const useOrganization = () =>
  useQuery({ queryKey: ['geo', 'organization'], queryFn: api.organization, staleTime: 300000 });
export const useSummary = () => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'summary', id],
    queryFn: () => api.summary(id),
    placeholderData: keepPreviousData,
  });
};
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30000 });
export const useAlerts = (asset_id?: string, status?: string) => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'alerts', id, asset_id, status],
    queryFn: () => api.alerts({ installation_id: id, asset_id, status }),
    placeholderData: keepPreviousData,
  });
};
/** Alerts across the whole network, whatever installation is chosen (the annunciator's). */
export const useNetworkAlerts = (status?: string) =>
  useQuery({
    queryKey: ['geo', 'alerts', 'network', status],
    queryFn: () => api.alerts({ status }),
    placeholderData: keepPreviousData,
  });
export function useSync() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['geo'] });
}
// No polling: layer:* WebSocket events keep the list current (see realtime-cache.ts).
export const useLayers = () =>
  useQuery({ queryKey: [...LAYERS_KEY], queryFn: api.layers, staleTime: Infinity });
export const useLayerLimits = () =>
  useQuery({ queryKey: ['layer-limits'], queryFn: api.layerLimits, staleTime: Infinity });
