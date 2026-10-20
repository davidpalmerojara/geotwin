/**
 * When something that follows the scene (the edge chips) is placed. While the camera moves it is
 * placed only in the frames the scene draws (after their render, before the browser paints
 * them), so it moves together with the labels and tags it keeps off. Between those frames a
 * change of the page (a panel opening, a plate growing, the data) only marks it out of date, and
 * the next frame of the scene places it. While the camera is still, nothing in the scene moves:
 * such a change is placed in the next animation frame, which also covers a change that draws no
 * frame of the scene.
 */
export interface FrameSyncHooks {
  /** Places it; `inFrame` is true inside a frame of the scene. */
  place: (inFrame: boolean) => void;
  /** Whether the camera is moving (between Cesium's moveStart and moveEnd). */
  moving: () => boolean;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

export interface FrameSync {
  /** The page changed: place it again as soon as that is right. */
  schedule: () => void;
  /** The camera moved (a `camera.changed` or `moveEnd`). */
  cameraMoved: () => void;
  /** A frame of the scene has just been rendered. */
  rendered: () => void;
  dispose: () => void;
}

export function frameSync(hooks: FrameSyncHooks): FrameSync {
  let frame = 0;
  // Out of date since the last placement.
  let dirty = false;
  const place = (inFrame: boolean) => {
    if (frame) hooks.cancelFrame(frame);
    frame = 0;
    dirty = false;
    hooks.place(inFrame);
  };
  const schedule = () => {
    dirty = true;
    if (frame) return;
    frame = hooks.requestFrame(() => {
      frame = 0;
      // Mid-flight the scene draws again soon, and that frame places it.
      if (dirty && !hooks.moving()) place(false);
    });
  };
  return {
    schedule,
    cameraMoved: schedule,
    rendered: () => {
      // Every frame drawn during a move: a small move does not raise `camera.changed`
      // (percentageChanged), yet the labels and tags move in that frame.
      if (dirty || hooks.moving()) place(true);
    },
    dispose: () => {
      if (frame) hooks.cancelFrame(frame);
      frame = 0;
    },
  };
}
