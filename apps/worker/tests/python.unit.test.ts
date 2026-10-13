import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runLidarTool } from '../src/python.js';

const python = process.env.LIDAR_TEST_PYTHON ?? 'python3';
const script = new URL('./fake_lidar.py', import.meta.url).pathname;
// Running or sleeping; a killed process may linger as a zombie until its new parent reaps it.
const alive = (pid: number) => {
  try {
    return !/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch {
    return false;
  }
};

afterEach(() => {
  delete process.env.FAKE_LIDAR_MODE;
});

describe('Converter process', () => {
  it.skipIf(process.platform !== 'linux')(
    'on abort kills the converter and the helpers it forked, so the job ends',
    async () => {
      // py3dtiles forks worker processes that inherit stdout; killing only the main process left
      // them holding the pipe and the run never finished (seen when a layer was deleted mid-run).
      process.env.FAKE_LIDAR_MODE = 'forked';
      const controller = new AbortController();
      let helper = 0;
      const started = Date.now();
      const run = runLidarTool(['convert', 'in.laz', 'out'], {
        python,
        script,
        signal: controller.signal,
        onProgress: (_fraction, stage) => {
          helper = Number(stage.replace('helper:', ''));
          controller.abort(new Error('layer deleted'));
        },
      });
      await expect(run).rejects.toThrow('layer deleted');
      expect(Date.now() - started).toBeLessThan(5000);
      expect(helper).toBeGreaterThan(0);
      // The forked helper is gone too (give the kernel a moment to reap it).
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(alive(helper)).toBe(false);
    },
    15000,
  );
});
