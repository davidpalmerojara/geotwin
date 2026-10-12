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
