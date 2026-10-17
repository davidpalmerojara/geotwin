import type { AssetStatus } from '@geotwin/shared';

/**
 * Status always goes as shape, colour and word: a ring with a dot (operativo), an amber
 * triangle (advertencia), a red diamond (crítico). The glyphs are decorative; the word is text.
 */
export function Glyph({ status }: { status: AssetStatus }) {
  return <i className={`glyph glyph-${status}`} aria-hidden="true" />;
}

const words: Record<AssetStatus, string> = {
  healthy: 'Operativo',
  warning: 'Advertencia',
  critical: 'Crítico',
};
export function StatusWord({ status }: { status: AssetStatus }) {
  return (
    <span className={`status status-${status}`}>
      <Glyph status={status} />
      {words[status]}
    </span>
  );
}

/** A key cap. */
export function Kbd({ children, signal }: { children: React.ReactNode; signal?: boolean }) {
  return <kbd className={signal ? 'kbd-sig' : undefined}>{children}</kbd>;
}

/** The dashed «simulado» tag next to every simulated value. */
export function Sim({ text = 'simulado' }: { text?: string }) {
  return (
    <span className="sim" title="Dato generado por el simulador de la demo">
      {text}
    </span>
  );
}

/** The «Estación total» mark: a reticle in signal yellow. */
export function Brand() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="6" fill="none" stroke="#FFD21A" strokeWidth="1.6" />
      <path d="M9 0v5M9 13v5M0 9h5M13 9h5" stroke="#FFD21A" strokeWidth="1.6" />
    </svg>
  );
}

/** A caret for the menus and selectors. */
export function Caret() {
  return <i className="caret" aria-hidden="true" />;
}
