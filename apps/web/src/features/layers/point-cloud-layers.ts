/**
 * Keeps the viewer's 3D Tiles point clouds in step with the layer list and the "Capas" panel.
 * Lives in the lazy Cesium chunk; tiles are only requested for layers that are ready and visible.
 */
import { useEffect, useRef } from 'react';
import {
  BoundingSphere,
  Cartesian3,
  Cartesian4,
  Cesium3DTileset,
  Cesium3DTileStyle,
  Credit,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PointCloudShading,
  Rectangle,
  Transforms,
  type Viewer,
} from 'cesium';
import type { Layer } from '@geotwin/shared';
import { useLayers } from '../../hooks/data';
import { useLayerView } from '../../stores/layers';
import {
  buildPointCloudStyle,
  ellipsoidalRange,
  globeShift,
  heightExpression,
  pointSpacing,
  QUALITY_SSE,
  shadingFor,
} from './point-style';

interface Loaded {
  url: string;
  tileset?: Cesium3DTileset;
  credit?: Credit;
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
            if (layer.attribution) target.credit = new Credit(escapeHtml(layer.attribution), true);
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
      for (const entry of current.values()) if (viewer) dispose(viewer, entry);
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

function syncCredit(viewer: Viewer, entry: Loaded, visible: boolean) {
  if (!entry.credit || entry.creditShown === visible) return;
  if (visible) viewer.creditDisplay.addStaticCredit(entry.credit);
  else viewer.creditDisplay.removeStaticCredit(entry.credit);
  entry.creditShown = visible;
}

function dispose(viewer: Viewer, entry: Loaded) {
  entry.disposed = true;
  if (viewer.isDestroyed()) return;
  syncCredit(viewer, entry, false);
  if (entry.tileset) viewer.scene.primitives.remove(entry.tileset); // remove() destroys it
}

/**
 * A panel floating over the right of the map (marked data-map-overlay) hides part of the view:
 * aim the camera to the right of the layer so it lands in the middle of the visible part.
 */
function clearOfOverlays(viewer: Viewer, sphere: BoundingSphere, heading: number, range: number) {
  const canvas = viewer.scene.canvas.getBoundingClientRect();
  let covered = 0;
  for (const overlay of document.querySelectorAll('[data-map-overlay]')) {
    if (getComputedStyle(overlay).position !== 'absolute') continue;
    const box = overlay.getBoundingClientRect();
    if (box.left > canvas.left + canvas.width / 2 && box.top < canvas.bottom)
      covered = Math.max(covered, canvas.right - box.left);
  }
  if (!covered || !canvas.width) return sphere;
  const frustum = viewer.camera.frustum;
  const fov = frustum instanceof PerspectiveFrustum && frustum.fov ? frustum.fov : Math.PI / 3;
  // Cesium's fov is horizontal on a landscape canvas and vertical on a portrait one.
  const aspect = canvas.width / canvas.height;
  const visibleWidth = 2 * range * Math.tan(fov / 2) * (aspect >= 1 ? 1 : aspect);
  const shift = (covered / 2 / canvas.width) * visibleWidth;
  const enu = Transforms.eastNorthUpToFixedFrame(sphere.center);
  const east = Matrix4.getColumn(enu, 0, new Cartesian4()),
    north = Matrix4.getColumn(enu, 1, new Cartesian4());
  const right = new Cartesian3(
    Math.cos(heading) * east.x - Math.sin(heading) * north.x,
    Math.cos(heading) * east.y - Math.sin(heading) * north.y,
    Math.cos(heading) * east.z - Math.sin(heading) * north.z,
  );
  return new BoundingSphere(
    Cartesian3.add(
      sphere.center,
      Cartesian3.multiplyByScalar(right, shift, new Cartesian3()),
      new Cartesian3(),
    ),
    sphere.radius,
  );
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
