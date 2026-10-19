/**
 * One-key shortcuts of the viewer (1–5, C, 0, F, N, /, R, [ and ]) and the rule that keeps them out of the way
 * (WCAG 2.1.4): never while typing in a field, never with Ctrl, ⌘ or Alt, never behind a modal
 * dialog, and never when the user has switched them off in Ajustes. Ctrl/⌘+K and Esc always work.
 */
export type ShortcutAction =
  | 'orbit'
  | 'measure'
  | 'profile'
  | 'cut'
  | 'radius'
  | 'layers'
  | 'home'
  | 'centre'
  | 'north'
  | 'palette'
  | 'acknowledge'
  | 'narrower'
  | 'wider'
  | 'escape';

/** The keys, as the Atajos list shows them. */
export const SHORTCUTS: [string, string][] = [
  ['1', 'Orbitar'],
  ['2', 'Medir'],
  ['3', 'Perfil'],
  ['4', 'Corte'],
  ['5', 'Radio'],
  ['C', 'Capas'],
  ['0', 'Encuadre inicial'],
  ['F', 'Centrar el activo de la ficha'],
  ['N', 'Norte arriba'],
  ['/', 'Ir a…'],
  ['[ ]', 'Estrecha o ensancha la franja del perfil'],
  ['R', 'Reconocer las alertas del activo de la ficha'],
  ['Ctrl+K', 'Ir a… (también en un campo de texto)'],
  ['Esc', 'Cierra el panel, después el perfil, la hoja y la ficha'],
];

const KEYS: Record<string, ShortcutAction> = {
  '1': 'orbit',
  '2': 'measure',
  '3': 'profile',
  '4': 'cut',
  '5': 'radius',
  c: 'layers',
  '0': 'home',
  f: 'centre',
  n: 'north',
  '/': 'palette',
  r: 'acknowledge',
  '[': 'narrower',
  ']': 'wider',
};

/** What a keyboard event's target needs to expose (a DOM element, or a stand-in in tests). */
export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  parentElement?: TargetLike | null;
}
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

// Inputs that take no typing: a digit or a letter pressed on them can be a shortcut.
const NOT_TEXT = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
  'file',
]);

/** Whether the target (or an ancestor) is a field that takes typing. */
export function isEditable(target: unknown) {
  for (let el = target as TargetLike | null | undefined; el; el = el.parentElement) {
    const tag = el.tagName?.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !NOT_TEXT.has((el.type ?? 'text').toLowerCase());
    const editable = el.getAttribute?.('contenteditable');
    if (
      el.isContentEditable ||
      (editable !== null && editable !== undefined && editable !== 'false')
    )
      return true;
  }
  return false;
}

export interface ShortcutContext {
  /** The Ajustes › Atajos switch. */
  enabled: boolean;
  /** A modal dialog is open (it handles its own keys). */
  modal: boolean;
}

export function shortcutFor(event: KeyLike, { enabled, modal }: ShortcutContext) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'k') return 'palette';
  if (modal) return null;
  if (key === 'Escape') return 'escape';
  if (!enabled || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isEditable(event.target)) return null;
  return KEYS[key] ?? null;
}

const STORAGE_KEY = 'geotwin.shortcuts';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const local = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** Read from browser storage; on by default and when storage is blocked. */
export function shortcutsEnabled(storage: StorageLike | undefined = local()) {
  try {
    return storage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function saveShortcutsEnabled(value: boolean, storage: StorageLike | undefined = local()) {
  try {
    storage?.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Private windows may refuse storage: the switch still works for this visit.
  }
}
