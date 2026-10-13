/**
 * Keeps the viewer's 3D Tiles point clouds in step with the layer list and the "Capas" panel.
 * Lives in the lazy Cesium chunk; tiles are only requested for layers that are ready and visible.
 */
import { useEffect, useRef } from 'react';
import {
  BoundingSphere,
  Cartesian3,
  Cesium3DTileset,
  Cesium3DTileStyle,
  Credit,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PointCloudShading,
  Rectangle,
  type Viewer,
} from 'cesium';
import type { Layer } from '@geotwin/shared';
import { useLayers } from '../../hooks/data';
import { useLayerView } from '../../stores/layers';
import { aimShift } from '../digital-twin/camera';
import { coveredByOverlays, shiftedRight, viewerFov } from '../digital-twin/overlays';
import {
  buildPointCloudStyle,
  ellipsoidalRange,
  globeShift,
  heightExpression,
  pointSpacing,
  QUALITY_SSE,
  shadingFor,
} from './point-style';
import { SharedCredits } from './shared-credits';

interface Loaded {
  url: string;
  tileset?: Cesium3DTileset;
  attribution?: string;
  creditShown: boolean;
  // Last style and placement applied: restyling recompiles shaders, so skip identical ones.
  styleKey?: string;
  shift?: number;
  failed: boolean;
  disposed: boolean;
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function usePointCloudLayers(viewer: Viewer | null, ready: boolean, onTerrain: boolean) {
  const layers = useLayers().data;
  const hidden = useLayerView((s) => s.hidden),
    colorMode = useLayerView((s) => s.colorMode),
    classes = useLayerView((s) => s.classes),
    pointSize = useLayerView((s) => s.pointSize),
    quality = useLayerView((s) => s.quality),
    realHeight = useLayerView((s) => s.realHeight),
    flyTo = useLayerView((s) => s.flyTo),
    setRender = useLayerView((s) => s.setRender);
  const loaded = useRef(new Map<string, Loaded>());

  // Load, show, hide and destroy tilesets.
  useEffect(() => {
    if (!viewer || !ready) return;
    const current = loaded.current;
    const wanted = new Map(
      (layers ?? [])
        .filter((l) => l.status === 'ready' && l.tileset_url)
        .map((l) => [l.id, l] as const),
    );
    for (const [id, entry] of current) {
      const layer = wanted.get(id);
      if (!layer || layer.tileset_url !== entry.url) {
        dispose(viewer, entry);
        current.delete(id);
        setRender(id, null);
      }
    }
    for (const [id, layer] of wanted) {
      const visible = !hidden[id];
      let entry = current.get(id);
      if (!entry && visible) {
        entry = { url: layer.tileset_url!, creditShown: false, failed: false, disposed: false };
        current.set(id, entry);
        setRender(id, 'loading');
        const target = entry;
        Cesium3DTileset.fromUrl(layer.tileset_url!, {
          maximumScreenSpaceError: QUALITY_SSE[quality],
          pointCloudShading: new PointCloudShading(shadingFor(pointSize, pointSpacing(layer))),
        })
          .then((tileset) => {
            if (target.disposed || viewer.isDestroyed()) {
              tileset.destroy();
              return;
            }
            target.tileset = tileset;
            // The layer may have been hidden while its tileset.json was loading.
            tileset.show = !useLayerView.getState().hidden[id];
            if (layer.attribution) target.attribution = layer.attribution;
            viewer.scene.primitives.add(tileset);
            tileset.tileFailed.addEventListener(() => setRender(id, 'error'));
            setRender(id, 'shown');
            apply(viewer, layer, target, useLayerView.getState(), onTerrain);
          })
          .catch(() => {
            target.failed = true;
            setRender(id, 'error');
          });
      }
      if (entry?.tileset) {
        entry.tileset.show = visible;
        syncCredit(viewer, entry, visible);
      }
    }
    viewer.scene.requestRender();
    // Quality and point size only matter for a new tileset here; the next effect updates the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, ready, layers, hidden, onTerrain, setRender]);

  // Style, shading, quality and placement for every loaded tileset.
  useEffect(() => {
    if (!viewer || !ready) return;
    for (const [id, entry] of loaded.current) {
      const layer = layers?.find((l) => l.id === id);
      if (layer && entry.tileset)
        apply(
          viewer,
          layer,
          entry,
          { colorMode, classes, pointSize, quality, realHeight },
          onTerrain,
        );
    }
    viewer.scene.requestRender();
  }, [viewer, ready, layers, colorMode, classes, pointSize, quality, realHeight, onTerrain]);

  // Fly to a layer: its loaded bounding volume, or the footprint the worker measured.
  useEffect(() => {
    const request = flyTo;
    if (!viewer || !ready || !request) return;
    const layer = layers?.find((l) => l.id === request.id);
    if (!layer) return;
    const entry = loaded.current.get(layer.id);
    const sphere = entry?.tileset
      ? BoundingSphere.clone(entry.tileset.boundingSphere)
      : footprintSphere(
          layer,
          placementShift(layer, useLayerView.getState().realHeight, onTerrain),
        );
    if (!sphere) return;
    const heading = CesiumMath.toRadians(20),
      range = Math.max(sphere.radius * 2.6, 120);
    revealMap(viewer.container);
    viewer.camera.flyToBoundingSphere(clearOfOverlays(viewer, sphere, heading, range), {
      duration: 1.2,
      offset: new HeadingPitchRange(heading, CesiumMath.toRadians(-38), range),
    });
    viewer.scene.requestRender();
    // Only a new request flies; layer updates do not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo, viewer, ready]);

  // Destroy everything with the viewer.
  useEffect(() => {
    const current = loaded.current;
    return () => {
      for (const [id, entry] of current) {
        if (viewer) dispose(viewer, entry);
        // A new viewer starts from scratch: do not report this one's tilesets as shown.
        useLayerView.getState().setRender(id, null);
      }
      current.clear();
    };
  }, [viewer]);
}

type Display = Pick<
  ReturnType<typeof useLayerView.getState>,
  'colorMode' | 'classes' | 'pointSize' | 'quality' | 'realHeight'
>;
/** Metres the layer is lowered: on the bare globe it rests on the ellipsoid unless told not to. */
function placementShift(layer: Layer, realHeight: boolean, onTerrain: boolean) {
  return realHeight ? 0 : globeShift(ellipsoidalRange(layer), onTerrain);
}

function apply(viewer: Viewer, layer: Layer, entry: Loaded, view: Display, onTerrain: boolean) {
  const tileset = entry.tileset!;
  const range = ellipsoidalRange(layer);
  const shift = placementShift(layer, view.realHeight, onTerrain);
  const center = layer.center;
  // Lower the cloud along the local vertical so it rests on the bare ellipsoid (h = 0); the
  // style adds the shift back, so the height ramp still reads real heights.
  if (entry.shift !== shift) {
    entry.shift = shift;
    if (center && shift) {
      const { normal } = heightExpression(center.lat, center.lng);
      tileset.modelMatrix = Matrix4.fromTranslation(
        Cartesian3.multiplyByScalar(new Cartesian3(...normal), -shift, new Cartesian3()),
      );
    } else tileset.modelMatrix = Matrix4.IDENTITY.clone();
  }
  const style = buildPointCloudStyle({
    mode: view.colorMode,
    classes: view.classes,
    center,
    range,
    shift,
  });
  const styleKey = JSON.stringify(style);
  if (entry.styleKey !== styleKey) {
    entry.styleKey = styleKey;
    tileset.style = new Cesium3DTileStyle(style);
  }
  Object.assign(tileset.pointCloudShading, shadingFor(view.pointSize, pointSpacing(layer)));
  tileset.maximumScreenSpaceError = QUALITY_SSE[view.quality];
  syncCredit(viewer, entry, tileset.show);
}

// One counter per viewer: layers with the same attribution share a single on-screen credit.
const viewerCredits = new WeakMap<Viewer, SharedCredits<Credit>>();
function creditsOf(viewer: Viewer) {
  let credits = viewerCredits.get(viewer);
  if (!credits) {
    credits = new SharedCredits<Credit>(
      (c) => viewer.creditDisplay.addStaticCredit(c),
      (c) => viewer.creditDisplay.removeStaticCredit(c),
    );
    viewerCredits.set(viewer, credits);
  }
  return credits;
}
function syncCredit(viewer: Viewer, entry: Loaded, visible: boolean) {
  const text = entry.attribution;
  if (!text || entry.creditShown === visible) return;
  if (visible) creditsOf(viewer).show(text, () => new Credit(escapeHtml(text), true));
  else creditsOf(viewer).hide(text);
  entry.creditShown = visible;
}

function dispose(viewer: Viewer, entry: Loaded) {
  entry.disposed = true;
  if (viewer.isDestroyed()) return;
  syncCredit(viewer, entry, false);
  if (entry.tileset) viewer.scene.primitives.remove(entry.tileset); // remove() destroys it
}

/** On a phone the panel sits below the map: bring the map back into view for the flight. */
function revealMap(element: Element) {
  const box = element.getBoundingClientRect();
  if (box.top >= 0 && box.bottom <= window.innerHeight) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

/** Aim to the right of the layer so it lands in the part of the map that panels leave visible. */
function clearOfOverlays(viewer: Viewer, sphere: BoundingSphere, heading: number, range: number) {
  const canvas = viewer.scene.canvas;
  const shift = aimShift(
    range,
    viewerFov(viewer),
    canvas.clientWidth,
    canvas.clientHeight,
    coveredByOverlays(viewer),
  );
  return shiftedRight(sphere, heading, shift);
}

function footprintSphere(layer: Layer, shift: number) {
  if (!layer.bbox) return undefined;
  const [west, south, east, north] = layer.bbox;
  const range = ellipsoidalRange(layer);
  const height = range ? (range.min + range.max) / 2 - shift : 0;
  return BoundingSphere.fromRectangle3D(
    Rectangle.fromDegrees(west, south, east, north),
    undefined,
    height,
  );
}
