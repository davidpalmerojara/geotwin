import { create } from 'zustand';
import {
  ALL_CLASS_GROUPS,
  displayDefaults,
  type ClassGroup,
  type ColorMode,
  type PointMode,
  type Quality,
} from '../features/layers/point-style';
import type { BaseImagery, PnoaSourceId, PnoaState } from '../features/layers/base-imagery';

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
  // Eye-dome lighting: shading at depth steps (off by default, see shadingFor).
  edl: boolean;
  // Draw at the real ellipsoidal height even on the bare globe (no relief terrain).
  realHeight: boolean;
  // Use the layers' ground models (DTM) as the globe's terrain when there is no ion terrain.
  lidarTerrain: boolean;
  // What lies under the clouds: the PNOA orthophoto (when it loads) or the Natural Earth atlas.
  baseImagery: BaseImagery;
  // «Todos» or «Híbrido (sin suelo)»: ground and water hidden, so the ground is the orthophoto.
  pointMode: PointMode;
  // Reported by the viewer: is the orthophoto loading, shown, or unavailable, and from where.
  pnoa: { state: PnoaState; source?: PnoaSourceId };
  // A fly-to request; `n` makes repeated requests for the same layer distinct.
  flyTo: { id: string; n: number } | null;
  render: Record<string, RenderState>;
  toggle: (id: string) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleClass: (group: ClassGroup) => void;
  setPointSize: (size: number) => void;
  setQuality: (quality: Quality) => void;
  setEdl: (value: boolean) => void;
  setRealHeight: (value: boolean) => void;
  setLidarTerrain: (value: boolean) => void;
  setBaseImagery: (value: BaseImagery) => void;
  setPointMode: (mode: PointMode) => void;
  setPnoa: (pnoa: { state: PnoaState; source?: PnoaSourceId }) => void;
  requestFlyTo: (id: string) => void;
  setRender: (id: string, state: RenderState | null) => void;
}
/** What this device can take: phones and small screens start lighter (see displayDefaults). */
function deviceDefaults() {
  if (typeof window === 'undefined' || !window.matchMedia)
    return displayDefaults({ narrow: false, coarsePointer: false });
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return displayDefaults({
    narrow: window.matchMedia('(max-width: 950px)').matches,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    memoryGB: memory,
  });
}
const initial = deviceDefaults();
const initialBase: BaseImagery =
  import.meta.env.VITE_BASE_IMAGERY === 'natural-earth' ? 'natural-earth' : 'pnoa';
export const useLayerView = create<LayerViewState>((set) => ({
  hidden: {},
  colorMode: 'rgb',
  classes: { ...ALL_CLASS_GROUPS },
  pointSize: initial.pointSize,
  quality: initial.quality,
  edl: false,
  realHeight: false,
  lidarTerrain: true,
  baseImagery: initialBase,
  pointMode: 'all',
  pnoa: { state: 'off' },
  flyTo: null,
  render: {},
  toggle: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: !s.hidden[id] } })),
  setColorMode: (colorMode) => set({ colorMode }),
  toggleClass: (group) => set((s) => ({ classes: { ...s.classes, [group]: !s.classes[group] } })),
  setPointSize: (pointSize) => set({ pointSize }),
  setQuality: (quality) => set({ quality }),
  setEdl: (edl) => set({ edl }),
  setRealHeight: (realHeight) => set({ realHeight }),
  setLidarTerrain: (lidarTerrain) => set({ lidarTerrain }),
  setBaseImagery: (baseImagery) => set({ baseImagery }),
  // Without the relief the photo lies on the ellipsoid, far below the cloud: hybrid turns it on
  // (and leaves it on when switched off again).
  setPointMode: (pointMode) =>
    set(pointMode === 'hybrid' ? { pointMode, lidarTerrain: true } : { pointMode }),
  setPnoa: (pnoa) => set({ pnoa }),
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
