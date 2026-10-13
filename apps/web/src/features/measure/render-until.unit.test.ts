import { describe, expect, it } from 'vitest';
import { renderUntil, type Frames } from './render-until';

/** Manual animation frames: `step()` runs the pending callback and advances the clock 16 ms. */
function fakeFrames() {
  let time = 0,
    pending: (() => void) | undefined;
  const frames: Frames = {
    request: (tick) => {
      pending = tick;
      return 1;
    },
    cancel: () => {
      pending = undefined;
    },
    now: () => time,
  };
  const step = () => {
    const tick = pending;
    pending = undefined;
    time += 16;
    tick?.();
    return !!tick;
  };
  return { frames, step };
}

describe('renderUntil', () => {
  it('keeps rendering while the geometry is pending, however long it takes', () => {
    const { frames, step } = fakeFrames();
    let renders = 0,
      ready = false;
    renderUntil(
      () => renders++,
      () => ready,
      { frames, maxMs: 20000, settleFrames: 3 },
    );
    // A busy machine: 5 s (about 300 frames) before the line is built, well past the old 1.2 s.
    for (let i = 0; i < 300; i++) expect(step()).toBe(true);
    ready = true;
    while (step());
    expect(renders).toBe(300 + 3);
  });

  it('waits for readiness to hold: a stale "ready" before the first update does not stop it', () => {
    const { frames, step } = fakeFrames();
    const answers = [true, true, false, false, true, true, true];
    let renders = 0;
    renderUntil(
      () => renders++,
      () => answers.shift() ?? true,
      { frames, settleFrames: 3 },
    );
    while (step());
    expect(renders).toBe(7);
  });

  it('gives up after maxMs if the geometry never becomes ready', () => {
    const { frames, step } = fakeFrames();
    let renders = 0;
    renderUntil(
      () => renders++,
      () => false,
      { frames, maxMs: 1000 },
    );
    while (step());
    expect(renders).toBeGreaterThan(55);
    expect(renders).toBeLessThan(70);
  });

  it('stops when cancelled', () => {
    const { frames, step } = fakeFrames();
    let renders = 0;
    const stop = renderUntil(
      () => renders++,
      () => false,
      { frames },
    );
    step();
    stop();
    expect(step()).toBe(false);
    expect(renders).toBe(1);
  });
});
