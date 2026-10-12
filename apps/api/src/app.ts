import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import type { Database } from './db/pool.js';
import { env } from './config/env.js';
import { RealtimeHub } from './realtime/hub.js';
import { TelemetryService } from './modules/telemetry-service.js';
import { registerRoutes } from './modules/routes.js';
import { AppError } from './modules/errors.js';
import { startRetention, startSimulator } from './simulator/runner.js';
// Client errors keep their 4xx status (413, 415…); anything unexpected becomes a generic 500.
export function errorStatus(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  if (typeof error !== 'object' || error === null) return 500;
  if ('validation' in error && error.validation) return 400;
  const status = 'statusCode' in error ? Number(error.statusCode) : NaN;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}
function errorCode(error: unknown, status: number) {
  if (error instanceof AppError) return error.code;
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status < 500) return 'BAD_REQUEST';
  return 'INTERNAL_ERROR';
}
export async function buildApp(
  db: Database,
  options: {
    demo?: boolean;
    simulator?: boolean;
    logger?: boolean;
    retentionHours?: number;
  } = {},
) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16384, requestTimeout: 15000 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, req, reply) => {
    const status = errorStatus(error);
    if (status >= 500) app.log.error({ err: error, requestId: req.id }, 'Request failed');
    else app.log.info({ err: error, requestId: req.id }, 'Request rejected');
    reply.code(status).send({
      error: {
        code: errorCode(error, status),
        message:
          status >= 500
            ? 'Error interno. Consulta el registro del servidor.'
            : error instanceof Error
              ? error.message
              : 'Solicitud inválida',
        request_id: req.id,
      },
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada', request_id: req.id } }),
  );
  const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim());
  await app.register(cors, { origin: origins });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'GeoTwin Cloud API',
        version: '1.0.0',
        description: 'Single organization infrastructure demo. Operational data are simulated.',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(websocket, { options: { maxPayload: 16384 } });
  const hub = new RealtimeHub();
  const telemetry = new TelemetryService(db, hub.publish);
  app.get(
    '/api/ws',
    {
      websocket: true,
      preValidation: (req, reply, done) => {
        if (req.headers.origin && !origins.includes(req.headers.origin)) {
          reply.code(403).send({
            error: { code: 'FORBIDDEN', message: 'Origin no permitido', request_id: req.id },
          });
          return;
        }
        done();
      },
      schema: { hide: true },
    },
    (socket) => hub.add(socket),
  );
  const demo = options.demo ?? env.DEMO_MODE;
  const simulator = options.simulator ?? env.SIMULATOR_ENABLED;
  registerRoutes(app, db, telemetry, demo, simulator);
  await app.register(swaggerUI, { routePrefix: '/api/docs' });
  const retentionHours = options.retentionHours ?? env.READINGS_RETENTION_HOURS;
  let stop: (() => Promise<void>) | undefined;
  let stopRetention: (() => Promise<void>) | undefined;
  app.addHook('onReady', async () => {
    if (simulator) stop = startSimulator(telemetry, env.SIMULATOR_INTERVAL_MS, app.log);
    if (retentionHours > 0) stopRetention = startRetention(telemetry, retentionHours, app.log);
  });
  app.addHook('preClose', async () => {
    await stop?.();
    await stopRetention?.();
    hub.close();
  });
  return app;
}
