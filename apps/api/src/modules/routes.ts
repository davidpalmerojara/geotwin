import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  assetSchema,
  installationSchema,
  sensorSchema,
  readingSchema,
  alertSchema,
  summarySchema,
  healthSchema,
  errorSchema,
  idParams,
  assetsQuery,
  nearbyQuery,
  readingsQuery,
  alertsQuery,
  simulationBody,
  createAlertBody,
  updateAssetBody,
  organizationSchema,
  uuid,
  type RealtimeEvent,
} from '@geotwin/shared';
import { Repository } from './repository.js';
import type { TelemetryService } from './telemetry-service.js';
import type { Database } from '../db/pool.js';
import { notFound } from './errors.js';
export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  telemetry: TelemetryService,
  publish: (events: RealtimeEvent[]) => void,
  demo: boolean,
  simulator: boolean,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const repository = new Repository(db);
  const errors = {
    400: errorSchema,
    404: errorSchema,
    409: errorSchema,
    413: errorSchema,
    415: errorSchema,
    500: errorSchema,
    503: errorSchema,
  };
  api.get(
    '/api/health',
    { schema: { tags: ['System'], response: { 200: healthSchema, ...errors } } },
    async () => {
      const result = await db.query<{ version: string }>('SELECT postgis_lib_version() AS version');
      return {
        status: 'ok' as const,
        database: 'connected' as const,
        postgis: result.rows[0]!.version,
        demo_mode: demo,
        simulator_enabled: simulator,
      };
    },
  );
  api.get(
    '/api/dashboard/summary',
    {
      schema: {
        tags: ['Dashboard'],
        querystring: z.object({ installation_id: uuid.optional() }),
        response: { 200: summarySchema, ...errors },
      },
    },
    async (req) => repository.summary(req.query.installation_id),
  );
  api.get(
    '/api/organization',
    {
      schema: {
        tags: ['Installations'],
        description: 'The single demo organization and the place name the interface shows.',
        response: { 200: organizationSchema, ...errors },
      },
    },
    async () => (await repository.organization()) ?? notFound('Organización', 'f'),
  );
  api.get(
    '/api/installations',
    {
      schema: {
        tags: ['Installations'],
        response: { 200: z.array(installationSchema), ...errors },
      },
    },
    async () => repository.installations(),
  );
  api.get(
    '/api/assets',
    {
      schema: {
        tags: ['Assets'],
        querystring: assetsQuery,
        response: { 200: z.array(assetSchema), ...errors },
      },
    },
    async (req) => repository.assets(req.query),
  );
  api.get(
    '/api/assets/nearby',
    {
      schema: {
        tags: ['Spatial'],
        description: 'ST_DWithin on geography (WGS84), distances in meters.',
        querystring: nearbyQuery,
        response: { 200: z.array(assetSchema.extend({ distance_m: z.number() })), ...errors },
      },
    },
    async (req) => repository.nearby(req.query.lat, req.query.lng, req.query.radius),
  );
  api.get(
    '/api/assets/:id',
    { schema: { tags: ['Assets'], params: idParams, response: { 200: assetSchema, ...errors } } },
    async (req) => (await repository.asset(req.params.id)) ?? notFound('Activo'),
  );
  api.patch(
    '/api/assets/:id',
    {
      schema: {
        tags: ['Assets'],
        params: idParams,
        body: updateAssetBody,
        response: { 200: assetSchema, ...errors },
      },
    },
    async (req) => {
      const asset =
        (await repository.renameAsset(req.params.id, req.body.name)) ?? notFound('Activo');
      // Published after the UPDATE has committed (single statement, autocommit).
      publish([{ type: 'asset:updated', data: asset }]);
      return asset;
    },
  );
  api.get(
    '/api/assets/:id/readings',
    {
      schema: {
        tags: ['Telemetry'],
        params: idParams,
        querystring: readingsQuery,
        response: { 200: z.array(readingSchema), ...errors },
      },
    },
    async (req) => {
      if (!(await repository.asset(req.params.id))) notFound('Activo');
      return repository.readings(req.params.id, req.query.limit, req.query.sensor_id);
    },
  );
  api.get(
    '/api/sensors',
    {
      schema: {
        tags: ['Telemetry'],
        querystring: z.object({ asset_id: uuid.optional() }),
        response: { 200: z.array(sensorSchema), ...errors },
      },
    },
    async (req) => repository.sensors(req.query.asset_id),
  );
  api.get(
    '/api/alerts',
    {
      schema: {
        tags: ['Alerts'],
        querystring: alertsQuery,
        response: { 200: z.array(alertSchema), ...errors },
      },
    },
    async (req) => repository.alerts(req.query),
  );
  api.get(
    '/api/alerts/:id',
    { schema: { tags: ['Alerts'], params: idParams, response: { 200: alertSchema, ...errors } } },
    async (req) => (await repository.alert(req.params.id)) ?? notFound('Incidencia', 'f'),
  );
  api.post(
    '/api/alerts',
    {
      schema: {
        tags: ['Alerts'],
        body: createAlertBody,
        response: { 201: alertSchema, ...errors },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await telemetry.createManual(req.body.asset_id, req.body.severity, req.body.message)),
  );
  api.patch(
    '/api/alerts/:id/resolve',
    { schema: { tags: ['Alerts'], params: idParams, response: { 200: alertSchema, ...errors } } },
    async (req) => telemetry.resolve(req.params.id),
  );
  api.patch(
    '/api/alerts/:id/acknowledge',
    {
      schema: {
        tags: ['Alerts'],
        description:
          'Marks an active alert as seen by an operator. Idempotent; the alert stays active until resolved.',
        params: idParams,
        response: { 200: alertSchema, ...errors },
      },
    },
    async (req) => telemetry.acknowledge(req.params.id),
  );
  if (demo)
    api.post(
      '/api/demo/anomalies',
      {
        schema: {
          tags: ['Demo'],
          description:
            'Demo only. Persistent override until alert resolution; records the anomaly immediately.',
          body: simulationBody,
          response: { 201: alertSchema, ...errors },
        },
      },
      async (req, reply) =>
        reply.code(201).send(await telemetry.simulate(req.body.sensor_id, req.body.mode)),
    );
  api.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}
