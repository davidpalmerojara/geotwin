import { describe, expect, it } from 'vitest';
import { frameSync } from './frame-sync';

/** A page with a fake animation frame queue, a camera that may be moving and a placement log. */
function page() {
  const frames = new Map<number, () => void>();
  let next = 1;
  const log: string[] = [];
  const state = { moving: false };
  const sync = frameSync({
    place: (inFrame) => log.push(inFrame ? 'frame' : 'between'),
    moving: () => state.moving,
    requestFrame: (cb) => {
      frames.set(next, cb);
      return next++;
    },
    cancelFrame: (h) => void frames.delete(h),
  });
  const tick = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb();
  };
  return { sync, log, state, tick, pending: () => frames.size };
}

describe('frameSync', () => {
  it('places a change of the page in the next animation frame while the camera is still', () => {
    const p = page();
    p.sync.schedule();
    p.sync.schedule();
    expect(p.pending()).toBe(1);
    p.tick();
    expect(p.log).toEqual(['between']);
  });

  it('never places between the frames of the scene while the camera moves', () => {
    const p = page();
    p.state.moving = true;
    // A plate grew, the data arrived and the tags settled mid-flight: the animation frame that
    // runs before the scene's frame (or in a tick the scene does not draw) writes nothing.
    p.sync.schedule();
    p.tick();
    p.sync.cameraMoved();
    p.tick();
    expect(p.log).toEqual([]);
    // The scene's next frame places it.
    p.sync.rendered();
    expect(p.log).toEqual(['frame']);
    // And so does every frame drawn during the move, also one that raised no camera.changed.
    p.sync.rendered();
    expect(p.log).toEqual(['frame', 'frame']);
  });

  it('places a camera move in the frame that draws it and drops the pending animation frame', () => {
    const p = page();
    p.sync.cameraMoved();
    expect(p.pending()).toBe(1);
    p.sync.rendered();
    expect(p.log).toEqual(['frame']);
    expect(p.pending()).toBe(0);
    p.tick();
    expect(p.log).toEqual(['frame']);
  });

  it('leaves a frame drawn while still and up to date alone', () => {
    const p = page();
    p.sync.rendered();
    expect(p.log).toEqual([]);
  });

  it('places what was left out of date once the move ends (moveEnd moves the camera)', () => {
    const p = page();
    p.state.moving = true;
    p.sync.schedule();
    p.tick();
    expect(p.log).toEqual([]);
    p.state.moving = false;
    p.sync.cameraMoved();
    p.tick();
    expect(p.log).toEqual(['between']);
  });

  it('cancels its animation frame when disposed', () => {
    const p = page();
    p.sync.schedule();
    p.sync.dispose();
    expect(p.pending()).toBe(0);
  });
});
