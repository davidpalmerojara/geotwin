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
export const organizationSchema = z.object({
  id: uuid,
  name: z.string(),
  region: z.string().nullable(),
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
// LiDAR layers: uploaded LAS/LAZ point clouds that a worker converts to 3D Tiles.
export const layerStatus = z.enum(['queued', 'processing', 'ready', 'failed']);
export const layerStage = z.enum([
  'queued',
  'downloading',
  'inspecting',
  'tiling',
  'uploading',
  'done',
]);
export const verticalDatum = z.enum(['orthometric', 'ellipsoidal']);
// How orthometric heights became ellipsoidal ones (see docs/architecture.md).
export const geoidMethod = z.enum(['egm08_rednap_grid', 'egm96_centre', 'override', 'none']);
export const epsgCode = z.string().regex(/^EPSG:\d{4,6}$/, 'Usa el formato EPSG:25830');
export const layerSchema = z.object({
  id: uuid,
  organization_id: uuid,
  name: z.string(),
  kind: z.literal('pointcloud'),
  status: layerStatus,
  stage: layerStage,
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  source: z.object({
    filename: z.string(),
    format: z.enum(['las', 'laz']),
    size_bytes: z.number().int(),
    sha256: z.string(),
  }),
  crs_in: z.string(),
  vertical: z.object({
    datum: verticalDatum,
    // Requested override in metres (null: computed by the worker).
    override_m: z.number().nullable(),
    // Geoid undulation N actually applied (h = H + N), null until processed.
    geoid_offset_m: z.number().nullable(),
    method: geoidMethod.nullable(),
  }),
  point_count: z.number().int().nullable(),
  point_format: z.number().int().nullable(),
  // [west, south, east, north] in degrees (WGS84).
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  center: locationSchema.nullable(),
  // Heights as stored in the source file (orthometric for PNOA).
  height_range_m: z.object({ min: z.number(), max: z.number() }).nullable(),
  tileset_url: z.string().nullable(),
  attribution: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const layerProgressSchema = z.object({
  id: uuid,
  status: layerStatus,
  stage: layerStage,
  progress: z.number().int().min(0).max(100),
});
export const layerUploadQuery = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  crs_in: epsgCode.default('EPSG:25830'),
  vertical_datum: verticalDatum.default('orthometric'),
  geoid_offset_m: z.coerce.number().min(-150).max(150).optional(),
  attribution: z.string().trim().min(1).max(500).optional(),
});
export const layerTileParams = z.object({ id: uuid, '*': z.string().min(1).max(512) });
// Queue contract shared by the API (producer) and the worker (consumer).
export const LAYER_QUEUE = 'layer-process';
export const layerJobSchema = z.object({ layer_id: uuid });
// pg-boss queue defaults; the worker can raise the timeout and retries through its environment.
export const LAYER_QUEUE_DEFAULTS = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 600,
  expireInSeconds: 1800,
  heartbeatSeconds: 60,
  deleteAfterSeconds: 7 * 24 * 3600,
} as const;
// Postgres NOTIFY channel the worker and the API use to fan events out to every API replica.
export const REALTIME_CHANNEL = 'geotwin_events';
// NOTIFY payloads are kept small (Postgres caps them at 8000 bytes): the API reads the row itself.
export const layerNotificationSchema = z.union([
  layerProgressSchema.extend({ event: z.literal('progress') }),
  z.object({ event: z.enum(['created', 'ready', 'failed', 'deleted']), id: uuid }),
]);
export const realtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sensor:reading'), data: readingSchema }),
  z.object({
    type: z.literal('asset:status_changed'),
    data: z.object({ asset_id: uuid, status: assetStatus }),
  }),
  z.object({ type: z.literal('asset:updated'), data: assetSchema }),
  z.object({ type: z.literal('alert:created'), data: alertSchema }),
  z.object({ type: z.literal('alert:updated'), data: alertSchema }),
  z.object({ type: z.literal('alert:resolved'), data: alertSchema }),
  z.object({ type: z.literal('sync:required'), data: z.object({ connected_at: z.string() }) }),
  z.object({ type: z.literal('layer:created'), data: layerSchema }),
  z.object({ type: z.literal('layer:progress'), data: layerProgressSchema }),
  z.object({ type: z.literal('layer:ready'), data: layerSchema }),
  z.object({ type: z.literal('layer:failed'), data: layerSchema }),
  z.object({ type: z.literal('layer:deleted'), data: z.object({ id: uuid }) }),
]);
export type Asset = z.infer<typeof assetSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type Installation = z.infer<typeof installationSchema>;
export type Sensor = z.infer<typeof sensorSchema>;
export type Reading = z.infer<typeof readingSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type AssetStatus = z.infer<typeof assetStatus>;
export type Layer = z.infer<typeof layerSchema>;
export type LayerProgress = z.infer<typeof layerProgressSchema>;
export type LayerStage = z.infer<typeof layerStage>;
export type GeoidMethod = z.infer<typeof geoidMethod>;
export type LayerJob = z.infer<typeof layerJobSchema>;
export type LayerNotification = z.infer<typeof layerNotificationSchema>;
