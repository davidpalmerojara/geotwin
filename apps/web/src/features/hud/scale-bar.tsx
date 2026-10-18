import { useCamera } from './heading-plate';
import { niceScale, type ScaleBar } from './readout';

/** The scale at the centre of the view, with round lengths. */
export function ScalePlate() {
  const info = useCamera();
  const bar: ScaleBar | null = info?.metresPerPixel ? niceScale(info.metresPerPixel, 150) : null;
  return (
    <div className="plate scale-plate" data-map-overlay data-testid="scale">
      {bar ? (
        <>
          <svg
            width={Math.ceil(bar.px + 26)}
            height="24"
            className="scale-svg"
            role="img"
            aria-label={`Escala: ${bar.labels[2]} en el centro de la vista`}
          >
            <rect x="1" y="15" width={bar.px / 2} height="5" className="scale-fill" />
            <rect x="1" y="15" width={bar.px} height="5" className="scale-frame" />
            <text x="1" y="11" textAnchor="start">
              {bar.labels[0]}
            </text>
            <text x={1 + bar.px / 2} y="11" textAnchor="middle">
              {bar.labels[1]}
            </text>
            <text x={1 + bar.px} y="11" textAnchor="middle">
              {bar.labels[2]}
            </text>
          </svg>
          <span className="scale-note">en el centro</span>
        </>
      ) : (
        <span className="scale-note">Escala: el centro de la vista no mira al suelo</span>
      )}
    </div>
  );
}
