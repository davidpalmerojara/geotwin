/**
 * The «Estación total» colour tokens, as in `:root` of globals.css (contrast.unit.test.ts checks
 * that both agree). Script-drawn things that CSS variables cannot reach, such as the Recharts
 * axes and lines, take their colours from here.
 */
export const TOKENS = {
  'ink-0': '#0e0e0d',
  'ink-1': '#161615',
  'ink-2': '#1f1e1c',
  'ink-3': '#2a2926',
  rule: '#363531',
  'rule-2': '#706d64',
  'fg-0': '#eeece6',
  'fg-1': '#bab6ac',
  'fg-2': '#8f8b82',
  sig: '#ffd21a',
  'sig-ink': '#191500',
  warn: '#ff9f1a',
  alarm: '#ff5a4c',
  'alarm-bg': '#3a1411',
} as const;
export type Token = keyof typeof TOKENS;

/** What text is drawn on what: every pair must reach 4,5:1 (WCAG 1.4.3, AA). */
export const TEXT_PAIRS: [Token, Token][] = [
  ...(['fg-0', 'fg-1'] as const).flatMap((fg) =>
    (['ink-0', 'ink-1', 'ink-2', 'ink-3'] as const).map((bg): [Token, Token] => [fg, bg]),
  ),
  // fg-2 only on the opaque plates, panels and rows, never on the pressed fill (4,3:1).
  ['fg-2', 'ink-0'],
  ['fg-2', 'ink-1'],
  ['fg-2', 'ink-2'],
  ['fg-0', 'alarm-bg'],
  ['fg-1', 'alarm-bg'],
  ['alarm', 'alarm-bg'],
  ...(['ink-0', 'ink-1', 'ink-2'] as const).flatMap((bg): [Token, Token][] => [
    ['warn', bg],
    ['alarm', bg],
    ['sig', bg],
  ]),
  // The active tool and the current page are inverted; the signal fill carries its own ink.
  ['ink-0', 'fg-0'],
  ['sig-ink', 'sig'],
];

/**
 * Text on the few literal colours of globals.css: hover fills of the alarm cell and the
 * destructive button, its light red text, and the count inside the inverted Capas key.
 */
export const LITERAL_TEXT_PAIRS: [string, string][] = [
  [TOKENS.alarm, '#4a1915'],
  [TOKENS['fg-0'], '#4a1915'],
  ['#ffb3ab', TOKENS['alarm-bg']],
  ['#ffb3ab', '#4d1a16'],
  ['#55524b', TOKENS['fg-0']],
];

/** Control borders and focus indicators against what is around them: 3:1 (WCAG 1.4.11). */
export const CONTROL_PAIRS: [Token, Token][] = [
  ['rule-2', 'ink-0'],
  ['rule-2', 'ink-1'],
  ['rule-2', 'ink-2'],
  // The focus ring (sig) on every surface, and the inverted key against its plate.
  ['sig', 'ink-0'],
  ['sig', 'ink-1'],
  ['sig', 'ink-2'],
  ['fg-0', 'ink-0'],
  ['fg-0', 'ink-1'],
];

/** Recharts styling on the tokens: axes, grid, tooltip and lines. */
export const CHART = {
  grid: TOKENS.rule,
  tick: { fill: TOKENS['fg-1'], fontSize: 11, fontFamily: 'IBM Plex Mono' },
  line: TOKENS['fg-0'],
  line2: TOKENS['fg-1'],
  warn: TOKENS.warn,
  alarm: TOKENS.alarm,
  tooltip: {
    background: TOKENS['ink-0'],
    border: `1px solid ${TOKENS['rule-2']}`,
    borderRadius: 2,
    color: TOKENS['fg-0'],
  },
} as const;

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** WCAG contrast ratio of two colours (1 to 21). */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
