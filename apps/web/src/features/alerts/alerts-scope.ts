import { create } from 'zustand';
import { useUI } from '../../stores/ui';

/**
 * Which alerts the Alertas sheet lists while an installation is chosen: that installation's, or
 * the whole network's («+n en otras instalaciones» in the annunciator opens it that way).
 */
export type AlertsScope = 'installation' | 'network';
export const useAlertsScope = create<{
  scope: AlertsScope;
  setScope: (scope: AlertsScope) => void;
}>((set) => ({ scope: 'installation', setScope: (scope) => set({ scope }) }));

// Closed and opened again (from the menu or the palette), the sheet starts with the chosen
// installation.
useUI.subscribe((state, previous) => {
  if (previous.page === 'alerts' && state.page !== 'alerts')
    useAlertsScope.getState().setScope('installation');
});
