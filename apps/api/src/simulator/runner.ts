import type { TelemetryService } from '../modules/telemetry-service.js';
import type { FastifyBaseLogger } from 'fastify';
export function startSimulator(
  service: TelemetryService,
  intervalMs: number,
  logger: FastifyBaseLogger,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const run = () => {
    inFlight = service
      .tick()
      .catch((error) => logger.error({ err: error }, 'Telemetry tick failed'))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(run, intervalMs);
          timer.unref();
        }
      });
  };
  run();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await inFlight;
  };
}
// Deletes readings older than the retention window once at start and then every 10 minutes.
export function startRetention(
  service: TelemetryService,
  retentionHours: number,
  logger: FastifyBaseLogger,
  everyMs = 600000,
) {
  let inFlight: Promise<void> | undefined;
  const run = () => {
    if (inFlight) return;
    inFlight = service
      .pruneReadings(retentionHours)
      .then((deleted) => {
        if (deleted) logger.info({ deleted, retentionHours }, 'Old readings pruned');
      })
      .catch((error) => logger.error({ err: error }, 'Readings retention failed'))
      .finally(() => {
        inFlight = undefined;
      });
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
