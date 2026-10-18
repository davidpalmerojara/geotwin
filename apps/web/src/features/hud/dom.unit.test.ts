import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusBack, overlayBoxes, sceneBlockers } from './dom';

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

describe('sceneBlockers', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in element with a box and a computed display. */
  const element = (box: Partial<DOMRect>, display = 'block') => ({
    display,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, ...box }) as DOMRect,
  });

  it('counts the plates and the edge chips, not hidden or empty ones', () => {
    vi.stubGlobal('getComputedStyle', (e: { display: string }) => ({
      display: e.display,
      visibility: 'visible',
    }));
    const plate = element({ left: 12, top: 12, width: 300, height: 40 });
    const chip = element({ left: 360, top: 136, width: 260, height: 24 });
    const hidden = element({ left: 0, top: 0, width: 50, height: 50 }, 'none');
    const empty = element({ left: 5, top: 5 });
    const asked: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return [plate, chip, hidden, empty];
      },
    } as unknown as ParentNode;
    const boxes = sceneBlockers(root);
    expect(asked).toEqual(['[data-map-overlay], .edge-chip']);
    expect(boxes.map((b) => b.left)).toEqual([12, 360]);
  });

  it('leaves the edge chips out of the plates used for framing', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }));
    const asked: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return [];
      },
    } as unknown as ParentNode;
    overlayBoxes(root);
    expect(asked).toEqual(['[data-map-overlay]']);
  });
});
