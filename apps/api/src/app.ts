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
import { startSimulator } from './simulator/runner.js';
export async function buildApp(
  db: Database,
  options: { demo?: boolean; simulator?: boolean; logger?: boolean } = {},
) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16384, requestTimeout: 15000 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, req, reply) => {
    app.log.error({ err: error, requestId: req.id }, 'Request failed');
    const validation = typeof error === 'object' && error !== null && 'validation' in error;
    const httpStatus =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const status =
      error instanceof AppError ? error.statusCode : validation || httpStatus === 400 ? 400 : 500;
    reply.code(status).send({
      error: {
        code:
          error instanceof AppError
            ? error.code
            : status === 400
              ? 'VALIDATION_ERROR'
              : 'INTERNAL_ERROR',
        message:
          status === 500
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
  let stop: (() => Promise<void>) | undefined;
  app.addHook('onReady', async () => {
    if (simulator) stop = startSimulator(telemetry, env.SIMULATOR_INTERVAL_MS, app.log);
  });
  app.addHook('preClose', async () => {
    await stop?.();
    hub.close();
  });
  return app;
}
