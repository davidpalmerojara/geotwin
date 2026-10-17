import { useEffect, useState } from 'react';
import type { Asset } from '@geotwin/shared';
import { useAssets } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { useScene } from '../../stores/viewer';
import { assetTypeLabel } from '../../lib/format';
import { StatusWord } from './glyphs';
import { screenOrder } from './scene-order';

/**
 * The assets drawn in the scene, as a list of buttons in screen order (top to bottom, then left
 * to right), so a keyboard or screen reader user reaches the same things a pointer user sees.
 * The list is hidden until it gets the focus (Tab after the tool bar); Intro selects the asset.
 */
export function SceneAssetList() {
  const api = useScene((s) => s.api),
    relief = useScene((s) => s.relief);
  const assets = useAssets().data;
  const selected = useUI((s) => s.selectedAssetId),
    select = useUI((s) => s.selectAsset);
  const [shown, setShown] = useState<Asset[]>([]);
  useEffect(() => {
    if (!api || !assets) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const points = assets.map((asset) => ({
        item: asset,
        at: api.project(
          asset.location.lng,
          asset.location.lat,
          api.groundAt(asset.location.lng, asset.location.lat) +
            (relief ? asset.mount_height_m : 0),
        ),
      }));
      setShown(screenOrder(points, window.innerWidth, window.innerHeight));
    };
    // After the camera rests: the order is read on demand, never on every frame.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 250);
    };
    update();
    const off = api.onCamera(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      off();
      clearTimeout(timer);
      window.removeEventListener('resize', schedule);
    };
  }, [api, assets, relief]);
  return (
    <nav className="scene-list" aria-label="Activos en la escena" data-testid="scene-assets">
      <p className="scene-list-head">
        Activos a la vista, de arriba abajo <span className="num">{shown.length}</span>
      </p>
      {shown.length ? (
        <ul>
          {shown.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                aria-current={asset.id === selected ? 'true' : undefined}
                onClick={() => select(asset.id)}
              >
                <span className="scene-list-name">{asset.name}</span>
                <span className="f1">{assetTypeLabel[asset.type]}</span>
                <StatusWord status={asset.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="scene-list-empty">Ningún activo a la vista.</p>
      )}
    </nav>
  );
}
