import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Layer, Section } from '@geotwin/shared';
import { api } from '../../lib/api';
import { useLayers } from '../../hooks/data';
import { useLayerView } from '../../stores/layers';
import { useScene } from '../../stores/viewer';
import { useSection, type LngLat } from '../../stores/section';
import { measuredGround } from '../layers/lidar-terrain';
import { geoidAt } from '../hud/readout';
import {
  buildingHeights,
  makeLine,
  mergeSections,
  sampleDtmLine,
  type Building,
  type DtmLine,
  type Line,
  type ProfilePoints,
} from './section-math';

/** A and B as the queries use them: they settle once a drag ends (250 ms after the last move). */
function useSettled(a: LngLat | null, b: LngLat | null, dragging: boolean) {
  const [settled, setSettled] = useState({ a, b });
  useEffect(() => {
    if (dragging) return;
    const timer = setTimeout(() => setSettled({ a, b }), a && b ? 250 : 0);
    return () => clearTimeout(timer);
  }, [a, b, dragging]);
  return settled;
}

/** Whether a layer's box crosses the slab around A–B (a cheap test in degrees). */
export function crosses(layer: Pick<Layer, 'bbox'>, line: Line, half: number) {
  const box = layer.bbox;
  if (!box) return false;
  const pad = { lng: (half + 2) / line.scale.lng, lat: (half + 2) / line.scale.lat };
  const west = Math.min(line.a.lng, line.b.lng) - pad.lng,
    east = Math.max(line.a.lng, line.b.lng) + pad.lng,
    south = Math.min(line.a.lat, line.b.lat) - pad.lat,
    north = Math.max(line.a.lat, line.b.lat) + pad.lat;
  return box[0] <= east && box[2] >= west && box[1] <= north && box[3] >= south;
}

export interface Profile {
  line: Line;
  half: number;
  /** Ready, visible layers whose box crosses the line. */
  layers: Layer[];
  status: 'loading' | 'error' | 'ready' | 'empty';
  error?: string;
  points: ProfilePoints;
  /** The DTM along A–B every metre, as altitudes. */
  dtm: DtmLine;
  buildings: Building[];
  /** N of the first layer (to go back to ellipsoidal heights in the scene). */
  geoid: number;
}

const EMPTY: ProfilePoints = {
  count: 0,
  s: new Float64Array(0),
  d: new Float32Array(0),
  z: new Float32Array(0),
  cls: new Uint8Array(0),
  rgb: new Uint32Array(0),
};

/**
 * The profile along the current A–B: the sections of every ready, visible layer the line crosses
 * (from the API, merged), the DTM line from the ground model the viewer already has (bilinear,
 * every metre) and the building heights. Null until A and B are both placed.
 */
export function useProfile(): Profile | null {
  const a = useSection((s) => s.a),
    b = useSection((s) => s.b),
    half = useSection((s) => s.half),
    dragging = useSection((s) => s.dragging);
  const settled = useSettled(a, b, dragging);
  const all = useLayers().data;
  const hidden = useLayerView((s) => s.hidden);
  const lidar = useScene((s) => s.lidar);
  const line = useMemo(
    () => (settled.a && settled.b ? makeLine(settled.a, settled.b) : null),
    [settled],
  );
  const layers = useMemo(
    () =>
      line
        ? (all ?? []).filter(
            (l) => l.status === 'ready' && l.tileset_url && !hidden[l.id] && crosses(l, line, half),
          )
        : [],
    [all, hidden, line, half],
  );
  const results = useQueries({
    queries: layers.map((layer) => ({
      queryKey: ['section', layer.id, layer.tileset_url, line?.a, line?.b, half],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.section(layer.id, line!.a, line!.b, half, signal),
      enabled: !!line,
      staleTime: Infinity,
      gcTime: 60_000,
    })),
  });
  const sections = results.map((r) => r.data).filter((d): d is Section => !!d);
  const key = sections.map((s) => `${s.layer_id}:${s.count}`).join(',');
  const loading = results.some((r) => r.isPending);
  const failed = results.find((r) => r.isError)?.error;
  const points = useMemo(
    () => (sections.length ? mergeSections(sections) : EMPTY),
    // The sections change only with their key (layer and count) once loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const geoid =
    sections[0]?.geoid_offset_m ?? (line ? geoidAt(all ?? [], line.a.lng, line.a.lat) : 0) ?? 0;
  const dtm = useMemo(() => {
    if (!line) return { s: [], h: [] };
    return sampleDtmLine(line, (lng, lat) => {
      const h = lidar ? measuredGround(lidar, lng, lat) : null;
      const n = geoidAt(all ?? [], lng, lat) ?? geoid;
      return h === null ? null : h - n;
    });
  }, [line, lidar, all, geoid]);
  const buildings = useMemo(() => buildingHeights(points, dtm), [points, dtm]);
  if (!line) return null;
  return {
    line,
    half,
    layers,
    status: failed
      ? 'error'
      : loading
        ? 'loading'
        : layers.length && points.count
          ? 'ready'
          : 'empty',
    error: failed instanceof Error ? failed.message : undefined,
    points,
    dtm,
    buildings,
    geoid,
  };
}
