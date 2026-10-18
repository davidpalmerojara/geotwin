import { useEffect, useState } from 'react';
import { useAssets, useInstallations } from '../../hooks/data';
import { useScene } from '../../stores/viewer';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { coveredEdges, distanceM } from '../digital-twin/camera';
import { formatMetres } from './readout';
import { Glyph } from './glyphs';
import { overlayBoxes } from './dom';
import {
  bearing,
  compass,
  edgeChip,
  MARGIN,
  GAP,
  MAX_CHIPS,
  outOfSight,
  pickChips,
  placeChips,
  type Box,
  type EdgeChip,
} from './placement';
import { number } from '../../lib/format';
import type { AssetStatus } from '@geotwin/shared';

interface Target {
  key: string;
  kind: 'installation' | 'asset';
  id: string;
  name: string;
  status?: AssetStatus;
  lng: number;
  lat: number;
  mount: number;
}
type Chip = EdgeChip & {
  width: number;
  height: number;
  target: Target;
  distance: number;
  compass: string;
};

const CHIP_H = 24;
const MORE_W = 48;
/** Alerts first (critical, then warning), then Radio's results, then the installations. */
const rankOf = (c: Chip) =>
  c.target.status === 'critical'
    ? 0
    : c.target.status === 'warning'
      ? 1
      : c.target.kind === 'asset'
        ? 2
        : 3;
const widthOf = (name: string) => Math.min(300, Math.round(name.length * 6.3 + 104));
const km = (m: number) => (m >= 1000 ? `${number(m / 1000, 1)} km` : formatMetres(m, 0));

/**
 * Installations (assets in alert, and Radio's results) that are out of sight (off the screen,
 * behind the camera or under a plate) become chips on the edge of the free part of the scene,
 * pointing at them, with the compass bearing and the distance from the centre of the view. One
 * that is visible between the plates keeps only its mark and tag. At most MAX_CHIPS show, the
 * most urgent first; a «+n» chip shows the rest. A click flies there.
 */
export function EdgeChips() {
  const api = useScene((s) => s.api),
    relief = useScene((s) => s.relief);
  const installations = useInstallations().data,
    assets = useAssets().data;
  const setInstallation = useUI((s) => s.setInstallation),
    select = useUI((s) => s.selectAsset);
  // Radio's results get a chip too when they are out of sight or behind a plate.
  const hits = useTool((s) => s.radius?.ids.join(','));
  const [chips, setChips] = useState<Chip[]>([]);
  const [more, setMore] = useState<{ count: number; left: number; top: number } | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!api) return;
    const inRadius = new Set(hits ? hits.split(',') : []);
    const targets: Target[] = [
      ...(installations ?? []).map((i) => ({
        key: `i:${i.id}`,
        kind: 'installation' as const,
        id: i.id,
        name: i.name,
        lng: i.location.lng,
        lat: i.location.lat,
        mount: 0,
      })),
      ...(assets ?? [])
        .filter((a) => a.status !== 'healthy' || inRadius.has(a.id))
        .map((a) => ({
          key: `a:${a.id}`,
          kind: 'asset' as const,
          id: a.id,
          name: a.name,
          status: a.status,
          lng: a.location.lng,
          lat: a.location.lat,
          mount: a.mount_height_m,
        })),
    ];
    let frame = 0;
    const update = () => {
      frame = 0;
      const width = window.innerWidth,
        height = window.innerHeight;
      const plates = overlayBoxes();
      const edges = coveredEdges({ left: 0, top: 0, right: width, bottom: height }, plates);
      const free: Box = {
        left: Math.max(MARGIN, edges.left + GAP),
        top: Math.max(MARGIN, edges.top + GAP),
        right: width - Math.max(MARGIN, edges.right + GAP),
        bottom: height - Math.max(MARGIN, edges.bottom + GAP),
      };
      if (free.right - free.left < 200 || free.bottom - free.top < 120) {
        setChips([]);
        setMore(null);
        return;
      }
      const camera = api.camera();
      const from = camera.center ?? null;
      const next: Chip[] = [];
      for (const t of targets) {
        const h = api.groundAt(t.lng, t.lat) + (relief ? t.mount : 0);
        const at = api.project(t.lng, t.lat, h);
        if (!outOfSight(at, { width, height }, plates)) continue;
        const origin = from ?? { lng: t.lng, lat: t.lat };
        const deg = bearing(origin, t);
        const size = { width: widthOf(t.name), height: CHIP_H };
        const chip = edgeChip(free, size, at, deg - camera.heading);
        if (!chip) continue;
        next.push({
          ...chip,
          ...size,
          target: t,
          distance: from ? distanceM(from, t) : 0,
          compass: compass(deg),
        });
      }
      const picked = pickChips(next, rankOf, all);
      const shown = picked.shown.sort(
        (a, b) => a.side.localeCompare(b.side) || a.top - b.top || a.left - b.left,
      );
      // The «+n» chip (or «menos» when all show) goes after the last chip on its edge.
      const last = shown[shown.length - 1];
      const toggle = shown.length + picked.more > MAX_CHIPS;
      const extra =
        toggle && last
          ? {
              ...last,
              width: MORE_W,
              height: CHIP_H,
              target: { ...last.target, key: 'more' },
            }
          : null;
      // Along their edges, apart from each other and clear of a card floating in the free area.
      const placed = placeChips(extra ? [...shown, extra] : shown, free, plates);
      const tail = extra ? placed.pop() : null;
      setChips(placed.filter((c): c is Chip => !!c));
      setMore(tail ? { count: picked.more, left: tail.left, top: tail.top } : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    const off = api.onCamera(schedule);
    window.addEventListener('resize', schedule);
    // Panels opening and closing change the free area without a camera move.
    const observer = new MutationObserver((records) => {
      if (records.some((r) => !(r.target as Element).closest?.('.edge-chips'))) schedule();
    });
    const hud = document.querySelector('.hud');
    if (hud) observer.observe(hud, { childList: true, subtree: true, attributes: false });
    return () => {
      off();
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [api, installations, assets, relief, hits, all]);
  return (
    <div className="edge-chips">
      {chips.map((c) => (
        <button
          key={c.target.key}
          type="button"
          className={`edge-chip edge-${c.side}`}
          style={{ left: c.left, top: c.top, width: c.width }}
          data-testid="edge-chip"
          aria-label={`${c.target.name}: a ${km(c.distance)} hacia el ${c.compass}. Ir allí.`}
          onClick={() =>
            c.target.kind === 'installation' ? setInstallation(c.target.id) : select(c.target.id)
          }
        >
          <svg
            width="12"
            height="12"
            viewBox="-6 -6 12 12"
            aria-hidden="true"
            className="edge-arrow"
          >
            <path d="M0,-5 L4.5,4 L0,2 L-4.5,4 Z" transform={`rotate(${c.angle})`} />
          </svg>
          {c.target.status && <Glyph status={c.target.status} />}
          <span className="edge-name">{c.target.name}</span>
          <span className="edge-dist num">
            {c.distance ? km(c.distance) : ''} {c.compass}
          </span>
        </button>
      ))}
      {more && (
        <button
          type="button"
          className="edge-chip edge-more"
          style={{ left: more.left, top: more.top, width: MORE_W }}
          data-testid="edge-chip-more"
          aria-expanded={all}
          aria-label={
            all
              ? 'Mostrar solo los avisos más urgentes del borde'
              : `${more.count} más fuera de la vista o tapados. Mostrarlos.`
          }
          onClick={() => setAll((x) => !x)}
        >
          <span className="num">{all ? '−' : `+${more.count}`}</span>
        </button>
      )}
    </div>
  );
}
