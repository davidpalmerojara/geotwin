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
