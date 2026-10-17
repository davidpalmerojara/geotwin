import { useTool, type Tool } from './tool';

/**
 * Whether a tool that picks on the map is on (Medir, Perfil): while it is, clicks on the map add
 * points, not select.
 */
export const isMeasuring = (state: { tool: Tool }) =>
  state.tool === 'measure' || state.tool === 'profile';
export const measuring = () => isMeasuring(useTool.getState());
