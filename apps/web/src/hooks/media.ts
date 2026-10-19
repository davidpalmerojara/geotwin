import { useSyncExternalStore } from 'react';

/** Phones: under 640 px wide (the A phone mockup is 390 × 844). */
export const PHONE_QUERY = '(max-width: 639px)';

const matches = (query: string) =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;

function useMedia(query: string) {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', changed);
      return () => list.removeEventListener('change', changed);
    },
    () => matches(query),
    () => false,
  );
}

/** Whether the screen is phone-sized: the HUD lays out as a top plate, a tool bar and sheets. */
export const usePhone = () => useMedia(PHONE_QUERY);

/** Screens tall enough for the long «Cota m» ruler (A/desktop-capas draws it 468 px high at 900). */
export const useTallScreen = () => useMedia('(min-height: 820px)');
