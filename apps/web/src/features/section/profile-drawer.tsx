import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { number } from '../../lib/format';
import { EXAGGERATIONS, useSection, type CutMode, type Exaggeration } from '../../stores/section';
import { closeProfile, useTool } from '../../stores/tool';
import { Kbd } from '../hud/glyphs';
import { PhoneSheet } from '../hud/bottom-sheet';
import { toolButtonId } from '../hud/tool-bar';
import { usePhone } from '../../hooks/media';
import { useProfile, type Profile } from './use-profile';
import {
  className,
  dtmAt,
  grouped,
  heightRange,
  metres,
  plotScale,
  profileCsv,
  chartReading,
} from './section-math';
import { drawProfile, pointAt, PLOT_MARGIN, sOf, type PlotFrame } from './profile-plot';

const signed = (m: number) => `${m > 0.05 ? '+' : m < -0.05 ? '−' : ''}${number(Math.abs(m), 1)} m`;

/** «336,2 m · rumbo 251° · corte ±1,5 m · 8.287 puntos» */
export function profileMeta(profile: Profile) {
  const parts = [
    metres(profile.line.length),
    `rumbo ${number(profile.line.bearing, 0)}°`,
    `corte ±${number(profile.half, profile.half % 1 ? 2 : 0).replace(/,?0$/, '')} m`,
  ];
  if (profile.status === 'ready' || profile.status === 'empty')
    parts.push(`${grouped(profile.points.count)} puntos`);
  return parts.join(' · ');
}

/**
 * The floating hint of tools 3 and 4, under the tool bar: what the clicks do and, with a cut, what
 * happens on each side of the line.
 */
export function ProfileHint() {
  const a = useSection((s) => s.a),
    b = useSection((s) => s.b),
    cut = useSection((s) => s.cut);
  // On a phone the plate is one short line: the step, without the keys or the cut's legend (the
  // sheet below says which mode the cut is in).
  const phone = usePhone();
  const step = !a
    ? phone
      ? 'Toca el mapa para poner A'
      : 'Haz clic en el mapa para poner A'
    : !b
      ? 'Ahora pon B'
      : 'Arrastra A o B para ajustar';
  if (phone)
    return (
      <div className="plate profile-hint" data-map-overlay data-testid="profile-hint">
        <b>{cut === 'off' ? 'Perfil' : 'Perfil y corte'}</b>
        <span>{step}</span>
      </div>
    );
  return (
    <div className="plate profile-hint" data-map-overlay data-testid="profile-hint">
      <b>{cut === 'off' ? 'Perfil' : 'Perfil y corte'}</b>
      {cut !== 'off' && (
        <span>
          Delante de la línea: recortado
          {cut === 'dim'
            ? ' · fuera de la franja: atenuado'
            : cut === 'hide'
              ? ' · fuera de la franja: oculto'
              : ''}
        </span>
      )}
      <span>{step}</span>
      <span>
        <Kbd>[</Kbd>
        <Kbd>]</Kbd> grosor
      </span>
    </div>
  );
}

/** The cut switch and its mode, in the drawer's header. */
function CutControls({ phone }: { phone: boolean }) {
  const cut = useSection((s) => s.cut),
    setCut = useSection((s) => s.setCut);
  const modes: [CutMode, string][] = [
    ['front', 'Ver'],
    ['dim', 'Atenuar'],
    ['hide', 'Ocultar'],
  ];
  return (
    <>
      <label className="pd-switch">
        <input
          type="checkbox"
          role="switch"
          checked={cut !== 'off'}
          onChange={(e) => setCut(e.target.checked ? 'front' : 'off')}
        />
        Corte {!phone && <Kbd>4</Kbd>}
      </label>
      <div className="pd-group">
        <span className="pd-k" id="pd-outside">
          Fuera de la franja
        </span>
        <div className="segmented" role="group" aria-labelledby="pd-outside">
          {modes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={cut === 'off'}
              aria-pressed={cut === mode}
              onClick={() => setCut(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Tool 3: the profile A–B in a drawer floating at the bottom (over the readout, clear of the
 * credits; on a phone, a sheet at 50 %). A 1:1 plot of the real LiDAR points within the slab, the
 * DTM line, a cursor shared with the scene, the buildings' heights and «Exportar CSV».
 */
export function ProfileDrawer() {
  const phone = usePhone();
  const profile = useProfile();
  const color = useSection((s) => s.color),
    setColor = useSection((s) => s.setColor),
    exaggeration = useSection((s) => s.exaggeration),
    setExaggeration = useSection((s) => s.setExaggeration),
    cursor = useSection((s) => s.cursor),
    setCursor = useSection((s) => s.setCursor),
    setSummary = useSection((s) => s.setSummary);
  const tool = useTool((s) => s.tool);

  // The scene draws the buildings and the plane from this summary. It changes only with the
  // profile's data: useProfile gives a new object on every render (a cursor move re-renders the
  // drawer), and a new summary made the scene redraw the line, the plane and the heights.
  const status = profile?.status,
    points = profile?.points,
    buildings = profile?.buildings,
    geoid = profile?.geoid;
  useEffect(() => {
    if (status !== 'ready' || !points || !buildings || geoid === undefined) {
      setSummary(null);
      return;
    }
    let top = -Infinity;
    for (let i = 0; i < points.count; i++) top = Math.max(top, points.z[i]!);
    setSummary({
      buildings: buildings.map(({ label, at, roof, ground, height }) => ({
        label,
        at,
        roof,
        ground,
        height,
      })),
      top: Number.isFinite(top) ? top : null,
      geoid,
      count: points.count,
    });
  }, [status, points, buildings, geoid, setSummary]);

  // The live region: one polite sentence when a profile is ready.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (profile?.status !== 'ready') return;
    const n = profile.buildings.length;
    setAnnounce(
      `Perfil listo: ${metres(profile.line.length)}, ${n} ${n === 1 ? 'edificio' : 'edificios'}`,
    );
  }, [profile?.status, profile?.line.length, profile?.buildings.length]);

  if (tool !== 'profile' || !profile) return null;
  const header = (
    <>
      <span className="pd-meta num" data-testid="profile-meta">
        {profileMeta(profile)}
      </span>
      <div className="pd-controls">
        <CutControls phone={phone} />
        <div className="pd-group">
          <span className="pd-k" id="pd-color">
            Color
          </span>
          <div className="segmented" role="group" aria-labelledby="pd-color">
            <button type="button" aria-pressed={color === 'rgb'} onClick={() => setColor('rgb')}>
              RGB
            </button>
            <button
              type="button"
              aria-pressed={color === 'class'}
              onClick={() => setColor('class')}
            >
              Clase
            </button>
          </div>
        </div>
        <div className="pd-group">
          <span className="pd-k" id="pd-exag">
            Exageración
          </span>
          <div className="segmented" role="group" aria-labelledby="pd-exag">
            {EXAGGERATIONS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={exaggeration === e}
                onClick={() => setExaggeration(e as Exaggeration)}
              >
                {e}:1
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn"
          disabled={profile.status !== 'ready'}
          onClick={() =>
            download(
              `perfil-${number(profile.line.length, 1)}m.csv`,
              profileCsv(profile.points, profile.dtm),
            )
          }
        >
          Exportar CSV
        </button>
      </div>
    </>
  );
  const body = (
    <ProfileBody
      profile={profile}
      color={color}
      exaggeration={exaggeration}
      cursor={cursor}
      setCursor={setCursor}
    />
  );
  const live = (
    <span className="sr-only" aria-live="polite">
      {announce}
    </span>
  );
  if (phone)
    return (
      <PhoneSheet
        key="profile"
        id="profile-drawer"
        anchorId={toolButtonId('profile')}
        label="Perfil A–B"
        title="Perfil A–B"
        snaps={[50]}
        initial={50}
        onClose={closeProfile}
        testId="profile-drawer"
        className="profile-sheet"
      >
        <div className="pd-phone-head">{header}</div>
        {body}
        {live}
      </PhoneSheet>
    );
  return (
    <section
      className="plate profile-drawer"
      aria-label="Perfil A–B"
      data-map-overlay
      data-testid="profile-drawer"
    >
      <header className="pd-head">
        <h2>Perfil A–B</h2>
        {header}
        <button
          type="button"
          className="close"
          onClick={closeProfile}
          aria-label="Cerrar Perfil A–B"
        >
          <span className="close-text">Cerrar</span>
          <Kbd>Esc</Kbd>
          <X size={14} className="close-icon" aria-hidden="true" />
        </button>
      </header>
      {body}
      {live}
    </section>
  );
}

function ProfileBody({
  profile,
  color,
  exaggeration,
  cursor,
  setCursor,
}: {
  profile: Profile;
  color: 'rgb' | 'class';
  exaggeration: Exaggeration;
  cursor: number | null;
  setCursor: (s: number | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number | null>(null);
  // The pointer, or the keyboard, is on the chart.
  const [onChart, setOnChart] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { points, dtm, buildings, line, half } = profile;
  const range = useMemo(() => heightRange(points, dtm), [points, dtm]);
  const frame: PlotFrame | null = useMemo(() => {
    if (!size.width || !size.height) return null;
    const w = size.width - PLOT_MARGIN.left - PLOT_MARGIN.right,
      h = size.height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
    const pxm = plotScale(w, h, line.length, range.hi - range.lo);
    // With exaggeration the plot grows upwards and the box scrolls.
    const height = Math.max(
      size.height,
      Math.ceil((range.hi - range.lo) * pxm * exaggeration) + PLOT_MARGIN.top + PLOT_MARGIN.bottom,
    );
    return { width: size.width, height, pxm, exaggeration, lo: range.lo };
  }, [size, line.length, range, exaggeration]);
  // Keep the ground in view when the plot grows.
  useLayoutEffect(() => {
    const element = box.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [frame?.height]);
  // The point the cursor reads: the hovered one, or the highest at the cursor's distance.
  const point = useMemo(() => {
    if (cursor === null || !frame) return null;
    if (hover !== null && Math.abs(points.s[hover]! - cursor) < 1) return hover;
    let best: number | null = null;
    for (let i = 0; i < points.count; i++) {
      if (Math.abs(points.s[i]! - cursor) > 0.5) continue;
      if (best === null || points.z[i]! > points.z[best]!) best = i;
    }
    return best;
  }, [cursor, hover, points, frame]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !frame) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(frame.width * ratio);
    element.height = Math.round(frame.height * ratio);
    element.style.width = `${frame.width}px`;
    element.style.height = `${frame.height}px`;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const draw = () =>
      drawProfile(ctx, {
        frame,
        length: line.length,
        half,
        points,
        dtm,
        buildings,
        color,
        cursor: cursor === null ? null : { s: cursor, point },
        ratio,
      });
    draw();
    // The labels use Plex Mono: draw again once it is in.
    let live = true;
    void document.fonts?.load('500 12px "IBM Plex Mono"').then(() => live && draw());
    return () => {
      live = false;
    };
  }, [frame, line.length, half, points, dtm, buildings, color, cursor, point]);

  const move = useCallback(
    (event: React.PointerEvent) => {
      if (!frame || !canvas.current) return;
      const rect = canvas.current.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      const s = sOf(frame, x);
      if (s < 0 || s > line.length) return;
      setHover(pointAt(frame, points, x, y));
      setCursor(s);
    },
    [frame, points, line.length, setCursor],
  );
  const onKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const at = cursor ?? 0;
    if (event.key === 'ArrowRight') setCursor(Math.min(line.length, at + step));
    else if (event.key === 'ArrowLeft') setCursor(Math.max(0, at - step));
    else return;
    setHover(null);
    setOnChart(true);
    event.preventDefault();
  };
  const ground = cursor === null ? null : dtmAt(dtm, cursor);
  const z = point === null ? null : points.z[point]!;
  // While the pointer (or the keyboard) is on the chart, the readout plate at the bottom reads
  // its cursor, as in A/desktop-signature; off the chart it goes back to the scene's cursor.
  const setChart = useSection((s) => s.setChart);
  const d = point === null ? null : points.d[point]!;
  useEffect(() => {
    if (!onChart || cursor === null) setChart(null);
    else
      setChart(
        chartReading(
          profile.line,
          cursor,
          z === null || d === null ? null : { z, d },
          ground,
          profile.geoid,
        ),
      );
  }, [onChart, cursor, z, d, ground, profile.line, profile.geoid, setChart]);
  useEffect(() => () => setChart(null), [setChart]);
  const scaleNote = frame ? `Escala ${exaggeration}:1 · 1 m = ${number(frame.pxm, 1)} px` : '';
  return (
    <div className="pd-body">
      <div className="pd-plot-wrap">
        <div
          className="pd-plot"
          ref={box}
          tabIndex={0}
          role="img"
          aria-label={`Perfil de ${metres(line.length)} con ${grouped(points.count)} puntos LiDAR. Flechas: mover el cursor.`}
          onKeyDown={onKey}
          onFocus={() => setOnChart(true)}
          onBlur={() => setOnChart(false)}
        >
          <canvas
            ref={canvas}
            data-testid="profile-canvas"
            onPointerMove={(event) => {
              setOnChart(true);
              move(event);
            }}
            onPointerLeave={() => {
              setOnChart(false);
              setHover(null);
              setCursor(null);
            }}
          />
          {profile.status !== 'ready' && (
            <p className={`pd-state ${profile.status === 'error' ? 'warn' : ''}`} role="status">
              {profile.status === 'loading'
                ? 'Leyendo los puntos de la franja…'
                : profile.status === 'error'
                  ? `No se pudo leer el perfil: ${profile.error ?? 'error de la API'}`
                  : profile.layers.length
                    ? 'No hay puntos LiDAR en la franja.'
                    : 'La línea no cruza ninguna hoja LiDAR visible.'}
            </p>
          )}
        </div>
        <p className="pd-legend">
          <Kbd signal>A</Kbd>
          <span className="pd-key-line" aria-hidden="true" /> Terreno (MDT del LiDAR, malla 2 m)
          <span className="pd-key-dots" aria-hidden="true" /> Puntos de la franja{' '}
          {color === 'rgb' ? 'en su color RGB' : 'por clase'}; más tenues cuanto más lejos del plano
          <span className="pd-scale num">{scaleNote}</span>
          <Kbd signal>B</Kbd>
        </p>
      </div>
      <aside className="pd-side" aria-label="Lecturas del perfil">
        <h3>Lectura en el cursor</h3>
        <dl className="pd-read" data-testid="profile-readout">
          <dt>Distancia desde A</dt>
          <dd className="num">{cursor === null ? '—' : metres(cursor)}</dd>
          <dt>Cota</dt>
          <dd className="num sig">{z === null ? '—' : metres(z)}</dd>
          <dt>Suelo (MDT)</dt>
          <dd className="num">{ground === null ? '—' : metres(ground)}</dd>
          <dt>Altura sobre el suelo</dt>
          <dd className="num">{z === null || ground === null ? '—' : signed(z - ground)}</dd>
          <dt>Clase</dt>
          <dd>{point === null ? '—' : className(points.cls[point]!)}</dd>
        </dl>
        <h3 title="Altura = cubierta (percentil 95 de la clase 6) menos MDT">
          Alturas en el corte
        </h3>
        {/* Under the heading, not after the list: with five buildings the end of the column is
            below the drawer's edge. */}
        <p className="pd-note pd-note-head" data-testid="profile-heights-note">
          Cubierta (percentil 95, clase 6) menos MDT
        </p>
        {buildings.length ? (
          <ul className="pd-heights" data-testid="profile-heights">
            {buildings.map((b) => (
              <li key={b.label}>
                <Kbd>{b.label}</Kbd>
                <span className="num f1">
                  {number(b.s0, 0)}–{number(b.s1, 0)} m
                </span>
                <span className="num">{metres(b.height)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pd-note">
            {profile.status === 'ready' ? 'La línea no cruza edificios (clase 6).' : '—'}
          </p>
        )}
      </aside>
    </div>
  );
}
