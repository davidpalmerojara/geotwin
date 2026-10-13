import { create } from 'zustand';

/** Whether the measuring tool is open: while it is, clicks on the map add points, not select. */
export const useMeasure = create<{ active: boolean; setActive: (active: boolean) => void }>(
  (set) => ({ active: false, setActive: (active) => set({ active }) }),
);
