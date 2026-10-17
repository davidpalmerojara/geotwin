import { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import type { AssetStatus } from '@geotwin/shared';
import { useAssets, useInstallations, useLayers } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useLayerView } from '../../stores/layers';
import { assetTypeLabel } from '../../lib/format';
import { Glyph, Kbd } from './glyphs';
import { search, type Item } from './search';

const KIND: Record<Item['kind'], string> = {
  asset: 'Activo',
  installation: 'Instalación',
  layer: 'Capa',
};

/**
 * «Ir a» (/ or Ctrl/⌘+K): finds assets, installations and LiDAR layers, without minding accents
 * or capitals. Intro flies there and selects it.
 */
export function Palette() {
  const open = useTool((s) => s.palette),
    setOpen = useTool((s) => s.setPalette);
  const assets = useAssets().data,
    installations = useInstallations().data,
    layers = useLayers().data;
  const select = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation),
    setPage = useUI((s) => s.setPage),
    flyTo = useLayerView((s) => s.requestFlyTo);
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const items = useMemo(() => {
    const all: (Item & { status?: AssetStatus })[] = [
      ...(assets ?? []).map((a) => ({
        kind: 'asset' as const,
        id: a.id,
        name: a.name,
        detail: assetTypeLabel[a.type],
        status: a.status,
      })),
      ...(installations ?? []).map((i) => ({
        kind: 'installation' as const,
        id: i.id,
        name: i.name,
      })),
      ...(layers ?? [])
        .filter((l) => l.status === 'ready')
        .map((l) => ({
          kind: 'layer' as const,
          id: l.id,
          name: l.name,
          detail: l.source.filename,
        })),
    ];
    return all;
  }, [assets, installations, layers]);
  const found = search(items, query);
  const choose = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    setActive(0);
    setPage('twin');
    if (item.kind === 'asset') {
      // A link to an asset of another installation shows the whole network around it.
      const asset = assets?.find((a) => a.id === item.id);
      const installation = useUI.getState().installationId;
      if (asset && installation && asset.installation_id !== installation) setInstallation('');
      select(item.id);
    } else if (item.kind === 'installation') setInstallation(item.id);
    else flyTo(item.id);
  };
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay palette-overlay" />
        <DialogPrimitive.Content className="panel palette" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Ir a</DialogPrimitive.Title>
          <label className="palette-input">
            <Search size={15} aria-hidden="true" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={found[active] ? `palette-${active}` : undefined}
              aria-label="Ir a un activo, una instalación o una capa"
              placeholder="Ir a un activo, una instalación o una capa…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(found.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(found[active]);
                }
              }}
            />
            <Kbd>Esc</Kbd>
          </label>
          <ul id="palette-list" role="listbox" aria-label="Resultados" className="palette-list">
            {found.map((item, i) => (
              <li
                key={`${item.kind}:${item.id}`}
                id={`palette-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                {'status' in item && item.status ? (
                  <Glyph status={item.status} />
                ) : (
                  <i className="glyph-none" />
                )}
                <span className="palette-name">{item.name}</span>
                <span className="palette-kind">{KIND[item.kind]}</span>
              </li>
            ))}
            {!found.length && <li className="palette-empty">Nada coincide con «{query}».</li>}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
