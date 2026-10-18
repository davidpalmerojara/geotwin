/**
 * The assets in the scene (from direction C, in the colours of A): a mark at each asset's anchor,
 * a stem down to the ground for a mounted one, and a tag with the latest value of its worst
 * sensor, joined to the mark by a leader. Warnings and critical assets add their name and word,
 * and a beam rises from every asset with an active alert (alert-beams.ts).
 *
 * The layer is plain DOM over the canvas, under the HUD's plates. React renders its content when
 * the data change; after every frame of the scene (postRender) the marks, tags and lines are moved
 * by writing into the DOM, without a React render. Tag placement is tag-layout.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CustomDataSource,
  SceneTransforms,
  type Viewer,
} from 'cesium';
import type { Asset } from '@geotwin/shared';
import type { ScreenBox } from '../digital-twin/camera';
import { overlayBoxes } from '../hud/dom';
import { useTool } from '../../stores/tool';
import { STATUS_WORD, useTagInfos, type TagInfo } from './tag-data';
import { overlaps } from '../digital-twin/labels';
import {
  OCCLUSION_SAMPLES,
  isOccluded,
  layoutTags,
  lodFor,
  rankOf,
  type Side,
  type TagItem,
  type TagLod,
} from './tag-layout';
import { AlertBeams, type BeamSpec, type PulseMotion } from './alert-beams';
import { dimensionFontReady, drawDimensions, mountDimension } from '../measure/dimension-lines';

/** Half the size of a mark, px: what other tags keep clear of. */
const MARK = 8;
/** After a camera move the occlusion waits this long at most for the tiles to load. */
const TILES_WAIT_MS = 8000;

interface Props {
  viewer: Viewer;
  assets: Asset[];
  selectedId: string | null;
  /** Assets stand at their mounting height above the terrain (there is relief under them). */
  relief: boolean;
  /** The Google mesh is shown: assets stand on it (RELATIVE_TO_3D_TILE). */
  photoreal: boolean;
  /** Ellipsoidal height of the terrain as the viewer draws it. */
  ground: (lng: number, lat: number) => number;
  /** Boxes of the installation labels, as last placed (canvas px). */
  labelBoxes: React.RefObject<ScreenBox[]>;
  onSelect: (id: string) => void;
}

type Sizes = Record<Exclude<TagLod, 'mark'>, { width: number; height: number }>;

export default function AssetTags({
  viewer,
  assets,
  selectedId,
  relief,
  photoreal,
  ground,
  labelBoxes,
  onSelect,
}: Props) {
  const infos = useTagInfos(assets);
  const hits = useTool((s) => s.radius?.ids);
  // While measuring (and with the later tools that pick on the map) a click on a mark or a tag
  // goes through to the scene: it adds a point instead of selecting the asset.
  const passive = useTool((s) => s.tool !== 'orbit' && s.tool !== 'radius');
  // While a profile is drawn, operational assets show only their mark (the section is the subject).
  const quiet = useTool((s) => s.tool === 'profile');
  const layer = useRef<HTMLDivElement>(null);
  const [fonts, setFonts] = useState(0);
  // Heights of the assets on the Google mesh (sampled after the camera stops), by id.
  const [meshHeights, setMeshHeights] = useState<Map<string, number>>(() => new Map());
  // The anchor of each asset: the height its marker resolves to in the viewer.
  const anchors = useMemo(() => {
    const result = new Map<string, { anchor: Cartesian3; foot: Cartesian3 | null }>();
    for (const a of assets) {
      const { lng, lat } = a.location;
      const floor = ground(lng, lat);
      const mesh = photoreal ? meshHeights.get(a.id) : undefined;
      const height = photoreal ? (mesh ?? floor) : floor + (relief ? a.mount_height_m : 0);
      result.set(a.id, {
        anchor: Cartesian3.fromDegrees(lng, lat, height),
        // The stem runs from a mounted asset down to the ground model under it.
        foot:
          relief && !photoreal && a.mount_height_m > 0
            ? Cartesian3.fromDegrees(lng, lat, floor)
            : null,
      });
    }
    return result;
  }, [assets, ground, relief, photoreal, meshHeights]);

  // Beams and pulses, with their counts on the viewer's element for checks and tests.
  const beams = useRef<AlertBeams | null>(null);
  useEffect(() => {
    const host = viewer.container as HTMLElement;
    const write = (state: { beams: number; pulses: number; motion: PulseMotion }) => {
      host.dataset.beams = String(state.beams);
      host.dataset.pulses = String(state.pulses);
      host.dataset.pulseMotion = state.motion;
    };
    write({ beams: 0, pulses: 0, motion: 'none' });
    const instance = new AlertBeams(viewer, write);
    beams.current = instance;
    return () => {
      instance.destroy();
      beams.current = null;
      delete host.dataset.beams;
      delete host.dataset.pulses;
      delete host.dataset.pulseMotion;
    };
  }, [viewer]);
  useEffect(() => {
    const specs: BeamSpec[] = [];
    for (const info of infos) {
      const at = anchors.get(info.id);
      if (!at || !info.alert || info.status === 'healthy') continue;
      specs.push({ id: info.id, level: info.status, pulse: info.pulse, anchor: at.anchor });
    }
    beams.current?.update(specs);
  }, [infos, anchors]);

  // The selected asset's mounting height as a dimension line («41,9 m sobre el suelo»), drawn in
  // place of its stem.
  const selectedAsset = assets.find((a) => a.id === selectedId);
  const mount =
    selectedAsset && relief && !photoreal && selectedAsset.mount_height_m > 0
      ? {
          lng: selectedAsset.location.lng,
          lat: selectedAsset.location.lat,
          metres: selectedAsset.mount_height_m,
        }
      : null;
  const mountKey = mount ? `${mount.lng},${mount.lat},${mount.metres}` : '';
  const dimensionOf = useRef<string | null>(null);
  // Its value is a DOM label (not a Cesium one) so it can step aside from the floating card.
  const mountLabel = useRef<{ at: Cartesian3; text: string } | null>(null);
  const mountElement = useRef<HTMLSpanElement>(null);
  const [mountText, setMountText] = useState('');
  useEffect(() => {
    if (!mountKey) return;
    const [lng, lat, metres] = mountKey.split(',').map(Number) as [number, number, number];
    const source = new CustomDataSource('cota-montaje');
    const added = viewer.dataSources.add(source);
    let live = true;
    void dimensionFontReady().then(() => {
      if (!live || viewer.isDestroyed()) return;
      const dimension = mountDimension(lng, lat, ground(lng, lat), metres);
      drawDimensions(source, [{ ...dimension, labels: [] }], 'montaje');
      const label = dimension.labels[0]!;
      mountLabel.current = { at: label.at, text: label.text };
      setMountText(label.text);
      dimensionOf.current = selectedId;
      viewer.scene.requestRender();
    });
    return () => {
      live = false;
      dimensionOf.current = null;
      mountLabel.current = null;
      setMountText('');
      void added.then(() => {
        if (viewer.isDestroyed()) return;
        viewer.dataSources.remove(source, true);
        viewer.scene.requestRender();
      });
    };
  }, [mountKey, viewer, ground, selectedId]);

  // Tags are measured once per content change (both levels of detail), never per frame.
  const sizes = useRef(new Map<string, Sizes>());
  useEffect(() => {
    let live = true;
    // Plex Mono 500 and Plex Sans Condensed load on demand: measure once they are in.
    void Promise.all([
      document.fonts?.load('500 12px "IBM Plex Mono"'),
      document.fonts?.load('600 13px "IBM Plex Sans Condensed"'),
    ])
      .catch(() => undefined)
      .then(() => live && setFonts((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);
  useLayoutEffect(() => {
    const root = layer.current;
    if (!root) return;
    const tags = [...root.querySelectorAll<HTMLElement>('.scene-tag')];
    const read = (lod: string) => {
      for (const tag of tags) tag.dataset.measure = lod;
      return tags.map((tag) => ({ width: tag.offsetWidth, height: tag.offsetHeight }));
    };
    const full = read('full'),
      value = read('value');
    for (const tag of tags) delete tag.dataset.measure;
    sizes.current = new Map(
      tags.map((tag, i) => [tag.dataset.asset!, { full: full[i]!, value: value[i]! }]),
    );
    viewer.scene.requestRender();
  }, [infos, fonts, viewer]);

  // State of the placement shared by the frames: sides kept between frames, hidden marks.
  const sides = useRef(new Map<string, Side>());
  const occluded = useRef(new Set<string>());
  const live = useRef({ infos, anchors, selectedId, hits, quiet });
  useEffect(() => {
    live.current = { infos, anchors, selectedId, hits, quiet };
    occlusionDue.current = performance.now();
    viewer.scene.requestRender();
  }, [infos, anchors, selectedId, hits, quiet, viewer]);
  const occlusionDue = useRef<number | null>(null);

  useEffect(() => {
    const scene = viewer.scene,
      camera = viewer.camera;
    const tilesLoaded = () => {
      if (scene.globe.show && !scene.globe.tilesLoaded) return false;
      for (let i = 0; i < scene.primitives.length; i++) {
        const p: unknown = scene.primitives.get(i);
        if (p instanceof Cesium3DTileset && p.show && !p.tilesLoaded) return false;
      }
      return true;
    };
    const offMove = camera.moveEnd.addEventListener(() => {
      occlusionDue.current = performance.now();
    });
    // Development builds keep the last depth samples for checks.
    const depthSamples = new Map<string, (number | null)[]>();
    const place = () => {
      const root = layer.current;
      if (!root || viewer.isDestroyed()) return;
      const { infos, anchors, selectedId, hits, quiet } = live.current;
      const width = scene.canvas.clientWidth,
        height = scene.canvas.clientHeight;
      const rect = scene.canvas.getBoundingClientRect();
      const position = camera.positionWC,
        direction = camera.directionWC;
      const toward = new Cartesian3();
      // Where each mark is on screen, how far it is and what its tag shows.
      const shown: { info: TagInfo; x: number; y: number; distance: number; lod: TagLod }[] = [];
      const marks = new Map<string, ScreenBox>();
      const feet = new Map<string, Cartesian2>();
      for (const info of infos) {
        const at = anchors.get(info.id);
        if (!at) continue;
        Cartesian3.subtract(at.anchor, position, toward);
        if (Cartesian3.dot(toward, direction) <= 0) continue;
        const p = SceneTransforms.worldToWindowCoordinates(scene, at.anchor);
        if (!p || p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) continue;
        const distance = Cartesian3.magnitude(toward);
        const selected = info.id === selectedId;
        shown.push({
          info,
          x: p.x,
          y: p.y,
          distance,
          lod: lodFor(distance, info.status, selected, quiet),
        });
        marks.set(info.id, {
          left: p.x - MARK,
          right: p.x + MARK,
          top: p.y - MARK,
          bottom: p.y + MARK,
        });
        if (at.foot) {
          const f = SceneTransforms.worldToWindowCoordinates(scene, at.foot);
          if (f) feet.set(info.id, f);
        }
      }
      const items: TagItem[] = [];
      for (const s of shown) {
        if (s.lod === 'mark') continue;
        const size = sizes.current.get(s.info.id)?.[s.lod];
        if (!size?.width) continue;
        items.push({
          id: s.info.id,
          x: s.x,
          y: s.y,
          width: size.width,
          height: size.height,
          distance: s.distance,
          rank: rankOf(s.info.status, s.info.id === selectedId, !!hits?.includes(s.info.id)),
        });
      }
      const blocked = [
        ...overlayBoxes().map((b) => ({
          left: b.left - rect.left,
          right: b.right - rect.left,
          top: b.top - rect.top,
          bottom: b.bottom - rect.top,
        })),
        ...(labelBoxes.current ?? []),
      ];
      // The mounting height's value: to the left of the dimension line, or to its right when a
      // plate (the card) is there; tags keep clear of it.
      const value = mountElement.current,
        label = mountLabel.current;
      if (value) {
        const at = label ? SceneTransforms.worldToWindowCoordinates(scene, label.at) : undefined;
        const w = value.offsetWidth,
          h = value.offsetHeight;
        const boxAt = (left: number) =>
          at ? { left, right: left + w, top: at.y - h / 2, bottom: at.y + h / 2 } : null;
        const free = (box: ScreenBox | null) =>
          !!box && box.left >= 0 && box.right <= width && !blocked.some((b) => overlaps(box, b));
        const box = at ? [boxAt(at.x - 12 - w), boxAt(at.x + 12)].find(free) : undefined;
        if (box) {
          value.style.display = '';
          value.style.transform = `translate(${box.left}px, ${box.top}px)`;
          blocked.push(box);
        } else value.style.display = 'none';
      }
      const placement = layoutTags(items, {
        view: { width, height },
        blocked,
        marks,
        previous: sides.current,
      });
      // Occlusion: read from the depth of a finished frame, after the camera stops.
      const due = occlusionDue.current;
      if (due !== null && (tilesLoaded() || performance.now() - due > TILES_WAIT_MS)) {
        occlusionDue.current = null;
        occluded.current = new Set();
        const heights = new Map<string, number>();
        for (const s of shown) {
          if (scene.pickPositionSupported) {
            const samples = OCCLUSION_SAMPLES.map(([dx, dy]) => {
              const hit = scene.pickPosition(new Cartesian2(s.x + dx, s.y + dy));
              return hit && Number.isFinite(hit.x) && Cartesian3.magnitude(hit) > 6e6
                ? Cartesian3.distance(position, hit)
                : null;
            });
            if (isOccluded(s.distance, samples)) occluded.current.add(s.info.id);
            if (import.meta.env.DEV) depthSamples.set(s.info.id, [s.distance, ...samples]);
          }
        }
        if (photoreal && scene.sampleHeightSupported)
          for (const a of assets) {
            const h = scene.sampleHeight(
              Cartographic.fromDegrees(a.location.lng, a.location.lat),
              beams.current ? [...beams.current.entities] : undefined,
            );
            if (h !== undefined) heights.set(a.id, h);
          }
        if (heights.size && !sameHeights(heights, meshHeightsRef.current))
          queueMicrotask(() => setMeshHeights(heights));
      }
      // Write the frame into the DOM.
      const seen = new Set(shown.map((s) => s.info.id));
      for (const element of root.querySelectorAll<HTMLElement>('[data-asset]')) {
        const id = element.dataset.asset!;
        const s = shown.find((x) => x.info.id === id);
        const kind = element.dataset.part;
        if (!s || !seen.has(id)) {
          hide(element);
          continue;
        }
        const hidden = occluded.current.has(id);
        if (kind === 'mark') {
          show(element);
          element.style.transform = `translate(${s.x}px, ${s.y}px)`;
          toggle(element, 'occluded', hidden);
        } else if (kind === 'tag') {
          const at = placement.get(id);
          if (!at || s.lod === 'mark') {
            hide(element);
            continue;
          }
          show(element);
          element.dataset.lod = s.lod;
          element.style.transform = `translate(${at.left}px, ${at.top}px)`;
          toggle(element, 'occluded', hidden);
          sides.current.set(id, at.side);
        } else if (kind === 'leader') {
          const at = placement.get(id);
          if (!at || s.lod === 'mark') {
            hide(element);
            continue;
          }
          show(element);
          line(element, at.leader.x1, at.leader.y1, at.leader.x2, at.leader.y2);
        } else if (kind === 'stem') {
          const foot = feet.get(id);
          // The selected asset's mounting dimension takes the place of its stem.
          if (!foot || dimensionOf.current === id) {
            hide(element);
            continue;
          }
          show(element);
          line(element, s.x, s.y + MARK - 2, foot.x, foot.y);
        }
      }
      for (const id of [...sides.current.keys()]) if (!placement.get(id)) sides.current.delete(id);
      if (import.meta.env.DEV)
        (window as Window & { __geotwinTags?: unknown }).__geotwinTags = {
          placed: [...placement].filter(([, p]) => p).map(([id]) => id),
          occluded: [...occluded.current],
          samples: Object.fromEntries(depthSamples),
        };
    };
    const offRender = scene.postRender.addEventListener(place);
    scene.requestRender();
    return () => {
      offMove();
      offRender();
    };
  }, [viewer, labelBoxes, photoreal, assets]);
  const meshHeightsRef = useRef(meshHeights);
  useEffect(() => {
    meshHeightsRef.current = meshHeights;
  }, [meshHeights]);

  return (
    <div
      className="scene-tags"
      ref={layer}
      data-testid="scene-tags"
      data-passive={passive || undefined}
    >
      <svg className="scene-tags-lines" aria-hidden="true">
        {infos.map((info) => (
          <g key={info.id} className={`tag-lines tag-${info.status}`}>
            <line data-asset={info.id} data-part="stem" className="tag-stem" display="none" />
            <line data-asset={info.id} data-part="leader" className="tag-leader" display="none" />
          </g>
        ))}
      </svg>
      <span
        ref={mountElement}
        className="dim-label num"
        data-testid="mount-dimension"
        style={{ display: 'none' }}
        hidden={!mountText}
      >
        {mountText}
      </span>
      {infos.map((info) => (
        <span
          key={`mark:${info.id}`}
          className={`scene-mark mark-${info.status}`}
          data-asset={info.id}
          data-part="mark"
          data-selected={info.id === selectedId || undefined}
          data-pulse={info.pulse || undefined}
          aria-hidden="true"
          title={info.name}
          onClick={() => onSelect(info.id)}
          style={{ display: 'none' }}
        >
          <i />
        </span>
      ))}
      {infos.map((info) => (
        <div
          key={`tag:${info.id}`}
          className={`scene-tag tag-${info.status}`}
          role="img"
          aria-label={info.label}
          data-testid="scene-tag"
          data-asset={info.id}
          data-part="tag"
          data-status={info.status}
          data-lod="value"
          data-selected={info.id === selectedId || undefined}
          onClick={() => onSelect(info.id)}
          style={{ display: 'none' }}
        >
          {info.status !== 'healthy' && (
            <i className={`glyph glyph-${info.status}`} aria-hidden="true" />
          )}
          <span className="tag-name">{info.name}</span>
          <span className="tag-value num">{info.value}</span>
          {info.status !== 'healthy' && (
            <span className="tag-word">{STATUS_WORD[info.status]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function sameHeights(a: Map<string, number>, b: Map<string, number>) {
  if (a.size !== b.size) return false;
  for (const [id, h] of a) if (Math.abs((b.get(id) ?? Infinity) - h) > 0.5) return false;
  return true;
}
function show(element: Element) {
  if (element instanceof SVGElement) element.removeAttribute('display');
  else (element as HTMLElement).style.display = '';
}
function hide(element: Element) {
  if (element instanceof SVGElement) element.setAttribute('display', 'none');
  else (element as HTMLElement).style.display = 'none';
}
function toggle(element: Element, name: string, on: boolean) {
  if (element.classList.contains(name) !== on) element.classList.toggle(name, on);
}
function line(element: Element, x1: number, y1: number, x2: number, y2: number) {
  element.setAttribute('x1', x1.toFixed(1));
  element.setAttribute('y1', y1.toFixed(1));
  element.setAttribute('x2', x2.toFixed(1));
  element.setAttribute('y2', y2.toFixed(1));
}
