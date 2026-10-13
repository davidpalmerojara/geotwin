import pg from 'pg';
import { REALTIME_CHANNEL } from '@geotwin/shared';

interface RelayLogger {
  warn(obj: object, msg: string): void;
}
/**
 * Listens on the Postgres NOTIFY channel with one dedicated connection and hands each payload
 * to `onPayload`. Any process that can reach the database (the worker, another API replica)
 * can reach every connected browser this way. Reconnects with backoff; `onReconnect` lets the
 * caller ask clients to resync, since notifications sent while disconnected are lost.
 */
export function startPgRelay(options: {
  connectionString: string;
  onPayload: (payload: string) => void;
  onReconnect: () => void;
  log: RelayLogger;
}) {
  let client: pg.Client | undefined;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped || timer) return;
    const delay = Math.min(30000, 500 * 2 ** attempt++);
    timer = setTimeout(() => {
      timer = undefined;
      void connect().catch((error: unknown) => {
        options.log.warn({ err: error }, 'NOTIFY relay reconnect failed');
        schedule();
      });
    }, delay);
    timer.unref();
  };
  const connect = async () => {
    const next = new pg.Client({ connectionString: options.connectionString });
    next.on('notification', (message) => {
      if (message.channel === REALTIME_CHANNEL && message.payload)
        options.onPayload(message.payload);
    });
    next.on('error', (error) => {
      options.log.warn({ err: error }, 'NOTIFY relay connection error');
      void next.end().catch(() => undefined);
    });
    next.on('end', () => {
      if (client === next) client = undefined;
      schedule();
    });
    await next.connect();
    await next.query(`LISTEN ${REALTIME_CHANNEL}`);
    client = next;
    if (attempt > 0) options.onReconnect();
    attempt = 0;
  };
  return {
    ready: connect(),
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await client?.end().catch(() => undefined);
    },
  };
}
