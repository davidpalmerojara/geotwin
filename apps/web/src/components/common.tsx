import { AlertCircle, LoaderCircle, Radio, RefreshCw } from 'lucide-react';
import type { AssetStatus } from '@geotwin/shared';
import { Button } from './ui/button';
import { statusLabel } from '../lib/utils';
export function Status({ status }: { status: AssetStatus }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {statusLabel[status]}
    </span>
  );
}
export function Loading({ label = 'Cargando datos operativos…' }: { label?: string }) {
  return (
    <div className="state-box">
      <LoaderCircle className="animate-spin text-cyan-400" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  return (
    <div className="state-box">
      <AlertCircle className="text-red-400" size={26} />
      <strong>No se pudieron cargar los datos</strong>
      <p>{error?.message ?? 'Comprueba la conexión con la API.'}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw size={14} />
          Reintentar
        </Button>
      )}
    </div>
  );
}
export function Empty({ text = 'Sin resultados para este filtro.' }: { text?: string }) {
  return (
    <div className="state-box">
      <Radio size={24} />
      <p>{text}</p>
    </div>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
