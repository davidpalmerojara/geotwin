import { describe, expect, it } from 'vitest';
import { normalize, search, type Item } from './search';

const items: Item[] = [
  { kind: 'asset', id: '1', name: 'Sonda de nivel · laguna', detail: 'Sonda de nivel' },
  { kind: 'asset', id: '2', name: 'Válvula de riego · campo de fútbol', detail: 'Válvula' },
  { kind: 'installation', id: '3', name: 'Depósito elevado del cerro' },
  { kind: 'layer', id: '4', name: 'PNOA_2025_CYL_356-4605' },
];

describe('«Ir a» search', () => {
  it('ignores accents and capitals', () => {
    expect(normalize('Válvula DE Riego')).toBe('valvula de riego');
    expect(search(items, 'VALVULA').map((i) => i.id)).toEqual(['2']);
    expect(search(items, 'deposito').map((i) => i.id)).toEqual(['3']);
    expect(search(items, 'fútbol válvula').map((i) => i.id)).toEqual(['2']);
  });
  it('puts names that start with the query first and lists everything for an empty one', () => {
    expect(search(items, 'la').map((i) => i.id)).toEqual(['1', '2']);
    expect(search(items, '356').map((i) => i.kind)).toEqual(['layer']);
    expect(search(items, '')).toHaveLength(4);
    expect(search(items, 'nada')).toEqual([]);
  });
});
