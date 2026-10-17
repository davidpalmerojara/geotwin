import { lazy, Suspense, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useUI } from '../../stores/ui';
import { pageTitle, type Sheet } from '../../lib/route';
import { Loading } from '../../components/common';
import { Kbd } from './glyphs';

// The sections are only downloaded when their sheet first opens (charts and tables).
const Dashboard = lazy(() =>
  import('../dashboard/dashboard').then((m) => ({ default: m.Dashboard })),
);
const Assets = lazy(() => import('../assets/assets').then((m) => ({ default: m.Assets })));
const Alerts = lazy(() => import('../alerts/alerts').then((m) => ({ default: m.Alerts })));
const Settings = lazy(() => import('../../pages/settings').then((m) => ({ default: m.Settings })));

const body: Record<Sheet, React.ComponentType> = {
  overview: Dashboard,
  assets: Assets,
  alerts: Alerts,
  settings: Settings,
};

/**
 * Resumen, Activos, Alertas and Ajustes as a sheet over the scene, under the tool bar on the left.
 * The scene underneath is never rebuilt: opening and closing a sheet only changes the URL.
 */
export function SectionSheet({ sheet }: { sheet: Sheet }) {
  const setPage = useUI((s) => s.setPage);
  const heading = useRef<HTMLHeadingElement>(null);
  const Body = body[sheet];
  // Focus moves to the sheet's title, so a screen reader announces it and Tab continues inside.
  useEffect(() => heading.current?.focus(), [sheet]);
  return (
    <section
      className="panel section-sheet"
      aria-labelledby="sheet-title"
      data-map-overlay
      data-testid="section-sheet"
      data-sheet={sheet}
    >
      <header className="panel-head">
        <h2 id="sheet-title" ref={heading} tabIndex={-1}>
          {pageTitle[sheet]}
        </h2>
        <button
          type="button"
          className="close"
          onClick={() => setPage('twin')}
          aria-label={`Cerrar ${pageTitle[sheet]}`}
        >
          <span className="close-text">Cerrar</span>
          <Kbd>Esc</Kbd>
          <X size={14} className="close-icon" aria-hidden="true" />
        </button>
      </header>
      <div className="panel-body sheet-body">
        <Suspense fallback={<Loading />}>
          <Body />
        </Suspense>
      </div>
    </section>
  );
}
