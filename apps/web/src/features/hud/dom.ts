/** Boxes of the plates floating over the scene (`data-map-overlay`, visible ones only). */
export function overlayBoxes(root: ParentNode = document, except?: Element | null) {
  return [...root.querySelectorAll('[data-map-overlay]')]
    .filter((overlay) => {
      if (except && (overlay === except || except.contains(overlay))) return false;
      const style = getComputedStyle(overlay);
      return (
        (style.position === 'absolute' || style.position === 'fixed') &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    })
    .map((overlay) => overlay.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
}
