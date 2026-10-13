import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/** Messages printed by apps/worker/python/geotwin_lidar.py, one JSON object per line. */
const message = z.discriminatedUnion('event', [
  z.object({ event: z.literal('progress'), stage: z.string(), fraction: z.number() }),
  z.object({ event: z.literal('result') }).loose(),
  z.object({
    event: z.literal('error'),
    code: z.string(),
    message: z.string(),
    permanent: z.boolean(),
  }),
]);

/** Failure reported by the Python tool. `permanent` means the input is bad: do not retry. */
export class LidarToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface RunOptions {
  python: string;
  script: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
  env?: Record<string, string>;
}

/**
 * Runs one geotwin_lidar.py command and resolves with its `result` line. When `signal` aborts
 * (job timeout, cancellation, layer deleted) the whole process group is killed: SIGTERM, then
 * SIGKILL after 5 s. The group matters because py3dtiles forks worker processes; killing only
 * the main one left them orphaned, still holding the stdout pipe, so 'close' never fired and the
 * job (and with concurrency 1, the whole queue) hung until pg-boss expired it.
 */
export function runLidarTool(args: string[], options: RunOptions) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal));
      return;
    }
    // -I: isolated mode, so nothing in the working folder can shadow a module.
    const child = spawn(options.python, ['-I', options.script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...options.env },
      // Its own process group, so the converter and every process it forks can be killed at once.
      detached: true,
    });
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // ESRCH: the group is already gone.
      }
    };
    // A worker that exits (even on an unhandled error) takes its converters with it.
    const onExit = () => killGroup('SIGKILL');
    process.once('exit', onExit);
    let result: Record<string, unknown> | undefined;
    let failure: LidarToolError | undefined;
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let parsed: z.infer<typeof message>;
      try {
        parsed = message.parse(JSON.parse(line));
      } catch {
        return; // py3dtiles prints its own warnings to stdout; ignore anything that is not ours
      }
      if (parsed.event === 'progress') options.onProgress?.(parsed.fraction, parsed.stage);
      else if (parsed.event === 'result') result = parsed;
      else failure = new LidarToolError(parsed.code, parsed.message, parsed.permanent);
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), 5000);
      killTimer.unref();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      process.removeListener('exit', onExit);
      reject(
        new LidarToolError(
          'PYTHON_UNAVAILABLE',
          `No se pudo ejecutar Python: ${error.message}`,
          false,
        ),
      );
    });
    child.once('close', (code, signalName) => {
      options.signal?.removeEventListener('abort', onAbort);
      process.removeListener('exit', onExit);
      clearTimeout(killTimer);
      // Nothing of this run may outlive it (forked helpers of a crashed converter included).
      killGroup('SIGKILL');
      if (options.signal?.aborted) reject(abortError(options.signal));
      else if (code === 0 && result) resolve(result);
      else if (failure) reject(failure);
      else
        reject(
          new LidarToolError(
            'TOOL_CRASHED',
            `El conversor terminó con ${signalName ?? `código ${code}`}: ${stderr.trim().split('\n').at(-1) ?? ''}`,
            false,
          ),
        );
    });
  });
}
function abortError(signal: AbortSignal) {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('Aborted');
}
