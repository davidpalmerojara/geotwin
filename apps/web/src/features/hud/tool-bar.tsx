import { useLayers } from '../../hooks/data';
import { useLayerView } from '../../stores/layers';
import { toolBlock, useTool, RELIEF_REASON, type Tool } from '../../stores/tool';
import { useSection } from '../../stores/section';
import { useScene } from '../../stores/viewer';
import { Kbd } from './glyphs';

const TOOLS: [Tool, string, string][] = [
  ['orbit', '1', 'Orbitar'],
  ['measure', '2', 'Medir'],
  ['profile', '3', 'Perfil'],
  ['cut', '4', 'Corte'],
  ['radius', '5', 'Radio'],
];
export const toolButtonId = (tool: Tool | 'layers') => `tool-${tool}`;

/** Which tool keys show as on: Corte is a switch over Perfil, so both can be on. */
function useToolState() {
  const tool = useTool((s) => s.tool),
    cut = useSection((s) => s.cut !== 'off'),
    relief = useScene((s) => s.terrain === 'lidar');
  return {
    on: (id: Tool) => (id === 'cut' ? cut : tool === id),
    block: (id: Tool) => toolBlock(id, relief),
  };
}

/**
 * The tool keys (1–5) and Capas (C) under the place plate: key and name on a desktop, key and
 * icon on a tablet (the name in the title and the accessible name). The active tool is inverted
 * (light fill, dark text), never yellow. Without the LiDAR relief Perfil and Corte are shown disabled,
 * with the reason.
 */
export function ToolBar() {
  const { on, block } = useToolState();
  const panel = useTool((s) => s.panel),
    setTool = useTool((s) => s.setTool),
    togglePanel = useTool((s) => s.togglePanel);
  const layers = (useLayers().data ?? []).filter((l) => l.status === 'ready');
  const hidden = useLayerView((s) => s.hidden);
  const shown = layers.filter((l) => !hidden[l.id]).length;
  return (
    <nav className="plate tool-bar" aria-label="Herramientas del visor" data-map-overlay>
      {TOOLS.map(([id, key, label]) => {
        const blocked = block(id);
        return (
          <button
            key={id}
            id={toolButtonId(id)}
            type="button"
            className={`soft-key ${on(id) ? 'on' : ''}`}
            aria-label={label}
            aria-pressed={on(id)}
            aria-keyshortcuts={key}
            aria-disabled={blocked ? true : undefined}
            aria-describedby={blocked ? 'blocked-tools' : undefined}
            title={blocked ? `${label}: ${blocked}` : `${label} (tecla ${key})`}
            onClick={() => !blocked && setTool(id)}
          >
            <Kbd>{key}</Kbd>
            <ToolIcon tool={id} className="soft-icon" size={16} />
            <span className="soft-label">{label}</span>
          </button>
        );
      })}
      <span id="blocked-tools" hidden>
        {RELIEF_REASON}
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
        <ToolIcon tool="layers" className="soft-icon" size={16} />
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

/** The A phone mockup's tool icons (20 px line drawings). */
const ICONS: Record<Tool | 'layers', React.ReactNode> = {
  orbit: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M10 1v5M10 14v5M1 10h5M14 10h5" />
    </>
  ),
  measure: <path d="M3 15 15 3M3 15l2.2 2.2M15 3l2.2 2.2M6 12l1.4 1.4M9 9l1.4 1.4M12 6l1.4 1.4" />,
  profile: <path d="M2 16h16M2 16V9l4-4 4 6 3-3 5 3v5" />,
  cut: (
    <>
      <path d="M5 2v16M15 2v16" />
      <path d="M5 6h10M5 10h10M5 14h10" strokeWidth="1" strokeDasharray="2 2" />
    </>
  ),
  radius: <circle cx="10" cy="10" r="7" strokeDasharray="3 2" />,
  layers: <path d="M10 3 18 7 10 11 2 7Z M2 11l8 4 8-4M2 15l8 4 8-4" />,
};
function ToolIcon({
  tool,
  className = '',
  size = 20,
}: {
  tool: Tool | 'layers';
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={`tool-icon ${className}`}
      aria-hidden="true"
    >
      {ICONS[tool]}
    </svg>
  );
}

/**
 * The phone's tool bar, floating at the bottom: Orbitar, Medir, Perfil, Corte and Capas, each
 * with icon and name and at least 44 px to tap. The active one has a light bar and bold text
 * (never yellow). There is no Radio key: the asset sheet's «Cercanos y radio» starts it.
 */
export function PhoneToolBar() {
  const { on: isOn, block } = useToolState();
  const panel = useTool((s) => s.panel),
    setTool = useTool((s) => s.setTool),
    togglePanel = useTool((s) => s.togglePanel);
  return (
    <nav className="plate phone-tools" aria-label="Herramientas del visor" data-map-overlay>
      {TOOLS.filter(([id]) => id !== 'radius').map(([id, , label]) => {
        const blocked = block(id);
        const on = isOn(id) && panel !== 'layers';
        return (
          <button
            key={id}
            id={toolButtonId(id)}
            type="button"
            className={`phone-key ${on ? 'on' : ''}`}
            aria-pressed={on}
            aria-disabled={blocked ? true : undefined}
            aria-describedby={blocked ? 'blocked-tools' : undefined}
            title={blocked ? `${label}: ${blocked}` : label}
            onClick={() => !blocked && setTool(id)}
          >
            <ToolIcon tool={id} />
            {label}
          </button>
        );
      })}
      <span id="blocked-tools" hidden>
        {RELIEF_REASON}
      </span>
      <button
        id={toolButtonId('layers')}
        type="button"
        className={`phone-key ${panel === 'layers' ? 'on' : ''}`}
        aria-expanded={panel === 'layers'}
        aria-controls={panel === 'layers' ? 'panel-layers' : undefined}
        onClick={() => togglePanel('layers')}
      >
        <ToolIcon tool="layers" />
        Capas
      </button>
    </nav>
  );
}
