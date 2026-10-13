export interface Frames {
  request: (tick: () => void) => number;
  cancel: (handle: number) => void;
  now: () => number;
}
const browserFrames: Frames = {
  request: (tick) => requestAnimationFrame(tick),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};

/**
 * In request-render mode Cesium draws only when asked, but entity lines and polygons are built
 * over several frames (on a busy machine, seconds). Asks for a frame on every animation frame
 * until `isReady()` has held for `settleFrames` frames in a row (the first answers can be stale,
 * from before the next update), so the finished geometry is drawn; gives up after `maxMs`. Returns a function that stops it early.
 */
export function renderUntil(
  requestRender: () => void,
  isReady: () => boolean,
  { maxMs = 20000, settleFrames = 5, frames = browserFrames } = {},
) {
  const until = frames.now() + maxMs;
  let remaining = settleFrames,
    handle = 0,
    stopped = false;
  const tick = () => {
    if (stopped) return;
    requestRender();
    remaining = isReady() ? remaining - 1 : settleFrames;
    if (remaining > 0 && frames.now() < until) handle = frames.request(tick);
    else stopped = true;
  };
  handle = frames.request(tick);
  return () => {
    stopped = true;
    frames.cancel(handle);
  };
}
