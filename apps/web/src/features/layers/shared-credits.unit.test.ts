import { describe, expect, it } from 'vitest';
import { SharedCredits } from './shared-credits';

describe('Shared layer credits', () => {
  it('shows one credit for several layers and removes it with the last one', () => {
    const shown: string[] = [];
    const credits = new SharedCredits<string>(
      (c) => shown.push(c),
      (c) => shown.splice(shown.indexOf(c), 1),
    );
    const pnoa = 'Obra derivada de LiDAR-PNOA-cob3 2022-2025 CC-BY 4.0 scne.es';
    credits.show(pnoa, () => pnoa);
    credits.show(pnoa, () => pnoa);
    credits.show('Nube SINTÉTICA', () => 'Nube SINTÉTICA');
    expect(shown).toEqual([pnoa, 'Nube SINTÉTICA']);
    credits.hide(pnoa); // one PNOA layer hidden: the other still needs the credit
    expect(shown).toContain(pnoa);
    credits.hide(pnoa);
    expect(shown).toEqual(['Nube SINTÉTICA']);
    credits.hide(pnoa); // extra hides are harmless
    expect(credits.size).toBe(1);
  });
});
