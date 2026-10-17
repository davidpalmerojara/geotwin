import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isModal, releaseSnap, sheetTop, snapForKey, trapTarget, type Snap } from './sheet';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A phone bottom sheet that rests at a few heights («snaps», in % of the screen). Drag its handle
 * (or the header) to move it, or focus the handle and use the arrows, Home and End. At 90 % it
 * is a modal dialog: the focus stays inside and the plates behind it hide; lower it is a region
 * beside the scene. The credits plate always sits just above it (the sheet tells the HUD where
 * its top edge is through `--sheet-top`). Esc is handled by use-shortcuts.ts, like on desktop.
 */
export function BottomSheet({
  id,
  label,
  labelledBy,
  snaps,
  snap,
  onSnap,
  onClose,
  anchorId,
  className = '',
  testId,
  attrs,
  head,
  children,
}: {
  id?: string;
  label: string;
  labelledBy?: string;
  snaps: readonly Snap[];
  snap: Snap;
  onSnap: (snap: Snap) => void;
  onClose?: () => void;
  /** The button that opened it, which gets the focus back when it closes. */
  anchorId?: string;
  className?: string;
  testId?: string;
  /** More data attributes for the section (data-sheet). */
  attrs?: Record<string, string>;
  /** The header (title, extra and close button); dragging it moves the sheet too. */
  head?: ReactNode;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLElement>(null),
    body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const modal = drag === null && isModal(snap);
  const min = Math.min(...snaps),
    max = Math.max(...snaps);

  // The HUD places the credits and notes above the sheet, and hides the plates behind a modal.
  useLayoutEffect(() => {
    const hud = sheet.current?.closest<HTMLElement>('.hud');
    if (!hud) return;
    hud.style.setProperty('--sheet-top', drag !== null ? `${drag}px` : `${100 - snap}%`);
    if (modal) hud.dataset.modal = 'true';
    else delete hud.dataset.modal;
  }, [snap, drag, modal]);
  useLayoutEffect(() => {
    const element = sheet.current;
    return () => {
      const hud =
        element?.closest<HTMLElement>('.hud') ?? document.querySelector<HTMLElement>('.hud');
      // React runs this before it takes the sheet out of the page; another sheet may already be
      // there (they replace each other in one render) and keeps its own values.
      const other = [...(hud?.querySelectorAll('.bottom-sheet') ?? [])].some((s) => s !== element);
      if (hud && !other) {
        hud.style.removeProperty('--sheet-top');
        delete hud.dataset.modal;
      }
    };
  }, []);

  // Going modal moves the focus inside; closing gives it back to the button that opened it.
  useEffect(() => {
    if (!modal) return;
    const element = sheet.current;
    if (element && !element.contains(document.activeElement))
      element.querySelector<HTMLElement>('h2[tabindex], h2, [role="slider"]')?.focus();
  }, [modal]);
  useEffect(() => {
    const element = sheet.current;
    return () => {
      if (!anchorId || element?.isConnected) return;
      const active = document.activeElement;
      if (!active || active === document.body || element?.contains(active))
        requestAnimationFrame(() => document.getElementById(anchorId)?.focus());
    };
  }, [anchorId]);

  // Dragging: the top edge follows the finger; on release it rests at a snap (or closes).
  const start = useRef<{
    y: number;
    top: number;
    lastY: number;
    lastT: number;
    prevY: number;
    prevT: number;
  }>(null);
  // A drag ends with a click on the handle: that click is not a tap.
  const dragged = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragged.current = false;
    const target = event.target as HTMLElement;
    // Buttons and fields in the header keep their own clicks.
    if (target.closest('button, a, input, select, textarea') && !target.closest('.sheet-grab'))
      return;
    const top = sheet.current?.getBoundingClientRect().top ?? 0;
    const { clientY: y, timeStamp: t } = event;
    start.current = { y, top, lastY: y, lastT: t, prevY: y, prevT: t };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = event.clientY - s.y;
    if (drag === null && Math.abs(dy) < 4) return;
    dragged.current = true;
    const height = window.innerHeight;
    const highest = sheetTop(max, height);
    setDrag(Math.max(highest - 20, Math.min(height - 40, s.top + dy)));
    s.prevY = s.lastY;
    s.prevT = s.lastT;
    s.lastY = event.clientY;
    s.lastT = event.timeStamp;
  };
  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || drag === null) return;
    // The speed of the last stretch of the drag (a flick), in px/ms.
    const velocity = (s.lastY - s.prevY) / Math.max(1, s.lastT - s.prevT);
    const next = releaseSnap(snaps, snap, drag, window.innerHeight, velocity, !!onClose);
    setDrag(null);
    if (next === null) onClose?.();
    else onSnap(next);
  };

  const onHandleKey = (event: React.KeyboardEvent) => {
    const next = snapForKey(snaps, snap, event.key);
    if (next === null) return;
    event.preventDefault();
    onSnap(next);
  };
  const onHandleClick = () => {
    // A tap on the handle goes one snap up, and from the top back to the lowest.
    if (drag !== null || dragged.current) {
      dragged.current = false;
      return;
    }
    onSnap(snap === max ? min : (snaps.find((s) => s > snap) ?? max));
  };

  // The focus trap of the modal state.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!modal || event.key !== 'Tab' || !sheet.current) return;
    const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    const next = trapTarget(items, document.activeElement as HTMLElement | null, event.shiftKey);
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <section
      ref={sheet}
      id={id}
      className={`bottom-sheet ${className}`}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal || undefined}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      data-snap={drag === null ? snap : 'drag'}
      data-map-overlay
      data-testid={testId}
      {...attrs}
      style={{ top: drag ?? `${100 - snap}%` }}
      onKeyDown={onKeyDown}
    >
      <div
        className="sheet-drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        <div
          className="sheet-grab"
          role="slider"
          tabIndex={0}
          aria-label={`Altura de la hoja ${label}`}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={snap}
          aria-valuetext={`${snap} % de la pantalla`}
          title="Arrastra o usa las flechas para cambiar la altura"
          onKeyDown={onHandleKey}
          onClick={onHandleClick}
        >
          <i aria-hidden="true" />
        </div>
        {head}
      </div>
      <div className="sheet-scroll" ref={body}>
        {children}
      </div>
    </section>
  );
}

/** A sheet's snap, starting at `initial`; a new key (another asset) starts again. */
export function useSnap(initial: Snap) {
  return useState<Snap>(initial);
}

/** A sheet's header: its title (focused when it opens), extras and «Cerrar». */
export function SheetHead({
  title,
  titleId,
  label,
  extra,
  onClose,
}: {
  title: ReactNode;
  titleId?: string;
  label: string;
  extra?: ReactNode;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <header className="panel-head">
      <h2 id={titleId} ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {extra}
      <button type="button" className="close" onClick={onClose} aria-label={`Cerrar ${label}`}>
        <span className="close-text">Cerrar</span>
      </button>
    </header>
  );
}

/**
 * A tool panel or a section as a phone sheet, with its own height (it starts again at `initial`
 * every time it opens).
 */
export function PhoneSheet({
  id,
  anchorId,
  label,
  title,
  titleId,
  extra,
  snaps,
  initial,
  onClose,
  testId,
  attrs,
  className,
  children,
}: {
  id?: string;
  anchorId?: string;
  label: string;
  title?: ReactNode;
  titleId?: string;
  extra?: ReactNode;
  snaps: readonly Snap[];
  initial: Snap;
  onClose: () => void;
  testId?: string;
  attrs?: Record<string, string>;
  className?: string;
  children: ReactNode;
}) {
  const [snap, setSnap] = useSnap(initial);
  return (
    <BottomSheet
      id={id}
      anchorId={anchorId}
      label={label}
      labelledBy={titleId}
      snaps={snaps}
      snap={snap}
      onSnap={setSnap}
      onClose={onClose}
      testId={testId}
      attrs={attrs}
      className={className}
      head={
        <SheetHead
          title={title ?? label}
          titleId={titleId}
          label={label}
          extra={extra}
          onClose={onClose}
        />
      }
    >
      <div className="panel-body" id={id ? `${id}-body` : undefined}>
        {children}
      </div>
    </BottomSheet>
  );
}
