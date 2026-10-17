import { useEffect } from 'react';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useScene } from '../../stores/viewer';
import { shortcutFor, shortcutsEnabled } from './shortcuts';

/** A Radix dialog (modal) is open: it handles its own keys. */
const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]');

/**
 * Binds the HUD's keys: 1–5 tools, C Capas, 0 framing, N north up, / and Ctrl/⌘+K «Ir a», and
 * Esc, which closes the top-most thing: the panel, then the sheet, then the asset card.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = shortcutFor(event, { enabled: shortcutsEnabled(), modal: modalOpen() });
      if (!action) return;
      const tool = useTool.getState(),
        ui = useUI.getState(),
        api = useScene.getState().api;
      switch (action) {
        case 'escape':
          if (tool.panel) tool.closePanel();
          else if (ui.page !== 'twin') ui.setPage('twin');
          else if (ui.selectedAssetId) ui.selectAsset(null);
          else return;
          break;
        case 'palette':
          tool.setPalette(true);
          break;
        case 'layers':
          tool.togglePanel('layers');
          break;
        case 'home':
          api?.home();
          break;
        case 'north':
          api?.northUp();
          break;
        default:
          tool.setTool(action);
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
