import { create } from 'zustand';
import {
  ALL_CLASS_GROUPS,
  type ClassGroup,
  type ColorMode,
  type Quality,
} from '../features/layers/point-style';

// What the 3D viewer reports back for each layer it draws.
export type RenderState = 'loading' | 'shown' | 'error';

/**
 * Display state of the LiDAR layers, shared by the "Capas" panel (light, always loaded) and the
 * Cesium viewer (lazy chunk). The layers themselves live in the query cache.
 */
interface LayerViewState {
  hidden: Record<string, boolean>;
  colorMode: ColorMode;
  classes: Record<ClassGroup, boolean>;
  pointSize: number;
  quality: Quality;
  // Draw at the real ellipsoidal height even on the bare globe (no relief terrain).
  realHeight: boolean;
  // A fly-to request; `n` makes repeated requests for the same layer distinct.
  flyTo: { id: string; n: number } | null;
  render: Record<string, RenderState>;
  toggle: (id: string) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleClass: (group: ClassGroup) => void;
  setPointSize: (size: number) => void;
  setQuality: (quality: Quality) => void;
  setRealHeight: (value: boolean) => void;
  requestFlyTo: (id: string) => void;
  setRender: (id: string, state: RenderState | null) => void;
}
export const useLayerView = create<LayerViewState>((set) => ({
  hidden: {},
  colorMode: 'rgb',
  classes: { ...ALL_CLASS_GROUPS },
  pointSize: 3,
  quality: 'medium',
  realHeight: false,
  flyTo: null,
  render: {},
  toggle: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: !s.hidden[id] } })),
  setColorMode: (colorMode) => set({ colorMode }),
  toggleClass: (group) => set((s) => ({ classes: { ...s.classes, [group]: !s.classes[group] } })),
  setPointSize: (pointSize) => set({ pointSize }),
  setQuality: (quality) => set({ quality }),
  setRealHeight: (realHeight) => set({ realHeight }),
  requestFlyTo: (id) => set((s) => ({ flyTo: { id, n: (s.flyTo?.n ?? 0) + 1 } })),
  setRender: (id, state) =>
    set((s) => {
      if (state === null) {
        if (!(id in s.render)) return s;
        const render = { ...s.render };
        delete render[id];
        return { render };
      }
      return s.render[id] === state ? s : { render: { ...s.render, [id]: state } };
    }),
}));
