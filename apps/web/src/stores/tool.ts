import { create } from 'zustand';
import { useUI } from './ui';
import { useScene } from './viewer';
import { useSection } from './section';

/**
 * The viewer's active tool (keys 1–5) and the floating panel open next to the tool bar. Only one
 * panel or section sheet is open at a time: they share the same place under the tool bar.
 */
export type Tool = 'orbit' | 'measure' | 'profile' | 'cut' | 'radius';
/** Capas, or the panel of the active tool (Medir, Radio). */
export type Panel = 'layers' | 'measure' | 'radius';

/** Why Perfil and Corte cannot be used without the LiDAR relief (see toolBlock). */
export const RELIEF_REASON = 'Activa «Relieve del LiDAR» en Capas: lo usan Perfil y Corte';
/**
 * Why a tool cannot be used now, or null. Perfil and Corte need the LiDAR relief: without it the
 * clouds are lowered about 700 m onto the bare ellipsoid and no height would agree with them.
 */
export function toolBlock(tool: Tool, relief: boolean): string | null {
  return (tool === 'profile' || tool === 'cut') && !relief ? RELIEF_REASON : null;
}
const reliefOn = () => useScene.getState().terrain === 'lidar';
const PANEL_OF: Partial<Record<Tool, Panel>> = { measure: 'measure', radius: 'radius' };

export interface RadiusItem {
  id: string;
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  distance_m: number;
  lng: number;
  lat: number;
}
/** The radii Radio offers, in metres. */
export const RADII = [100, 250, 300, 500, 5000] as const;
export interface RadiusResult {
  metres: number;
  count: number;
  /** The assets found (their tags go before the other operational ones). */
  ids: string[];
  /** The centre of the query and the assets inside, nearest first. */
  center: { lng: number; lat: number };
  centerLabel: string;
  items: RadiusItem[];
}
interface ToolState {
  tool: Tool;
  panel: Panel | null;
  /** Whether the «Ir a» palette is open. */
  palette: boolean;
  /** The last «Radio» query (ST_DWithin), for the readout and the tags in the scene. */
  radius: RadiusResult | null;
  /** A point picked on the map as Radio's centre (instead of the selected asset). */
  radiusPoint: { lng: number; lat: number } | null;
  /** The radius Radio searches, in metres. */
  radiusMetres: number;
  setTool: (tool: Tool) => void;
  /** Opens a panel (closing any sheet), or closes it when it is already open. */
  togglePanel: (panel: Panel) => void;
  closePanel: () => void;
  setPalette: (open: boolean) => void;
  setRadius: (radius: RadiusResult | null) => void;
  setRadiusPoint: (point: { lng: number; lat: number } | null) => void;
  setRadiusMetres: (metres: number) => void;
}

const closeSheet = () => {
  const ui = useUI.getState();
  if (ui.page !== 'twin') ui.setPage('twin');
};

export const useTool = create<ToolState>((set, get) => ({
  tool: 'orbit',
  panel: null,
  palette: false,
  radius: null,
  radiusPoint: null,
  radiusMetres: 250,
  setTool: (tool) => {
    if (toolBlock(tool, reliefOn())) return;
    const section = useSection.getState();
    // Corte works on the profile line: it switches on (or off) over Perfil, which it starts.
    if (tool === 'cut') {
      if (section.cut !== 'off') {
        section.setCut('off');
        return;
      }
      section.setCut('front');
      if (get().tool !== 'profile') set({ tool: 'profile', panel: null });
      return;
    }
    const panel = PANEL_OF[tool] ?? null;
    if (panel) closeSheet();
    // Leaving Perfil drops its line and the cut.
    if (get().tool === 'profile' && tool !== 'profile') section.clear();
    // Choosing a tool again goes back to orbiting, like pressing its key twice.
    if (get().tool === tool && tool !== 'orbit') {
      if (tool === 'profile') section.clear();
      set({ tool: 'orbit', panel: null });
    } else if (tool === 'profile') set({ tool, panel: null });
    else set({ tool, panel: panel ?? (get().panel === 'layers' ? 'layers' : null) });
  },
  togglePanel: (panel) => {
    if (get().panel === panel) {
      get().closePanel();
      return;
    }
    closeSheet();
    // Capas replaces the tool's panel: the tool goes back to orbiting (but a profile stays).
    const keep = get().tool === 'profile';
    set({ panel, tool: panel === 'layers' && !keep ? 'orbit' : get().tool });
  },
  closePanel: () => {
    const { panel } = get();
    if (!panel) return;
    set({ panel: null, tool: panel === 'layers' ? get().tool : 'orbit' });
  },
  setPalette: (palette) => set({ palette }),
  setRadius: (radius) => set({ radius }),
  setRadiusPoint: (radiusPoint) => set({ radiusPoint }),
  setRadiusMetres: (radiusMetres) => set({ radiusMetres }),
}));

/** Closes Perfil (and its cut): back to orbiting. */
export function closeProfile() {
  useSection.getState().clear();
  if (useTool.getState().tool === 'profile') useTool.setState({ tool: 'orbit' });
}

// Without the relief Perfil and Corte stop: their heights would not match the lowered clouds.
useScene.subscribe((state, previous) => {
  if (state.terrain === previous.terrain || state.terrain === 'lidar') return;
  if (useTool.getState().tool === 'profile') closeProfile();
});
// Selecting an asset makes it Radio's centre again.
useUI.subscribe((state, previous) => {
  if (state.selectedAssetId !== previous.selectedAssetId && state.selectedAssetId)
    useTool.setState({ radiusPoint: null });
});

// A section sheet takes the place of the panel: opening one closes the panel and its tool (and
// the profile, whose drawer would share the scene with it).
useUI.subscribe((state, previous) => {
  if (state.page === previous.page || state.page === 'twin') return;
  const { panel, tool } = useTool.getState();
  if (tool === 'profile') useSection.getState().clear();
  if (panel || tool === 'profile') useTool.setState({ panel: null, tool: 'orbit' });
});
