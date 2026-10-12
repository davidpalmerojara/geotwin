import { z } from 'zod';
export const uuid = z.uuid();
export const assetStatus = z.enum(['healthy', 'warning', 'critical']);
export const severity = z.enum(['warning', 'critical']);
export const locationSchema = z.object({ lat: z.number(), lng: z.number() });
export const assetSchema = z.object({
  id: uuid,
  organization_id: uuid,
  installation_id: uuid,
  name: z.string(),
  type: z.enum(['pump', 'transformer', 'reservoir', 'gateway', 'valve', 'turbine']),
  status: assetStatus,
  location: locationSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export const installationSchema = z.object({
  id: uuid,
  organization_id: uuid,
  name: z.string(),
  description: z.string(),
  location: locationSchema,
  asset_count: z.number().int(),
});
export const sensorSchema = z.object({
  id: uuid,
  asset_id: uuid,
  metric_type: z.enum(['temperature', 'vibration', 'pressure']),
  unit: z.string(),
  warning_threshold: z.number(),
  critical_threshold: z.number(),
  baseline: z.number(),
  latest_value: z.number().nullable(),
  latest_at: z.string().nullable(),
});
export const readingSchema = z.object({
  sensor_id: uuid,
  asset_id: uuid,
  metric_type: z.string(),
  unit: z.string(),
  value: z.number(),
  recorded_at: z.string(),
  simulated: z.boolean(),
});
export const alertSchema = z.object({
  id: uuid,
  asset_id: uuid,
  sensor_id: uuid.nullable(),
  severity,
  message: z.string(),
  status: z.enum(['active', 'resolved']),
  source: z.enum(['telemetry', 'manual']),
  triggered_at: z.string(),
  resolved_at: z.string().nullable(),
  resolved_by: z.enum(['operator', 'auto_recovery']).nullable(),
  asset_name: z.string(),
});
export const summarySchema = z.object({
  total_assets: z.number().int(),
  operational_assets: z.number().int(),
  warning_assets: z.number().int(),
  critical_assets: z.number().int(),
  active_alerts: z.number().int(),
  critical_incidents: z.number().int(),
  active_sensors: z.number().int(),
  installations: z.number().int(),
  simulated: z.literal(true),
  trend: z.array(
    z.object({ recorded_at: z.string(), temperature: z.number(), vibration: z.number() }),
  ),
});
export const healthSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('connected'),
  postgis: z.string(),
  demo_mode: z.boolean(),
  simulator_enabled: z.boolean(),
});
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), request_id: z.string() }),
});
export const idParams = z.object({ id: uuid });
export const assetsQuery = z.object({
  installation_id: uuid.optional(),
  status: assetStatus.optional(),
  search: z.string().max(100).optional(),
});
export const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50000).default(500),
});
export const readingsQuery = z.object({
  sensor_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
});
export const alertsQuery = z.object({
  installation_id: uuid.optional(),
  asset_id: uuid.optional(),
  status: z.enum(['active', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const simulationBody = z.object({ sensor_id: uuid, mode: severity });
export const createAlertBody = z.object({
  asset_id: uuid,
  severity,
  message: z.string().trim().min(5).max(500),
});
export const updateAssetBody = z.object({ name: z.string().trim().min(1).max(100) });
export const realtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sensor:reading'), data: readingSchema }),
  z.object({
    type: z.literal('asset:status_changed'),
    data: z.object({ asset_id: uuid, status: assetStatus }),
  }),
  z.object({ type: z.literal('alert:created'), data: alertSchema }),
  z.object({ type: z.literal('alert:resolved'), data: alertSchema }),
  z.object({ type: z.literal('sync:required'), data: z.object({ connected_at: z.string() }) }),
]);
export type Asset = z.infer<typeof assetSchema>;
export type Installation = z.infer<typeof installationSchema>;
export type Sensor = z.infer<typeof sensorSchema>;
export type Reading = z.infer<typeof readingSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type AssetStatus = z.infer<typeof assetStatus>;
