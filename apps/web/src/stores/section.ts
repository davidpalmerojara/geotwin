import { create } from 'zustand';
import { SECTION_LIMITS } from '@geotwin/shared';

/**
 * State of tools 3 (Perfil A–B) and 4 (Corte), shared by the drawer (plain React) and the scene
 * side (Cesium, in the lazy chunk). A and B are on the ground, in degrees.
 */
export interface LngLat {
  lng: number;
  lat: number;
}
/** The cut: off; clip what is in front of the line; also dim or hide what is off the slab. */
export type CutMode = 'off' | 'front' | 'dim' | 'hide';
export type ProfileColor = 'rgb' | 'class';
export const EXAGGERATIONS = [1, 2, 5] as const;
export type Exaggeration = (typeof EXAGGERATIONS)[number];
/** Slab half-widths offered by [ and ] (metres). */
export const HALF_STEPS = [0.25, 0.5, 1, 1.5, 2.5, 5] as const;

/** What the scene draws of the profile once its points are in (from the drawer). */
export interface SectionSummary {
  /** Buildings crossed: where along A–B, and roof and ground as altitudes. */
  buildings: { label: string; at: number; roof: number; ground: number; height: number }[];
  /** Highest altitude of the points (the top of the cut plane). */
  top: number | null;
  /** N of the layer (altitude + N = ellipsoidal height). */
  geoid: number;
  count: number;
}

interface SectionState {
  a: LngLat | null;
  b: LngLat | null;
  /** Half-width of the slab in metres (the profile shows points within ±half of A–B). */
  half: number;
  cut: CutMode;
  color: ProfileColor;
  exaggeration: Exaggeration;
  /** Distance from A (m) under the cursor, in the drawer or along the line in the scene. */
  cursor: number | null;
  summary: SectionSummary | null;
  /** A or B is being dragged (the queries wait for the drop). */
  dragging: boolean;
  /** Pick A, then B; a third click starts a new line from A. */
  place: (point: LngLat) => void;
  move: (which: 'a' | 'b', point: LngLat) => void;
  clear: () => void;
  widen: (direction: 1 | -1) => void;
  setCut: (cut: CutMode) => void;
  setColor: (color: ProfileColor) => void;
  setExaggeration: (value: Exaggeration) => void;
  setCursor: (s: number | null) => void;
  setSummary: (summary: SectionSummary | null) => void;
  setDragging: (dragging: boolean) => void;
}

export const useSection = create<SectionState>((set, get) => ({
  a: null,
  b: null,
  half: SECTION_LIMITS.defaultHalfM,
  cut: 'off',
  color: 'rgb',
  exaggeration: 1,
  cursor: null,
  summary: null,
  dragging: false,
  place: (point) => {
    const { a, b } = get();
    if (!a || b) set({ a: point, b: null, cursor: null, summary: null });
    else set({ b: point });
  },
  move: (which, point) => set({ [which]: point }),
  clear: () => set({ a: null, b: null, cut: 'off', cursor: null, summary: null, dragging: false }),
  widen: (direction) => {
    const { half } = get();
    const i = HALF_STEPS.findIndex((h) => h >= half - 1e-9);
    const next = HALF_STEPS[Math.min(HALF_STEPS.length - 1, Math.max(0, i + direction))]!;
    set({ half: next });
  },
  setCut: (cut) => set({ cut }),
  setColor: (color) => set({ color }),
  setExaggeration: (exaggeration) => set({ exaggeration }),
  setCursor: (cursor) => set({ cursor }),
  setSummary: (summary) => set({ summary }),
  setDragging: (dragging) => set({ dragging }),
}));
