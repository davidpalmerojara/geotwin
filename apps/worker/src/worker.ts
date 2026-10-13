import { PgBoss } from 'pg-boss';
import { LAYER_QUEUE, LAYER_QUEUE_DEFAULTS, layerJobSchema } from '@geotwin/shared';
import { processLayer, type Deps } from './process-layer.js';

export interface QueueSettings {
  timeoutSeconds: number;
  retryLimit: number;
  concurrency: number;
}
/** Creates (or updates) the layer queue and starts consuming it. Returns the worker id. */
export async function startLayerWorker(boss: PgBoss, deps: Deps, settings: QueueSettings) {
  const options = {
    ...LAYER_QUEUE_DEFAULTS,
    expireInSeconds: settings.timeoutSeconds,
    retryLimit: settings.retryLimit,
  };
  await boss.createQueue(LAYER_QUEUE, options);
  await boss.updateQueue(LAYER_QUEUE, options);
  return boss.work(
    LAYER_QUEUE,
    { batchSize: 1, localConcurrency: settings.concurrency, pollingIntervalSeconds: 1 },
    async ([job]) => {
      if (!job) return;
      const data = layerJobSchema.parse(job.data);
      return {
        outcome: await processLayer(
          {
            id: job.id,
            layerId: data.layer_id,
            retryCount: job.retryCount,
            retryLimit: settings.retryLimit,
            signal: job.signal,
          },
          deps,
        ),
      };
    },
  );
}
