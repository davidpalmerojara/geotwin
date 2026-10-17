import { z } from 'zod';
import {
  assetSchema,
  installationSchema,
  sensorSchema,
  readingSchema,
  alertSchema,
  summarySchema,
  healthSchema,
  organizationSchema,
  layerSchema,
  layerLimitsSchema,
  sectionSchema,
  type Layer,
} from '@geotwin/shared';
export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return params.size ? `?${params}` : '';
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  return parseResponse(response.status, response.ok, await response.text(), schema);
}
/** Shared by fetch and the upload request (XMLHttpRequest, for its progress events). */
export function parseResponse<T>(status: number, ok: boolean, text: string, schema: z.ZodType<T>) {
  // A proxy (nginx 502, a gateway timeout) can answer with HTML or an empty body.
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!ok) {
    const result = z.object({ error: z.object({ message: z.string() }) }).safeParse(data);
    throw new ApiError(status, result.success ? result.data.error.message : `Error HTTP ${status}`);
  }
  if (data === undefined) throw new ApiError(status, 'Respuesta no válida de la API');
  return schema.parse(data);
}
export interface UploadOptions {
  name?: string;
  attribution?: string;
}
/**
 * Uploads one LAS/LAZ file as multipart/form-data. XMLHttpRequest instead of fetch because
 * fetch still has no upload progress events; `signal` cancels the transfer.
 */
export function uploadLayer(
  file: File,
  options: UploadOptions,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Layer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/layers${queryString({ ...options })}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        resolve(
          parseResponse(
            xhr.status,
            xhr.status >= 200 && xhr.status < 300,
            xhr.responseText,
            layerSchema,
          ),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    // The API closes the connection on 413/415 before reading the body: some browsers then
    // report a network error instead of the response.
    xhr.onerror = () =>
      reject(new ApiError(0, 'Se cortó la subida. Comprueba el tamaño y el tipo del fichero.'));
    xhr.onabort = () => reject(new ApiError(0, 'Subida cancelada.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
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
  organization: () => request('/organization', organizationSchema),
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
  acknowledge: (id: string) =>
    request(`/alerts/${id}/acknowledge`, alertSchema, { method: 'PATCH' }),
  createAlert: (asset_id: string, severity: 'warning' | 'critical', message: string) =>
    request('/alerts', alertSchema, {
      method: 'POST',
      body: JSON.stringify({ asset_id, severity, message }),
    }),
  layers: () => request('/layers', z.array(layerSchema)),
  layerLimits: () => request('/layers/limits', layerLimitsSchema),
  /** Points of a layer within `half` metres of A–B (all levels of its tiles). */
  section: (
    id: string,
    a: { lng: number; lat: number },
    b: { lng: number; lat: number },
    half: number,
    signal?: AbortSignal,
  ) =>
    request(
      `/layers/${id}/section${queryString({
        a: `${a.lng.toFixed(7)},${a.lat.toFixed(7)}`,
        b: `${b.lng.toFixed(7)},${b.lat.toFixed(7)}`,
        half,
      })}`,
      sectionSchema,
      { signal },
    ),
  deleteLayer: async (id: string) => {
    const response = await fetch(`/api/layers/${id}`, { method: 'DELETE' });
    // 204 has no body; errors use the JSON error contract.
    if (!response.ok) parseResponse(response.status, false, await response.text(), z.unknown());
  },
  rename: (id: string, name: string) =>
    request(`/assets/${id}`, assetSchema, { method: 'PATCH', body: JSON.stringify({ name }) }),
};
