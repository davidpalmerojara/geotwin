import { create } from 'zustand';
import { useUI } from './ui';

/**
 * The viewer's active tool (keys 1–5) and the floating panel open next to the tool bar. Only one
 * panel or section sheet is open at a time: they share the same place under the tool bar.
 */
export type Tool = 'orbit' | 'measure' | 'profile' | 'cut' | 'radius';
/** Capas, or the panel of the active tool (Medir, Radio). */
export type Panel = 'layers' | 'measure' | 'radius';

/** Tools that arrive in a later step of the redesign: visible, but not usable yet. */
export const PENDING_TOOLS: Partial<Record<Tool, string>> = {
  profile: 'Llega en un paso posterior del rediseño',
  cut: 'Llega en un paso posterior del rediseño',
};
const PANEL_OF: Partial<Record<Tool, Panel>> = { measure: 'measure', radius: 'radius' };

export interface RadiusResult {
  metres: number;
  count: number;
  /** The assets found (their tags go before the other operational ones). */
  ids: string[];
}
interface ToolState {
  tool: Tool;
  panel: Panel | null;
  /** Whether the «Ir a» palette is open. */
  palette: boolean;
  /** The last «Radio» query (ST_DWithin), for the readout and the tags in the scene. */
  radius: RadiusResult | null;
  setTool: (tool: Tool) => void;
  /** Opens a panel (closing any sheet), or closes it when it is already open. */
  togglePanel: (panel: Panel) => void;
  closePanel: () => void;
  setPalette: (open: boolean) => void;
  setRadius: (radius: RadiusResult | null) => void;
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
  setTool: (tool) => {
    if (PENDING_TOOLS[tool]) return;
    const panel = PANEL_OF[tool] ?? null;
    if (panel) closeSheet();
    // Choosing a tool again goes back to orbiting, like pressing its key twice.
    if (get().tool === tool && tool !== 'orbit') set({ tool: 'orbit', panel: null });
    else set({ tool, panel: panel ?? (get().panel === 'layers' ? 'layers' : null) });
  },
  togglePanel: (panel) => {
    if (get().panel === panel) {
      get().closePanel();
      return;
    }
    closeSheet();
    // Capas replaces the tool's panel: the tool goes back to orbiting.
    set({ panel, tool: panel === 'layers' ? 'orbit' : get().tool });
  },
  closePanel: () => {
    const { panel } = get();
    if (!panel) return;
    set({ panel: null, tool: panel === 'layers' ? get().tool : 'orbit' });
  },
  setPalette: (palette) => set({ palette }),
  setRadius: (radius) => set({ radius }),
}));

// A section sheet takes the place of the panel: opening one closes the panel and its tool.
useUI.subscribe((state, previous) => {
  if (state.page === previous.page || state.page === 'twin') return;
  const { panel } = useTool.getState();
  if (panel) useTool.setState({ panel: null, tool: 'orbit' });
});
