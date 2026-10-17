import { useScene } from '../../stores/viewer';
import { useLayerView } from '../../stores/layers';
import { useUI } from '../../stores/ui';
import { PNOA_UNAVAILABLE } from '../layers/base-imagery';

/** Notes and errors over the scene, stacked above the credits plate (never over it). */
export function NotesStack() {
  const reliefHint = useScene((s) => s.reliefHint),
    mapMessage = useScene((s) => s.mapMessage),
    photoreal = useScene((s) => s.photoreal);
  const base = useLayerView((s) => s.baseImagery),
    pnoa = useLayerView((s) => s.pnoa.state);
  const connection = useUI((s) => s.connection);
  const pnoaFailed = pnoa === 'error' && base === 'pnoa' && photoreal !== 'on';
  if (!reliefHint && !mapMessage && !pnoaFailed && connection !== 'offline') return null;
  return (
    <div className="notes-stack">
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
