import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Kbd } from './glyphs';

/**
 * A panel that opens under the tool bar, aligned with its left edge (where the A and C mockups
 * dock Capas), so the camera framing can count it as covering the left of the scene. It never runs
 * below the bottom plates (the credits stay visible) and scrolls inside. Esc and «Cerrar» close it
 * and give the focus back to the button that opened it (Esc is handled by use-shortcuts.ts).
 */
export function FloatingPanel({
  id,
  anchorId,
  label,
  title,
  extra,
  width,
  onClose,
  children,
  className = '',
}: {
  id: string;
  /** The id of the button that opened it, which gets the focus back. */
  anchorId: string;
  label: string;
  title: ReactNode;
  extra?: ReactNode;
  width: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  // Back to the button when the panel goes away with the focus inside it (or on the page body).
  useEffect(() => {
    const element = panel.current;
    return () => {
      // A remount in development (StrictMode) keeps the element on the page: not a close.
      if (element?.isConnected) return;
      const active = document.activeElement;
      if (!active || active === document.body || element?.contains(active))
        requestAnimationFrame(() => document.getElementById(anchorId)?.focus());
    };
  }, [anchorId]);
  return (
    <section
      ref={panel}
      id={id}
      className={`panel floating-panel ${className}`}
      style={{ width }}
      aria-label={label}
      data-map-overlay
    >
      <header className="panel-head">
        <h2>{title}</h2>
        {extra}
        <button type="button" className="close" onClick={onClose} aria-label={`Cerrar ${label}`}>
          <span className="close-text">Cerrar</span>
          <Kbd>Esc</Kbd>
          <X size={14} className="close-icon" aria-hidden="true" />
        </button>
      </header>
      <div className="panel-body" id={`${id}-body`}>
        {children}
      </div>
    </section>
  );
}
