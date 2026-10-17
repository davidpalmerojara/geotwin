/**
 * Boxes of the plates floating over the scene (`data-map-overlay`), visible ones only. Every plate
 * floats: the ones in a column (place plate and tool bar, readout and credits) are positioned
 * inside it, so position is not a test of floating any more.
 */
export function overlayBoxes(root: ParentNode = document, except?: Element | null) {
  return [...root.querySelectorAll('[data-map-overlay]')]
    .filter((overlay) => {
      if (except && (overlay === except || except.contains(overlay))) return false;
      const style = getComputedStyle(overlay);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map((overlay) => overlay.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
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
