import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_PAIRS,
  LITERAL_TEXT_PAIRS,
  TEXT_PAIRS,
  TOKENS,
  contrast,
  type Token,
} from './tokens';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

describe('colour tokens', () => {
  it('are the same in globals.css and tokens.ts', () => {
    for (const [name, value] of Object.entries(TOKENS))
      expect(root, `--${name}`).toMatch(new RegExp(`--${name}:\\s*${value};`, 'i'));
  });
  it('compute contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
  const ratio = ([a, b]: [Token, Token]) => contrast(TOKENS[a], TOKENS[b]);
  it.each(TEXT_PAIRS)('text %s on %s reaches 4,5:1', (fg, bg) => {
    expect(ratio([fg, bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(LITERAL_TEXT_PAIRS)('text %s on %s (hover and inverted states) reaches 4,5:1', (a, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
    // Each literal is written in globals.css as listed.
    for (const hex of [a, b]) expect(css.toLowerCase()).toContain(hex);
  });
  it.each(CONTROL_PAIRS)('control %s against %s reaches 3:1', (a, b) => {
    expect(ratio([a, b])).toBeGreaterThanOrEqual(3);
  });
});
