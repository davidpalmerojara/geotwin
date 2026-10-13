import { PgBoss } from 'pg-boss';
import { LAYER_QUEUE, LAYER_QUEUE_DEFAULTS } from '@geotwin/shared';
import type { Transaction } from '../../db/pool.js';

/**
 * Producer side of the layer queue. The API only enqueues and cancels; the separate worker
 * process consumes. pg-boss stores jobs in PostgreSQL (schema `pgboss`), so no Redis is needed.
 */
export class LayerQueue {
  private readonly boss: PgBoss;
  constructor(connectionString: string) {
    this.boss = new PgBoss({
      connectionString,
      max: 2,
      instanceName: 'api',
      // Maintenance (expiring, retrying, archiving) is the worker's job.
      supervise: false,
      schedule: false,
    });
    this.boss.on('error', () => undefined);
  }
  async start() {
    await this.boss.start();
    await this.boss.createQueue(LAYER_QUEUE, LAYER_QUEUE_DEFAULTS);
  }
  /** Enqueues inside the caller's transaction: the job exists only if the layer row commits. */
  async enqueue(layerId: string, client: Transaction) {
    const id = await this.boss.send(
      LAYER_QUEUE,
      { layer_id: layerId },
      { db: { executeSql: (text, values) => client.query(text, values) } },
    );
    if (!id) throw new Error('pg-boss did not create the job');
    return id;
  }
  async cancel(jobId: string) {
    await this.boss.cancel(LAYER_QUEUE, jobId).catch(() => undefined);
  }
  async stop() {
    await this.boss.stop({ graceful: false, close: true });
  }
}
