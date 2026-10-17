import { useTool, type Tool } from './tool';

/** Whether the measuring tool is on: while it is, clicks on the map add points, not select. */
export const isMeasuring = (state: { tool: Tool }) => state.tool === 'measure';
export const measuring = () => isMeasuring(useTool.getState());
