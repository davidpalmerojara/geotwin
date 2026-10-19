import { useEffect } from 'react';
import { create } from 'zustand';
import { Minus, Plus, Search } from 'lucide-react';
import { useScene, type CameraInfo } from '../../stores/viewer';
import { useTool } from '../../stores/tool';
import { useUI } from '../../stores/ui';
import { number } from '../../lib/format';
import { Kbd } from './glyphs';
import { NBSP, MINUS } from './readout';

const TAPE_W = 206,
  TAPE_H = 30,
  SPAN = 76;
const CARDINAL: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SO',
  270: 'O',
  315: 'NO',
};
const signed = (value: number, digits = 1) =>
  `${value < 0 ? MINUS : ''}${number(Math.abs(value), digits)}`;

/** The camera as the plates show it, kept out of React state so that only they re-render. */
const useCameraInfo = create<{ info: CameraInfo | null }>(() => ({ info: null }));

/**
 * Follows the camera: heading, pitch, height and the scale at the centre, at most once a frame,
 * into a small store. It renders nothing and holds no state, so a camera move re-renders only the
 * plates that read it (heading and scale), never the whole HUD.
 */
export function CameraFeed() {
  const api = useScene((s) => s.api);
  useEffect(() => {
    if (!api) return;
    let frame = 0;
    const update = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          useCameraInfo.setState({ info: api.camera() });
        });
    };
    update();
    const off = api.onCamera(update);
    // Terrain and tiles arriving change the ground under the camera without a camera move.
    const timer = setInterval(update, 2000);
    return () => {
      off();
      clearInterval(timer);
      cancelAnimationFrame(frame);
      useCameraInfo.setState({ info: null });
    };
  }, [api]);
  return null;
}

/** The latest camera reading (null until the viewer is up). */
export const useCamera = () => useCameraInfo((s) => s.info);

/** A heading tape like a total station's: ticks every 5°, labels every 15°. */
function Tape({ heading }: { heading: number }) {
  const px = TAPE_W / SPAN;
  const ticks: React.ReactNode[] = [];
  for (let a = Math.ceil((heading - SPAN / 2) / 5) * 5; a <= heading + SPAN / 2; a += 5) {
    const x = TAPE_W / 2 + (a - heading) * px;
    const major = a % 15 === 0;
    const norm = ((a % 360) + 360) % 360;
    ticks.push(
      <line
        key={`t${a}`}
        x1={x}
        x2={x}
        y1={TAPE_H - 1}
        y2={TAPE_H - (major ? 9 : 5)}
        className={major ? 'tick-major' : 'tick'}
      />,
    );
    if (major && Math.abs(a - heading) > 9 && x > 12 && x < TAPE_W - 12)
      ticks.push(
        <text key={`l${a}`} x={x} y={TAPE_H - 12} textAnchor="middle" className="tick-label">
          {CARDINAL[norm] ?? norm}
        </text>,
      );
  }
  return (
    <svg width={TAPE_W} height={TAPE_H} className="tape-svg" aria-hidden="true">
      {ticks}
    </svg>
  );
}

/**
 * Top-right plates: «Ir a» (/), the heading plate (tape, pitch, camera height and the north
 * needle, which turns the view north up), zoom, «Encuadre inicial» (0) and, with an asset's
 * card open, «Centrar activo» (F) beside it, as in A/desktop-asset.
 */
export function HeadingPlate() {
  const info = useCamera();
  const api = useScene((s) => s.api);
  const setPalette = useTool((s) => s.setPalette);
  const selected = useUI((s) => s.selectedAssetId);
  const heading = info ? ((info.heading % 360) + 360) % 360 : 0;
  return (
    <div className="hud-tr">
      <div className="hud-tr-row">
        <button
          type="button"
          className="plate icon-plate"
          aria-label="Ir a…"
          aria-keyshortcuts="/ Control+K"
          title="Ir a un activo, una instalación o una capa (tecla /)"
          data-map-overlay
          onClick={() => setPalette(true)}
        >
          <Search size={15} aria-hidden="true" />
          <Kbd>/</Kbd>
        </button>
        <div className="plate heading-plate" data-map-overlay data-testid="heading-plate">
          <div className="tape">
            <Tape heading={heading} />
            <span className="tape-value num">{Math.round(heading) % 360}°</span>
            <div className="cam-row num">
              <span>Inclinación</span>
              {info ? `${signed(info.pitch)}°` : '—'}
              <span>Cámara</span>
              {info ? `${number(Math.max(0, info.height), 0)}${NBSP}m` : '—'}
            </div>
          </div>
          <button
            type="button"
            className="needle"
            aria-label="Norte arriba"
            aria-keyshortcuts="N"
            title="Norte arriba (tecla N)"
            disabled={!api}
            onClick={() => api?.northUp()}
          >
            <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
              <circle r="15" className="needle-ring" />
              <g transform={`rotate(${-heading})`}>
                <path d="M0,-12 L4,2 L0,0 L-4,2Z" className="needle-n" />
                <path d="M0,0 L4,2 L0,12 L-4,2Z" className="needle-s" />
              </g>
            </svg>
            <Kbd>N</Kbd>
          </button>
          <div className="zoom">
            <button
              type="button"
              aria-label="Acercar"
              title="Acercar (+ con la escena enfocada)"
              disabled={!api}
              onClick={() => api?.zoom(1)}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Alejar"
              title="Alejar (− con la escena enfocada)"
              disabled={!api}
              onClick={() => api?.zoom(-1)}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="hud-tr-row">
        {selected && (
          <button
            type="button"
            className="plate key-plate"
            aria-label="Centrar activo"
            aria-keyshortcuts="F"
            title="Vuelve a centrar el activo de la ficha (tecla F)"
            data-map-overlay
            disabled={!api}
            onClick={() => api?.centreAsset(selected)}
          >
            <Kbd>F</Kbd>
            Centrar activo
          </button>
        )}
        <button
          type="button"
          className="plate key-plate"
          aria-label="Encuadre inicial"
          aria-keyshortcuts="0"
          title="Vuelve a encuadrar la instalación elegida o toda la red (tecla 0)"
          data-map-overlay
          disabled={!api}
          onClick={() => api?.home()}
        >
          <Kbd>0</Kbd>
          Encuadre inicial
        </button>
      </div>
    </div>
  );
}

/**
 * The phone's heading plate: heading and pitch in figures and the north needle (tap: north up).
 */
export function PhoneHeading() {
  const info = useCamera();
  const api = useScene((s) => s.api);
  const heading = info ? ((info.heading % 360) + 360) % 360 : 0;
  return (
    <div className="plate phone-heading" data-map-overlay data-testid="heading-plate">
      <span className="num phone-heading-deg">{info ? `${Math.round(heading) % 360}°` : '—'}</span>
      <span className="num f1">{info ? `${signed(info.pitch, 0)}°` : ''}</span>
      <button
        type="button"
        className="needle"
        aria-label="Norte arriba"
        title="Norte arriba"
        disabled={!api}
        onClick={() => api?.northUp()}
      >
        <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
          <circle r="15" className="needle-ring" />
          <g transform={`rotate(${-heading})`}>
            <path d="M0,-12 L4,2 L0,0 L-4,2Z" className="needle-n" />
            <path d="M0,0 L4,2 L0,12 L-4,2Z" className="needle-s" />
          </g>
        </svg>
      </button>
    </div>
  );
}
