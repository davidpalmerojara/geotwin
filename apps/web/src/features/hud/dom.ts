/** Boxes of the visible elements that match `selector`. */
function visibleBoxes(selector: string, root: ParentNode, except?: Element | null) {
  return [...root.querySelectorAll(selector)]
    .filter((element) => {
      if (except && (element === except || except.contains(element))) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
}

/**
 * Boxes of the plates floating over the scene (`data-map-overlay`), visible ones only. Every plate
 * floats: the ones in a column (place plate and tool bar, readout and credits) are positioned
 * inside it, so position is not a test of floating any more.
 */
export function overlayBoxes(root: ParentNode = document, except?: Element | null) {
  return visibleBoxes('[data-map-overlay]', root, except);
}

/**
 * What the labels drawn in the scene (asset tags, installation labels) keep clear of: the plates
 * and the edge chips. The chips are not plates (the framing and the chips themselves must not
 * count them), but they move when a panel opens and would otherwise land on a tag.
 */
export function sceneBlockers(root: ParentNode = document) {
  return visibleBoxes('[data-map-overlay], .edge-chip', root);
}

/**
 * Gives the focus back to the button that opened a panel or sheet that has just closed. It is
 * moved at once: waiting for the next animation frame is not enough under a slow renderer, where
 * the frame that redraws the uncovered scene can take seconds and the focus would sit on the page
 * body meanwhile. Only if the button cannot take it yet (still hidden behind a modal sheet that is
 * going away) does it try again on the next frame.
 */
export function focusBack(anchorId: string, doc: Pick<Document, 'getElementById'> = document) {
  const give = () => {
    const button = doc.getElementById(anchorId);
    if (!button) return true;
    button.focus();
    return button.ownerDocument.activeElement === button;
  };
  if (!give()) requestAnimationFrame(() => void give());
}

/**
 * Calls `done` once `read()` has given the same answer twice in a row, `interval` ms apart (the
 * plates have stopped moving: a card docking, a sheet loading its list), or after `max` ms at
 * the latest. Returns a function that cancels the wait.
 */
export function whenSteady(read: () => string, done: () => void, interval = 400, max = 6000) {
  let last = read(),
    waited = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    waited += interval;
    const now = read();
    if (now === last || waited >= max) {
      timer = undefined;
      done();
      return;
    }
    last = now;
    timer = setTimeout(tick, interval);
  };
  timer = setTimeout(tick, interval);
  return () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
}

/** The plates' boxes as a string, rounded to whole pixels: what `whenSteady` compares. */
export const platesKey = (root: ParentNode = document) =>
  overlayBoxes(root)
    .map(
      (b) =>
        `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`,
    )
    .join(';');

/**
 * Gives the focus to the 3D scene (its keyboard surface): where it goes when the asset card
 * closes, as no button opened the card. On the next frame too if the scene cannot take it yet.
 */
export function focusScene(doc: Pick<Document, 'querySelector'> = document) {
  const give = () => {
    const scene = doc.querySelector<HTMLElement>('.cesium-host');
    if (!scene) return true;
    scene.focus({ preventScroll: true });
    return scene.ownerDocument.activeElement === scene;
  };
  if (!give()) requestAnimationFrame(() => void give());
}
