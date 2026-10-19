import { describe, expect, it } from 'vitest';
import { isEditable, saveShortcutsEnabled, shortcutFor, shortcutsEnabled } from './shortcuts';

const on = { enabled: true, modal: false };
const body = { tagName: 'BODY', parentElement: null };
const key = (k: string, extra: object = {}) => ({ key: k, target: body, ...extra });

describe('one-key shortcuts', () => {
  it('map the tool keys', () => {
    expect(shortcutFor(key('1'), on)).toBe('orbit');
    expect(shortcutFor(key('2'), on)).toBe('measure');
    expect(shortcutFor(key('5'), on)).toBe('radius');
    expect(shortcutFor(key('c'), on)).toBe('layers');
    expect(shortcutFor(key('C'), on)).toBe('layers');
    expect(shortcutFor(key('0'), on)).toBe('home');
    expect(shortcutFor(key('f'), on)).toBe('centre');
    expect(shortcutFor(key('F'), on)).toBe('centre');
    expect(shortcutFor(key('f', { ctrlKey: true }), on)).toBeNull();
    expect(shortcutFor(key('N'), on)).toBe('north');
    expect(shortcutFor(key('/'), on)).toBe('palette');
    expect(shortcutFor(key('r'), on)).toBe('acknowledge');
    expect(shortcutFor(key('R'), on)).toBe('acknowledge');
    expect(shortcutFor(key('r', { ctrlKey: true }), on)).toBeNull();
    expect(shortcutFor(key('x'), on)).toBeNull();
  });
  it('do nothing while typing in a text field, a select or contenteditable', () => {
    const input = { tagName: 'INPUT', type: 'text', parentElement: body };
    const search = { tagName: 'INPUT', type: 'search', parentElement: body };
    const select = { tagName: 'SELECT', parentElement: body };
    const textarea = { tagName: 'TEXTAREA', parentElement: body };
    const editor = { tagName: 'DIV', getAttribute: () => 'true', parentElement: body };
    const inside = {
      tagName: 'SPAN',
      parentElement: { tagName: 'DIV', isContentEditable: true, parentElement: body },
    };
    for (const target of [input, search, select, textarea, editor, inside]) {
      expect(isEditable(target)).toBe(true);
      expect(shortcutFor({ key: '1', target }, on)).toBeNull();
      expect(shortcutFor({ key: 'c', target }, on)).toBeNull();
      expect(shortcutFor({ key: 'f', target }, on)).toBeNull();
    }
    // A checkbox or a slider takes no typing.
    expect(shortcutFor({ key: '2', target: { tagName: 'INPUT', type: 'checkbox' } }, on)).toBe(
      'measure',
    );
    expect(isEditable({ tagName: 'DIV', getAttribute: () => 'false' })).toBe(false);
  });
  it('do nothing with Ctrl, ⌘ or Alt', () => {
    expect(shortcutFor(key('1', { ctrlKey: true }), on)).toBeNull();
    expect(shortcutFor(key('c', { metaKey: true }), on)).toBeNull();
    expect(shortcutFor(key('2', { altKey: true }), on)).toBeNull();
  });
  it('do nothing when switched off or behind a modal dialog', () => {
    expect(shortcutFor(key('1'), { enabled: false, modal: false })).toBeNull();
    expect(shortcutFor(key('1'), { enabled: true, modal: true })).toBeNull();
    expect(shortcutFor(key('Escape'), { enabled: true, modal: true })).toBeNull();
  });
  it('keep Ctrl/⌘+K and Esc working everywhere', () => {
    const input = { tagName: 'INPUT', type: 'text' };
    expect(
      shortcutFor({ key: 'k', ctrlKey: true, target: input }, { enabled: false, modal: false }),
    ).toBe('palette');
    expect(shortcutFor({ key: 'K', metaKey: true, target: input }, on)).toBe('palette');
    expect(shortcutFor({ key: 'Escape', target: input }, { enabled: false, modal: false })).toBe(
      'escape',
    );
  });
  it('remember the switch, and stay on when storage is blocked', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(shortcutsEnabled(storage)).toBe(true);
    saveShortcutsEnabled(false, storage);
    expect(shortcutsEnabled(storage)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(shortcutsEnabled(blocked)).toBe(true);
    expect(() => saveShortcutsEnabled(false, blocked)).not.toThrow();
  });
});
