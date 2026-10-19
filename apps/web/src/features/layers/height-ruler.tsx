import { create } from 'zustand';
import { useLayers } from '../../hooks/data';
import { number } from '../../lib/format';
import { useLayerView } from '../../stores/layers';
import { groundLabelY, HEIGHT_RAMP, heightLegend, rulerScale } from './point-style';

/**
 * The Cota and the ground under the scene cursor, as the readout plate measures them (metres,
 * orthometric). Kept out of React state so that a pointer move re-renders only the ruler.
 */
export const useCursorCota = create<{ cota: number | null; suelo: number | null }>(() => ({
  cota: null,
  suelo: null,
}));
export function setCursorCota(cota: number | null, suelo: number | null) {
  const now = useCursorCota.getState();
  if (now.cota !== cota || now.suelo !== suelo) useCursorCota.setState({ cota, suelo });
}

/** The shared Cota range Altura colours over, while Altura is on and some sheet has heights. */
export function useHeightLegend() {
  const layers = useLayers().data;
  const hidden = useLayerView((s) => s.hidden),
    mode = useLayerView((s) => s.colorMode);
  return mode === 'height' ? heightLegend(layers ?? [], hidden) : undefined;
}

const W = 84,
  TOP = 40,
  RAMP_X = 62;
const metres = (z: number, digits = 1) => number(z, digits);

/**
 * The «Cota m» ruler of A/desktop-capas: the Altura ramp standing up beside its heights, labels
 * every 1, 2 or 5 × 10ⁿ m, and the cursor's Cota (yellow) and the ground under it (white).
 */
export function HeightRuler({
  range,
  sheets,
  height,
}: {
  range: { min: number; max: number };
  sheets: number;
  height: number;
}) {
  const { cota, suelo } = useCursorCota();
  const scale = rulerScale(range.min, range.max, height > 340 ? 6 : 4);
  const bottom = height - 12;
  const y = (z: number) => bottom - ((z - scale.low) / (scale.high - scale.low)) * (bottom - TOP);
  const within = (z: number | null): z is number =>
    z !== null && z >= scale.low - 0.05 && z <= scale.high + 0.05;
  const span = (range.max - range.min) / HEIGHT_RAMP.length;
  const cursor = within(cota) ? y(cota) : null,
    ground = within(suelo) ? y(suelo) : null;
  // The ground's value steps clear of the cursor chip (a few metres apart is the usual case).
  const groundText = ground === null ? null : groundLabelY(cursor, ground, TOP - 4, height - 6);
  // Tick labels give way to the cursor's and the ground's values.
  const clear = (at: number) =>
    (cursor === null || Math.abs(at - cursor) > 13) &&
    (groundText === null || Math.abs(at - groundText) > 13);
  const label = `Escala de color de Altura: de ${metres(range.min)} m (azul) a ${metres(range.max)} m (rojo) de cota, la misma en ${sheets === 1 ? 'la hoja' : `las ${sheets} hojas`}`;
  return (
    <svg
      className="height-ruler"
      width={W}
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      role="img"
      aria-label={label}
    >
      <text x={8} y={16} className="ruler-title">
        Cota m
      </text>
      <text x={8} y={30} className="ruler-sub">
        {sheets === 1 ? '1 hoja' : `${sheets} hojas`}
      </text>
      {HEIGHT_RAMP.map((color, i) => {
        const top = y(range.min + span * (i + 1)),
          low = y(range.min + span * i);
        return <rect key={color} x={RAMP_X} y={top} width={8} height={low - top} fill={color} />;
      })}
      <rect
        x={RAMP_X}
        y={y(range.max)}
        width={8}
        height={y(range.min) - y(range.max)}
        className="ruler-frame"
      />
      {scale.ticks.map(({ z, major }) => (
        <g key={z}>
          <line
            x1={major ? 50 : 54}
            x2={60}
            y1={y(z)}
            y2={y(z)}
            className={major ? 'tick-major' : 'tick'}
          />
          {major && clear(y(z)) && (
            <text x={46} y={y(z) + 4} textAnchor="end" className="tick-label">
              {metres(z, 0)}
            </text>
          )}
        </g>
      ))}
      <g aria-hidden="true" data-testid="ruler-cursor">
        {ground !== null && (
          <>
            <line x1={48} x2={76} y1={ground} y2={ground} className="ruler-ground" />
            <text
              x={46}
              y={groundText! + 4}
              textAnchor="end"
              className="tick-label ground-label"
              data-testid="ruler-ground-value"
            >
              {metres(suelo!)}
            </text>
          </>
        )}
        {cursor !== null && (
          <>
            {ground !== null && Math.abs(ground - cursor) > 4 && (
              <line
                x1={80}
                x2={80}
                y1={cursor + (ground > cursor ? 2 : -2)}
                y2={ground + (ground > cursor ? -2 : 2)}
                className="ruler-above"
              />
            )}
            <path d={`M72,${cursor} l8,-5 v10 z`} className="ruler-mark" />
            <rect x={4} y={cursor - 9} width={46} height={18} className="ruler-mark" />
            <text x={27} y={cursor + 4} textAnchor="middle" className="ruler-value">
              {metres(cota!)}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

/** One line under Color in Capas: the shared range, with decimal commas. */
export function HeightRangeNote({
  range,
  sheets,
  aside,
}: {
  range: { min: number; max: number };
  sheets: number;
  aside: boolean;
}) {
  return (
    <p className="height-note" data-testid="height-range">
      <i style={{ background: `linear-gradient(0deg, ${HEIGHT_RAMP.join(', ')})` }} />
      <span>
        Cota de {metres(range.min)} a {metres(range.max)}&nbsp;m,{' '}
        {sheets === 1 ? 'en la hoja' : `el mismo rango en las ${sheets} hojas`}
        {aside ? '; la regla «Cota m» está a la derecha.' : '.'}
      </span>
    </p>
  );
}

/** The floating ruler on desktop and tablet, under «Encuadre inicial», while Altura is on. */
export function CotaPlate({ tall }: { tall: boolean }) {
  const legend = useHeightLegend();
  if (!legend) return null;
  return (
    <div
      className="plate cota-plate"
      data-map-overlay
      data-testid="cota-ruler"
      data-min={legend.range.min.toFixed(2)}
      data-max={legend.range.max.toFixed(2)}
    >
      <HeightRuler range={legend.range} sheets={legend.sheets} height={tall ? 420 : 300} />
    </div>
  );
}
