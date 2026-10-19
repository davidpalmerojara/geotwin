import { useScene } from '../../stores/viewer';
import { useLayerView } from '../../stores/layers';
import { useUI } from '../../stores/ui';
import { create } from 'zustand';
import { PNOA_UNAVAILABLE } from '../layers/base-imagery';

/** A short note that goes by itself (a key that has nothing to act on, for instance). */
const useHint = create<{ text: string }>(() => ({ text: '' }));
let hintTimer: ReturnType<typeof setTimeout> | undefined;
export function showHint(text: string, ms = 3000) {
  clearTimeout(hintTimer);
  useHint.setState({ text });
  hintTimer = setTimeout(() => useHint.setState({ text: '' }), ms);
}

/** Notes and errors over the scene, stacked above the credits plate (never over it). */
export function NotesStack() {
  const reliefHint = useScene((s) => s.reliefHint),
    mapMessage = useScene((s) => s.mapMessage),
    photoreal = useScene((s) => s.photoreal);
  const base = useLayerView((s) => s.baseImagery),
    pnoa = useLayerView((s) => s.pnoa.state);
  const connection = useUI((s) => s.connection);
  const hint = useHint((s) => s.text);
  const pnoaFailed = pnoa === 'error' && base === 'pnoa' && photoreal !== 'on';
  if (!hint && !reliefHint && !mapMessage && !pnoaFailed && connection !== 'offline') return null;
  return (
    <div className="notes-stack">
      {hint && (
        <p className="plate note" role="status" data-testid="hint" data-map-overlay>
          {hint}
        </p>
      )}
      {connection === 'offline' && (
        <p className="plate note note-warn" role="status" data-map-overlay>
          Conexión en tiempo real interrumpida. Reconectando; los datos se sincronizarán con la API.
        </p>
      )}
      {reliefHint && (
        <p className="plate note" role="note" data-testid="relief-hint" data-map-overlay>
          {reliefHint}
        </p>
      )}
      {(mapMessage || pnoaFailed) && (
        <p
          className="plate note note-warn"
          role="status"
          data-testid="map-message"
          data-map-overlay
        >
          {mapMessage || PNOA_UNAVAILABLE}
        </p>
      )}
    </div>
  );
}
