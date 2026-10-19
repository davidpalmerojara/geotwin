import { useEffect, useRef, useState } from 'react';
import { useAssets, useLayers } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { useScene } from '../../stores/viewer';
import { useTool } from '../../stores/tool';
import { measuredGround } from '../layers/lidar-terrain';
import {
  assetReadout,
  geoidAt,
  nextHover,
  readout,
  NBSP,
  NO_GROUND,
  type Cell,
  type HoverEvent,
  type Readout,
} from './readout';

const CELLS: [keyof Readout, string][] = [
  ['position', 'Cursor'],
  ['utm', 'UTM 30N'],
  ['cota', 'Cota'],
  ['suelo', 'Suelo (MDT)'],
  ['sobre', 'Sobre el suelo'],
];
// Cesium reads depth and the picked object only once the cursor rests: never on every frame.
const STILL_MS = 120;

/**
 * Bottom-left readout: the point under the cursor (latitude and longitude, UTM 30N, altitude,
 * ground and height above it), or the selected asset when the cursor is off the scene, and the
 * real-time connection. Mouse moves write straight into the DOM: no React render per move.
 */
export function ReadoutPlate() {
  const api = useScene((s) => s.api),
    lidar = useScene((s) => s.lidar),
    terrain = useScene((s) => s.terrain);
  const layers = useLayers().data,
    assets = useAssets().data;
  const selectedId = useUI((s) => s.selectedAssetId),
    connection = useUI((s) => s.connection);
  const radius = useTool((s) => s.radius);
  const values = useRef<Partial<Record<keyof Readout, HTMLSpanElement | null>>>({});
  const label = useRef<HTMLSpanElement>(null);
  const [cursor, setCursor] = useState(false);
  // The asset whose mark or tag is under the pointer: the marks sit over the canvas, so the
  // pointer leaves the scene there, but it still points at a known place.
  const [over, setOver] = useState<string | null>(null);
  // Latest inputs for the event handlers (they live as long as the viewer).
  const inputs = useRef({ lidar, layers, relief: terrain === 'lidar', assets, selectedId, over });
  useEffect(() => {
    inputs.current = { lidar, layers, relief: terrain === 'lidar', assets, selectedId, over };
  });

  const write = (r: Readout, first: string) => {
    if (label.current) label.current.textContent = first;
    for (const [key] of CELLS) {
      const el = values.current[key];
      const cell: Cell = r[key];
      if (!el) continue;
      el.textContent = cell.text;
      if (cell.reason) {
        el.title = cell.reason;
        el.setAttribute('aria-label', `sin dato: ${cell.reason}`);
      } else {
        el.removeAttribute('title');
        el.removeAttribute('aria-label');
      }
    }
  };
  // While the cursor is off the scene: the asset under the pointer (its mark or tag), else the
  // selected asset, else nothing.
  const showSelection = () => {
    const {
      assets: list,
      selectedId,
      over: hovered,
      lidar: grid,
      layers: sheets,
      relief,
    } = inputs.current;
    const asset = list?.find((a) => a.id === (hovered ?? selectedId));
    if (!asset) {
      write(readout({ point: null, ground: null, geoid: null, relief }), 'Cursor');
      return;
    }
    const { lng, lat } = asset.location;
    const ground = grid ? measuredGround(grid, lng, lat) : null;
    write(
      assetReadout(asset, ground, geoidAt(sheets ?? [], lng, lat), relief),
      hovered && asset.id === hovered ? 'Activo' : 'Selección',
    );
  };
  const showRef = useRef(showSelection);
  useEffect(() => {
    showRef.current = showSelection;
  });
  useEffect(() => {
    if (!cursor) showRef.current();
  }, [cursor, over, selectedId, assets, lidar, terrain]);
  // The asset under the pointer follows the pointer, and also the marks: one that moves away
  // from a still pointer (the camera flies) or is taken out stops being «Activo», and so does
  // everything when the pointer leaves the page. A tap never hovers (see nextHover).
  useEffect(() => {
    const MARK = '.scene-tags [data-asset]';
    const assetOf = (element: Element | null | undefined) =>
      element?.closest?.(MARK)?.getAttribute('data-asset') ?? null;
    let current: string | null = null,
      at: { x: number; y: number } | null = null,
      frame = 0;
    const apply = (event: HoverEvent) => {
      current = nextHover(current, event);
      setOver(current);
    };
    const recheck = () => {
      frame = 0;
      if (current === null) return;
      apply({
        type: 'recheck',
        asset: at ? assetOf(document.elementFromPoint(at.x, at.y)) : null,
      });
    };
    const schedule = () => {
      if (current !== null && !frame) frame = requestAnimationFrame(recheck);
    };
    const over = (event: PointerEvent) => {
      at = event.pointerType === 'mouse' ? { x: event.clientX, y: event.clientY } : null;
      apply({ type: 'over', pointer: event.pointerType, asset: assetOf(event.target as Element) });
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') at = { x: event.clientX, y: event.clientY };
    };
    const out = (event: PointerEvent) => {
      const page = !event.relatedTarget;
      if (page) at = null;
      apply({ type: 'out', pointer: event.pointerType, page });
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', out);
    // The marks are laid out after every frame, and React adds and removes them.
    const offRender = api?.onRender(schedule);
    const marks = new MutationObserver(schedule);
    marks.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      offRender?.();
      marks.disconnect();
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const canvas = api.canvas;
    let frame = 0,
      still: ReturnType<typeof setTimeout> | undefined,
      at: { x: number; y: number } | null = null;
    const show = (surface: ReturnType<typeof api.pickSurface>) => {
      if (!at) return;
      const { lidar: grid, layers: sheets, relief } = inputs.current;
      const hit = surface?.point ?? api.pickGround(at.x, at.y);
      if (!hit) {
        write(
          readout({ point: null, ground: null, geoid: null, relief, missing: NO_GROUND }),
          'Cursor',
        );
        return;
      }
      const ground = grid ? measuredGround(grid, hit.lng, hit.lat) : null;
      // The terrain is drawn a hair under the measured ground: a point on it is the ground.
      const h = surface?.cloud ? hit.h : (ground ?? hit.h);
      write(
        readout({
          point: { ...hit, h },
          ground,
          geoid: geoidAt(sheets ?? [], hit.lng, hit.lat),
          relief,
        }),
        'Cursor',
      );
    };
    const move = (event: PointerEvent) => {
      at = { x: event.clientX, y: event.clientY };
      setCursor(true);
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          show(null);
        });
      clearTimeout(still);
      still = setTimeout(() => at && show(api.pickSurface(at.x, at.y)), STILL_MS);
    };
    const leave = () => {
      at = null;
      clearTimeout(still);
      setCursor(false);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(still);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, [api]);

  // The clock next to «Tiempo real».
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const selection = !cursor && !!(over ?? selectedId);
  // The selection line is short (position, UTM, ground and Radio, as in A); an asset under the
  // pointer also gives its Cota and its height above the ground (its mount).
  const hovering = selection && !!over && !!assets?.some((a) => a.id === over);
  return (
    <div
      className={`plate readout-plate ${selection ? (hovering ? 'hovering' : 'selection') : ''}`}
      data-map-overlay
      data-testid="readout"
    >
      {CELLS.map(([key, name], i) => (
        <span key={key} className={`ro-cell ro-${key}`}>
          <span className="ro-k" ref={i === 0 ? label : undefined}>
            {name}
          </span>
          <span
            className="ro-v num"
            data-testid={`readout-${key}`}
            ref={(el) => {
              values.current[key] = el;
            }}
          >
            —
          </span>
        </span>
      ))}
      {selection && !over && radius && (
        <span className="ro-cell">
          <span className="ro-k">Radio</span>
          <span className="ro-v num">
            {radius.metres >= 1000
              ? `${radius.metres / 1000}${NBSP}km`
              : `${radius.metres}${NBSP}m`}{' '}
            · {radius.count} {radius.count === 1 ? 'activo' : 'activos'}
          </span>
        </span>
      )}
      <span className={`ro-cell ro-live connection ${connection}`} data-testid="connection">
        <i className="live-dot" aria-hidden="true" />
        <span>
          {connection === 'connected'
            ? 'Tiempo real'
            : connection === 'offline'
              ? 'Reconectando'
              : 'Conectando'}
        </span>
        <span className="ro-v num">
          {now.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </span>
    </div>
  );
}
