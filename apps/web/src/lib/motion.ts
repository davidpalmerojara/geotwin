/** Whether the user asked the system for less motion (prefers-reduced-motion). */
export function reducedMotion() {
  try {
    return (
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** A camera flight's length in seconds: none (a cut) when the user asked for less motion. */
export const flightSeconds = (seconds: number) => (reducedMotion() ? 0 : seconds);
