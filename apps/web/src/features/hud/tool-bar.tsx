import { useLayers } from '../../hooks/data';
import { useLayerView } from '../../stores/layers';
import { PENDING_TOOLS, useTool, type Tool } from '../../stores/tool';
import { Kbd } from './glyphs';

const TOOLS: [Tool, string, string][] = [
  ['orbit', '1', 'Orbitar'],
  ['measure', '2', 'Medir'],
  ['profile', '3', 'Perfil'],
  ['cut', '4', 'Corte'],
  ['radius', '5', 'Radio'],
];
export const toolButtonId = (tool: Tool | 'layers') => `tool-${tool}`;

/**
 * The tool keys (1–5) and Capas (C) under the place plate. The active tool is inverted (light
 * fill, dark text), never yellow. Perfil and Corte are shown but not usable yet, with the reason.
 */
export function ToolBar() {
  const tool = useTool((s) => s.tool),
    panel = useTool((s) => s.panel),
    setTool = useTool((s) => s.setTool),
    togglePanel = useTool((s) => s.togglePanel);
  const layers = (useLayers().data ?? []).filter((l) => l.status === 'ready');
  const hidden = useLayerView((s) => s.hidden);
  const shown = layers.filter((l) => !hidden[l.id]).length;
  return (
    <nav className="plate tool-bar" aria-label="Herramientas del visor" data-map-overlay>
      {TOOLS.map(([id, key, label]) => {
        const pending = PENDING_TOOLS[id];
        return (
          <button
            key={id}
            id={toolButtonId(id)}
            type="button"
            className={`soft-key ${tool === id ? 'on' : ''}`}
            aria-label={label}
            aria-pressed={tool === id}
            aria-keyshortcuts={key}
            aria-disabled={pending ? true : undefined}
            aria-describedby={pending ? 'pending-tools' : undefined}
            title={pending ? `${label}: ${pending.toLowerCase()}` : `${label} (tecla ${key})`}
            onClick={() => !pending && setTool(id)}
          >
            <Kbd>{key}</Kbd>
            <span className="soft-label">{label}</span>
          </button>
        );
      })}
      <span id="pending-tools" hidden>
        {PENDING_TOOLS.profile}
      </span>
      <i className="soft-sep" aria-hidden="true" />
      <button
        id={toolButtonId('layers')}
        type="button"
        className={`soft-key ${panel === 'layers' ? 'on' : ''}`}
        aria-label="Capas"
        aria-expanded={panel === 'layers'}
        aria-controls={panel === 'layers' ? 'panel-layers' : undefined}
        aria-keyshortcuts="C"
        title="Capas (tecla C)"
        onClick={() => togglePanel('layers')}
      >
        <Kbd>C</Kbd>
        <span className="soft-label">Capas</span>
        {layers.length > 0 && (
          <span className="soft-count num" aria-hidden="true">
            {shown}/{layers.length}
          </span>
        )}
      </button>
    </nav>
  );
}
