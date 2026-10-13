import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  errorSchema,
  idParams,
  layerLimitsSchema,
  layerSchema,
  layerTileParams,
  layerUploadQuery,
  REALTIME_CHANNEL,
  type LayerNotification,
} from '@geotwin/shared';
import { contentTypeFor, isSafeKey, type Storage } from '@geotwin/storage';
import { transaction, type Database, type Transaction } from '../../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { LasFormatError, LasUploadInspector } from './las.js';
import { LayerRepository } from './repository.js';
import type { LayerQueue } from './queue.js';

export const PNOA_ATTRIBUTION = 'Obra derivada de LiDAR-PNOA-cob3 2022-2025 CC-BY 4.0 scne.es';
const errors = {
  400: errorSchema,
  404: errorSchema,
  409: errorSchema,
  413: errorSchema,
  415: errorSchema,
  500: errorSchema,
};
export async function notifyLayer(client: Transaction, payload: LayerNotification) {
  await client.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, JSON.stringify(payload)]);
}
function tooLarge(max: number) {
  return new AppError(
    413,
    'PAYLOAD_TOO_LARGE',
    `El fichero supera el límite de ${Math.round(max / 1024 ** 2)} MB.`,
  );
}
function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
/** Keeps a readable, harmless original name (it is shown in the interface, never used as a path). */
export function cleanFilename(name: string | undefined) {
  const base = basename((name ?? '').replace(/\\/g, '/'))
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 255);
  return base || 'nube.laz';
}
function etagMatches(header: string | undefined, etag: string) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

export function registerLayerRoutes(
  app: FastifyInstance,
  deps: { db: Database; storage: Storage; queue: LayerQueue; maxUploadBytes: number },
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const repo = new LayerRepository(deps.db);
  const { storage, queue, maxUploadBytes } = deps;

  api.get(
    '/api/layers',
    {
      schema: {
        tags: ['Layers'],
        description: 'LiDAR point-cloud layers, newest first.',
        response: { 200: z.array(layerSchema), ...errors },
      },
    },
    async () => repo.list(),
  );

  api.get(
    '/api/layers/limits',
    {
      schema: {
        tags: ['Layers'],
        description: 'Accepted formats and the upload size limit, for the upload form.',
        response: { 200: layerLimitsSchema, ...errors },
      },
    },
    async () => ({
      max_upload_bytes: maxUploadBytes,
      formats: ['las', 'laz'] as ('las' | 'laz')[],
      extensions: ['.las', '.laz'],
    }),
  );

  api.post(
    '/api/layers',
    {
      schema: {
        tags: ['Layers'],
        description:
          'Uploads one LAS/LAZ file (multipart field `file`) and queues its conversion to 3D Tiles. ' +
          'The type is checked by content (LASF signature), not by extension. The body is ' +
          'streamed to object storage and hashed (SHA-256) on the way; a file already uploaded ' +
          'answers 409. Options go in the query string.',
        consumes: ['multipart/form-data'],
        querystring: layerUploadQuery,
        response: { 201: layerSchema, ...errors },
      },
    },
    async (req, reply) => {
      const declared = Number(req.headers['content-length']);
      // Multipart framing adds a few hundred bytes; reject obvious oversizes before reading.
      if (Number.isFinite(declared) && declared > maxUploadBytes + 64 * 1024) {
        reply.header('Connection', 'close');
        throw tooLarge(maxUploadBytes);
      }
      if (!req.isMultipart())
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Envía el fichero como multipart/form-data en el campo "file".',
        );
      if (req.query.vertical_datum === 'ellipsoidal' && req.query.geoid_offset_m !== undefined)
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Con alturas elipsoidales no se aplica geoide: quita geoid_offset_m.',
        );
      const part = await req.file({
        limits: { fileSize: maxUploadBytes, files: 1, fields: 10 },
        throwFileSizeLimit: true,
      });
      if (!part || part.fieldname !== 'file')
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Falta el campo "file" con el fichero LAS/LAZ.',
        );
      const id = randomUUID();
      const sourceKey = `layers/${id}/source`;
      const inspector = new LasUploadInspector();
      part.file.on('error', (error) => inspector.destroy(error));
      // The storage driver attaches its own handlers asynchronously; never leave an error unheard.
      inspector.on('error', () => undefined);
      try {
        await storage.put(sourceKey, part.file.pipe(inspector), 'application/octet-stream');
        if (part.file.truncated) throw tooLarge(maxUploadBytes);
      } catch (error) {
        // The rest of the body was not read: close the connection instead of reusing it.
        reply.header('Connection', 'close');
        await storage.delete(sourceKey).catch(() => undefined);
        if (error instanceof LasFormatError)
          throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', error.message);
        if (error instanceof AppError) throw error;
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'FST_REQ_FILE_TOO_LARGE'
        )
          throw tooLarge(maxUploadBytes);
        throw error;
      }
      const signature = inspector.signature!;
      const sha256 = inspector.digest();
      const duplicate = async () => {
        await storage.delete(sourceKey).catch(() => undefined);
        const existing = await repo.bySha256(sha256);
        return new AppError(
          409,
          'DUPLICATE_LAYER',
          existing
            ? `Este fichero ya está cargado como la capa «${existing.name}» (${existing.id}).`
            : 'Este fichero ya está cargado.',
        );
      };
      if (await repo.bySha256(sha256)) throw await duplicate();
      const filename = cleanFilename(part.filename);
      const attribution =
        req.query.attribution ?? (/^PNOA[_-]/i.test(filename) ? PNOA_ATTRIBUTION : null);
      try {
        await transaction(deps.db, async (client) => {
          await repo.insert(client, {
            id,
            name: req.query.name ?? filename.replace(/\.la[sz]$/i, '').slice(0, 100),
            sourceKey,
            sourceSize: inspector.size,
            sourceFormat: signature.format,
            originalFilename: filename,
            sha256,
            crsIn: req.query.crs_in,
            verticalDatum: req.query.vertical_datum,
            geoidOverride: req.query.geoid_offset_m ?? null,
            attribution,
          });
          // Same transaction: no job without a row, and no row without a job.
          await repo.setJob(client, id, await queue.enqueue(id, client));
          await notifyLayer(client, { event: 'created', id });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw await duplicate();
        await storage.delete(sourceKey).catch(() => undefined);
        throw error;
      }
      return reply.code(201).send((await repo.get(id))!);
    },
  );

  api.get(
    '/api/layers/:id',
    { schema: { tags: ['Layers'], params: idParams, response: { 200: layerSchema, ...errors } } },
    async (req) => (await repo.get(req.params.id)) ?? notFound('Capa', 'f'),
  );

  api.post(
    '/api/layers/:id/reprocess',
    {
      schema: {
        tags: ['Layers'],
        description:
          'Queues a ready or failed layer again (idempotent conversion from the stored source). ' +
          'Optionally sets or clears (null) the per-layer geoid override in metres.',
        params: idParams,
        body: z.object({ geoid_offset_m: z.number().min(-150).max(150).nullable().optional() }),
        response: { 202: layerSchema, ...errors },
      },
    },
    async (req, reply) => {
      const current = (await repo.get(req.params.id)) ?? notFound('Capa', 'f');
      if (current.vertical.datum === 'ellipsoidal' && req.body.geoid_offset_m != null)
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Con alturas elipsoidales no se aplica geoide.',
        );
      await transaction(deps.db, async (client) => {
        if (!(await repo.requeue(client, current.id, req.body.geoid_offset_m)))
          throw new AppError(409, 'LAYER_BUSY', 'La capa todavía se está procesando.');
        await repo.setJob(client, current.id, await queue.enqueue(current.id, client));
        await notifyLayer(client, {
          event: 'progress',
          id: current.id,
          status: 'queued',
          stage: 'queued',
          progress: 0,
        });
      });
      return reply.code(202).send((await repo.get(current.id))!);
    },
  );

  api.delete(
    '/api/layers/:id',
    {
      schema: {
        tags: ['Layers'],
        description: 'Deletes the layer, cancels its job and removes its source and tiles.',
        params: idParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (req, reply) => {
      const removed = await transaction(deps.db, async (client) => {
        const row = await repo.remove(client, req.params.id);
        if (row) await notifyLayer(client, { event: 'deleted', id: req.params.id });
        return row;
      });
      if (!removed) notFound('Capa', 'f');
      if (removed.job_id) await queue.cancel(removed.job_id);
      await storage.deletePrefix(`layers/${req.params.id}/`);
      return reply.code(204).send(null);
    },
  );

  api.get(
    '/api/layers/:id/tiles/*',
    {
      schema: {
        tags: ['Layers'],
        description:
          '3D Tiles files of a ready layer (tileset.json, .pnts). Paths are versioned per ' +
          'processing run, so responses are immutable and carry an ETag.',
        params: layerTileParams,
        response: { 200: z.any(), 304: z.null(), ...errors },
      },
    },
    async (req, reply) => {
      const path = req.params['*'];
      if (!isSafeKey(path))
        throw new AppError(400, 'VALIDATION_ERROR', 'Ruta de tesela no válida.');
      const layer = await repo.tilesetKey(req.params.id);
      if (!layer || layer.status !== 'ready') notFound('Capa', 'f');
      const key = `layers/${req.params.id}/tiles/${path}`;
      const object = (await storage.get(key)) ?? notFound('Fichero de teselas');
      reply
        .header('ETag', object.etag)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('X-Content-Type-Options', 'nosniff');
      if (etagMatches(req.headers['if-none-match'], object.etag)) {
        object.body.destroy();
        return reply.code(304).send(null);
      }
      return reply
        .header('Content-Type', contentTypeFor(key))
        .header('Content-Length', object.size)
        .send(object.body);
    },
  );
}
