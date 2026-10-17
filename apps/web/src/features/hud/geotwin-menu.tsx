import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useSummary } from '../../hooks/data';
import { useUI, type Page } from '../../stores/ui';
import { pageTitle } from '../../lib/route';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Kbd } from './glyphs';
import { SHORTCUTS } from './shortcuts';

const MENU: Page[] = ['twin', 'overview', 'assets', 'alerts', 'settings'];

/**
 * The GeoTwin menu (desktop) or Menú (phone): the sections, the shortcut list and the API docs.
 * It closes on Esc (the focus goes back to its button) and on a click elsewhere.
 */
export function GeoTwinMenu({
  open,
  setOpen,
  trigger,
  extra,
  className = '',
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
  /** More entries after the sections (the phone adds «Encuadre inicial»). */
  extra?: ReactNode;
  className?: string;
}) {
  const page = useUI((s) => s.page),
    setPage = useUI((s) => s.setPage);
  const summary = useSummary().data;
  const [shortcuts, setShortcuts] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, setOpen, trigger]);
  const go = (target: Page) => {
    setOpen(false);
    setPage(target);
  };
  return (
    <>
      {open && (
        <div className={`menu plate ${className}`} id="geotwin-menu" ref={menu}>
          <nav aria-label="Secciones">
            {MENU.map((p) => (
              <button
                key={p}
                type="button"
                aria-current={page === p ? 'page' : undefined}
                onClick={() => go(p)}
              >
                {pageTitle[p]}
                {p === 'alerts' && !!summary?.active_alerts && (
                  <span className="menu-count num" aria-hidden="true">
                    {summary.active_alerts}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="menu-rule" />
          {extra}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setShortcuts(true);
            }}
          >
            Atajos de teclado
          </button>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            Documentación de la API <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        </div>
      )}
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent>
          <DialogTitle className="dialog-title">Atajos de teclado</DialogTitle>
          <DialogDescription className="dialog-description">
            Funcionan en toda la página salvo al escribir en un campo. Se pueden apagar en Ajustes.
          </DialogDescription>
          <ShortcutList />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The keys and what they do (the menu's dialog and Ajustes › Atajos). */
export function ShortcutList() {
  return (
    <dl className="shortcut-list">
      {SHORTCUTS.map(([key, label]) => (
        <div key={key}>
          <dt>
            <Kbd>{key}</Kbd>
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}
