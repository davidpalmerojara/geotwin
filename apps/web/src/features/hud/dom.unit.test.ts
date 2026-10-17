import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusBack } from './dom';

/** A stand-in document with one button that takes the focus, or not (hidden). */
function page(focusable: boolean) {
  const doc = { activeElement: null as unknown };
  const button = {
    ownerDocument: doc,
    focus: vi.fn(() => {
      if (focusable) doc.activeElement = button;
    }),
  };
  return { doc, button, getElementById: (id: string) => (id === 'tool-layers' ? button : null) };
}

describe('focusBack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves the focus at once, without waiting for a frame', () => {
    const frame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frame);
    const p = page(true);
    focusBack('tool-layers', p as unknown as Document);
    expect(p.doc.activeElement).toBe(p.button);
    expect(frame).not.toHaveBeenCalled();
  });

  it('tries again on the next frame when the button cannot take it yet', () => {
    let next: (() => void) | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => (next = callback));
    const p = page(false);
    focusBack('tool-layers', p as unknown as Document);
    expect(p.button.focus).toHaveBeenCalledTimes(1);
    expect(next).toBeDefined();
    next!();
    expect(p.button.focus).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the button is gone', () => {
    const frame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frame);
    focusBack('missing', page(true) as unknown as Document);
    expect(frame).not.toHaveBeenCalled();
  });
});
