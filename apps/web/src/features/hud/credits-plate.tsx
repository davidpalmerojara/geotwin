import { useEffect, useRef } from 'react';
import { useScene } from '../../stores/viewer';
import { useLayerView } from '../../stores/layers';
import { sceneLabel } from '../layers/base-imagery';

/**
 * Bottom-right credits, always on screen: what the ground is made of («map-base»), the honesty
 * line, and Cesium's own credit container (the CC-BY attributions of the LiDAR and the
 * orthophoto, and Google's when the photorealistic mesh is on), re-parented here.
 */
export function CreditsPlate() {
  const credits = useScene((s) => s.credits),
    terrain = useScene((s) => s.terrain),
    photoreal = useScene((s) => s.photoreal);
  const base = useLayerView((s) => s.baseImagery),
    pnoa = useLayerView((s) => s.pnoa);
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (credits && slot.current && credits.parentElement !== slot.current)
      slot.current.appendChild(credits);
  }, [credits]);
  return (
    <footer className="plate credits-plate" data-map-overlay data-testid="credits">
      <p className="credits-line">
        <span data-testid="map-base">
          {sceneLabel(base, pnoa.state, pnoa.source, terrain, photoreal === 'on')}
        </span>
        <span aria-hidden="true"> · </span>
        <span className="honesty">Instalaciones ficticias · telemetría simulada</span>
      </p>
      <div ref={slot} className="credits-slot" />
    </footer>
  );
}
