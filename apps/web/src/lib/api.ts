import { z } from 'zod';
import {
  assetSchema,
  installationSchema,
  sensorSchema,
  readingSchema,
  alertSchema,
  summarySchema,
  healthSchema,
} from '@geotwin/shared';
export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return params.size ? `?${params}` : '';
}
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const result = z.object({ error: z.object({ message: z.string() }) }).safeParse(data);
    throw new Error(result.success ? result.data.error.message : `Error HTTP ${response.status}`);
  }
  return schema.parse(data);
}
export const api = {
  health: () => request('/health', healthSchema),
  installations: () => request('/installations', z.array(installationSchema)),
  assets: (installation_id?: string) =>
    request(`/assets${queryString({ installation_id })}`, z.array(assetSchema)),
  asset: (id: string) => request(`/assets/${id}`, assetSchema),
  summary: (installation_id?: string) =>
    request(`/dashboard/summary${queryString({ installation_id })}`, summarySchema),
  sensors: (asset_id?: string) =>
    request(`/sensors${queryString({ asset_id })}`, z.array(sensorSchema)),
  readings: (id: string, sensor_id?: string) =>
    request(
      `/assets/${id}/readings${queryString({ sensor_id, limit: 120 })}`,
      z.array(readingSchema),
    ),
  alerts: (filters: { asset_id?: string; installation_id?: string; status?: string } = {}) =>
    request(`/alerts${queryString(filters)}`, z.array(alertSchema)),
  alert: (id: string) => request(`/alerts/${id}`, alertSchema),
  nearby: (lat: number, lng: number, radius: number) =>
    request(
      `/assets/nearby${queryString({ lat, lng, radius })}`,
      z.array(assetSchema.extend({ distance_m: z.number() })),
    ),
  simulate: (sensor_id: string, mode: 'warning' | 'critical') =>
    request('/demo/anomalies', alertSchema, {
      method: 'POST',
      body: JSON.stringify({ sensor_id, mode }),
    }),
  resolve: (id: string) => request(`/alerts/${id}/resolve`, alertSchema, { method: 'PATCH' }),
  createAlert: (asset_id: string, severity: 'warning' | 'critical', message: string) =>
    request('/alerts', alertSchema, {
      method: 'POST',
      body: JSON.stringify({ asset_id, severity, message }),
    }),
  rename: (id: string, name: string) =>
    request(`/assets/${id}`, assetSchema, { method: 'PATCH', body: JSON.stringify({ name }) }),
};
