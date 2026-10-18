/**
 * The scene side of tools 3, 4 and 5 (loaded on demand, with Cesium): the profile's points and
 * line, the cut on the LiDAR tilesets and Radio's ring. The drawer and the panels are plain React
 * outside this chunk; they share state through stores/section.ts and stores/tool.ts.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Viewer } from 'cesium';
import { useSection } from '../../stores/section';
import { useTool } from '../../stores/tool';
import { useAssets } from '../../hooks/data';
import { ProfileScene } from './profile-tool';
import { CutTool } from './cut-tool';
import { RadiusRing } from './radius-ring';
import { makeLine } from './section-math';

type Ground = (lng: number, lat: number) => number;

function ProfileLayer({ viewer, ground }: { viewer: Viewer; ground: Ground }) {
  const scene = useRef<ProfileScene | null>(null);
  useEffect(() => {
    const instance = new ProfileScene(viewer, ground, {
      place: (p) => useSection.getState().place(p),
      move: (which, p) => useSection.getState().move(which, p),
      dragging: (on) => useSection.getState().setDragging(on),
      cursor: (s) => useSection.getState().setCursor(s),
      ends: () => {
        const { a, b } = useSection.getState();
        return { a, b };
      },
    });
    scene.current = instance;
    // Picking is on: checks and tests wait for this before clicking A and B.
    const host = viewer.container as HTMLElement;
    host.dataset.profile = 'on';
    const draw = () => {
      const { a, b, summary, cursor } = useSection.getState();
      instance.update({ a, b, summary, cursor });
    };
    draw();
    const off = useSection.subscribe((state, previous) => {
      if (
        state.a !== previous.a ||
        state.b !== previous.b ||
        state.summary !== previous.summary ||
        state.cursor !== previous.cursor
      )
        draw();
    });
    return () => {
      off();
      instance.destroy();
      scene.current = null;
      delete host.dataset.profile;
    };
  }, [viewer, ground]);
  return null;
}

function CutLayer({ viewer }: { viewer: Viewer }) {
  const a = useSection((s) => s.a),
    b = useSection((s) => s.b),
    half = useSection((s) => s.half),
    cut = useSection((s) => s.cut);
  const tool = useRef<CutTool | null>(null);
  const on = cut !== 'off';
  useEffect(() => {
    if (!on) return;
    const instance = new CutTool(viewer, viewer.container as HTMLElement);
    tool.current = instance;
    return () => {
      instance.destroy();
      tool.current = null;
    };
  }, [viewer, on]);
  const line = useMemo(() => (a && b ? makeLine(a, b) : null), [a, b]);
  useEffect(() => {
    if (cut !== 'off') tool.current?.update(line, half, cut);
  }, [line, half, cut]);
  return null;
}

function RadiusLayer({ viewer, ground }: { viewer: Viewer; ground: Ground }) {
  const radius = useTool((s) => s.radius);
  const assets = useAssets().data;
  const ring = useRef<RadiusRing | null>(null);
  useEffect(() => {
    const instance = new RadiusRing(viewer, viewer.container as HTMLElement, ground, (p) =>
      useTool.getState().setRadiusPoint(p),
    );
    ring.current = instance;
    return () => {
      instance.destroy();
      ring.current = null;
    };
  }, [viewer, ground]);
  useEffect(() => {
    ring.current?.update(
      radius
        ? {
            center: radius.center,
            metres: radius.metres,
            items: radius.items.map((item) => {
              const asset = assets?.find((a) => a.id === item.id);
              return {
                id: item.id,
                lng: item.lng,
                lat: item.lat,
                distance_m: item.distance_m,
                mount: asset?.mount_height_m ?? 0,
              };
            }),
          }
        : null,
    );
  }, [radius, assets]);
  return null;
}

function SectionScene({ viewer, ground }: { viewer: Viewer; ground: Ground }) {
  const tool = useTool((s) => s.tool);
  return (
    <>
      {tool === 'profile' && <ProfileLayer viewer={viewer} ground={ground} />}
      {tool === 'profile' && <CutLayer viewer={viewer} />}
      {tool === 'radius' && <RadiusLayer viewer={viewer} ground={ground} />}
    </>
  );
}

// Memoized: the HUD around it re-renders for its own reasons (a sheet, a panel), the scene need not.
export default memo(SectionScene);
