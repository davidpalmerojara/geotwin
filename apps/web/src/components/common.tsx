import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { AssetStatus } from '@geotwin/shared';
import { Button } from './ui/button';
import { statusLabel } from '../lib/utils';
/** Status as shape, colour and word (see features/hud/glyphs.tsx). */
export function Status({ status }: { status: AssetStatus }) {
  return (
    <span className={`status status-${status}`}>
      <i className={`glyph glyph-${status}`} aria-hidden="true" />
      {statusLabel[status]}
    </span>
  );
}
export function Loading({ label = 'Cargando datos operativos…' }: { label?: string }) {
  return (
    <div className="state-box">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  return (
    <div className="state-box">
      <i className="glyph glyph-warning" aria-hidden="true" />
      <strong>No se pudieron cargar los datos</strong>
      <p>{error?.message ?? 'Comprueba la conexión con la API.'}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw size={14} aria-hidden="true" />
          Reintentar
        </Button>
      )}
    </div>
  );
}
export function Empty({ text = 'Sin resultados para este filtro.' }: { text?: string }) {
  return (
    <div className="state-box">
      <p>{text}</p>
    </div>
  );
}
