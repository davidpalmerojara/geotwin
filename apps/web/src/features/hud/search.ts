/** «Ir a» matching: accents and capitals do not matter, every word must appear. */
export const normalize = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface Item {
  kind: 'asset' | 'installation' | 'layer';
  id: string;
  name: string;
  /** What else is searched: the type, the installation. */
  detail?: string;
}

/** Items whose name (or detail) contains every word of the query; names that start with it first. */
export function search<T extends Item>(items: T[], query: string, limit = 12): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, limit);
  return items
    .map((item) => {
      const name = normalize(item.name),
        all = `${name} ${normalize(item.detail ?? '')}`;
      if (!words.every((w) => all.includes(w))) return null;
      return { item, rank: name.startsWith(words[0]!) ? 0 : name.includes(words[0]!) ? 1 : 2 };
    })
    .filter((r): r is { item: T; rank: number } => !!r)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.item);
}
