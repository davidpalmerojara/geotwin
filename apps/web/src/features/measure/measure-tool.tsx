/**
 * Measuring in the 3D scene: distance (3D, along the ground and height difference) and polygon
 * area. Points come from scene.pickPosition, which reads the depth buffer, so they land on
 * whatever is drawn there: point clouds, 3D buildings, relief terrain or the bare globe.
 * Loaded on demand from the viewer chunk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  Entity,
  LabelStyle,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { Crosshair, Ruler, Shapes, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { formatArea, formatHeight, formatLength, measure, snapToGround } from './geodesy';
import { renderUntil } from './render-until';

type Mode = 'distance' | 'area';
const accent = Color.fromCssColorString('#22d3ee');

function pick(viewer: Viewer, position: Cartesian2) {
  const scene = viewer.scene;
  if (scene.pickPositionSupported) {
    const hit = scene.pickPosition(position);
    if (hit && Number.isFinite(hit.x) && Cartesian3.magnitude(hit) > 6e6) return hit;
  }
  // Nothing with depth under the cursor (e.g. the globe edge): fall back to the ellipsoid.
  return scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
}

export default function MeasureTool({
  viewer,
  onClose,
  ground,
}: {
  viewer: Viewer;
  onClose: () => void;
  /** Ellipsoidal height of the LiDAR ground model at (lng, lat), when it is the terrain. */
  ground?: (lng: number, lat: number) => number;
}) {
  const [mode, setMode] = useState<Mode>('distance');
  const [picked, setPoints] = useState<Cartesian3[]>([]);
  const [snap, setSnap] = useState(false);
  // With «Al suelo», every point takes the ground model's height under it.
  const points = useMemo(
    () => (snap && ground ? snapToGround(picked, ground) : picked),
    [picked, snap, ground],
  );
  const [miss, setMiss] = useState(false);
  const source = useRef<CustomDataSource | null>(null);
  const stopRendering = useRef<() => void>(undefined);
  const panel = useRef<HTMLElement>(null);
  const result = useMemo(() => measure(points, mode), [points, mode]);

  const add = useCallback(
    (position: Cartesian2) => {
      const hit = pick(viewer, position);
      setMiss(!hit);
      if (hit) setPoints((current) => [...current, hit]);
    },
    [viewer],
  );
  const addCentre = () => {
    const canvas = viewer.scene.canvas;
    add(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  };
  const undo = useCallback(() => setPoints((current) => current.slice(0, -1)), []);

  // Clicks on the map add points while the tool is open.
  useEffect(() => {
    const ds = new CustomDataSource('medicion');
    source.current = ds;
    void viewer.dataSources.add(ds);
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (event: { position: Cartesian2 }) => add(event.position),
      ScreenSpaceEventType.LEFT_CLICK,
    );
    viewer.scene.canvas.style.cursor = 'crosshair';
    return () => {
      stopRendering.current?.();
      handler.destroy();
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(ds, true);
        viewer.scene.canvas.style.cursor = '';
        viewer.scene.requestRender();
      }
      source.current = null;
    };
  }, [viewer, add]);

  // Dock the panel just above the viewer credits, which wrap to several lines on a phone: the
  // CC-BY attributions (PNOA, PNOA-LiDAR) must stay readable while measuring. The notes over the
  // map (an error, the relief note) dock at the same place: the panel's height goes to CSS as
  // --measure-clear so they stack above it instead of under it.
  useEffect(() => {
    const credits = viewer.bottomContainer as HTMLElement;
    const shell = panel.current?.offsetParent as HTMLElement | null | undefined;
    const dock = () => {
      const element = panel.current;
      if (!element || !shell) return;
      const gap = shell.getBoundingClientRect().bottom - credits.getBoundingClientRect().top;
      element.style.bottom = `${Math.max(0, Math.ceil(gap)) + 8}px`;
      shell.style.setProperty('--measure-clear', `${Math.ceil(element.offsetHeight) + 8}px`);
    };
    dock();
    const observer = new ResizeObserver(dock);
    observer.observe(credits);
    if (shell) observer.observe(shell);
    if (panel.current) observer.observe(panel.current);
    return () => {
      observer.disconnect();
      shell?.style.removeProperty('--measure-clear');
    };
  }, [viewer]);

  // Keyboard: Esc closes, Backspace / Delete / Ctrl+Z undo (not while typing in a text field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')
      )
        return;
      if (event.key === 'Escape') onClose();
      else if (
        event.key === 'Backspace' ||
        event.key === 'Delete' ||
        (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey))
      ) {
        event.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, undo]);

  // Draw the points, the line or polygon, and the running total.
  useEffect(() => {
    const ds = source.current;
    if (!ds || viewer.isDestroyed()) return;
    ds.entities.removeAll();
    points.forEach((position, i) =>
      ds.entities.add({
        id: `medida:${i}`,
        position,
        point: {
          pixelSize: 9,
          color: Color.WHITE,
          outlineColor: accent,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    const shapes: Entity[] = [];
    if (points.length > 1) {
      const line = mode === 'area' && points.length > 2 ? [...points, points[0]!] : points;
      shapes.push(
        ds.entities.add({
          polyline: {
            positions: line,
            width: 2.5,
            arcType: ArcType.NONE,
            material: accent,
            depthFailMaterial: new ColorMaterialProperty(accent.withAlpha(0.45)),
          },
        }),
      );
    }
    if (mode === 'area' && points.length > 2)
      shapes.push(
        ds.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(points),
            perPositionHeight: true,
            material: accent.withAlpha(0.18),
          },
        }),
      );
    const last = points.at(-1);
    const text =
      mode === 'area'
        ? points.length > 2
          ? formatArea(result.area)
          : ''
        : points.length > 1
          ? formatLength(result.distance3d)
          : '';
    if (last && text)
      ds.entities.add({
        position: last,
        label: {
          text,
          font: '600 13px Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#06121f'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0b1829').withAlpha(0.85),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    viewer.scene.requestRender();
    // Lines and polygons are built asynchronously and, in request-render mode, Cesium does not
    // ask for a frame when they are done: keep drawing until they are, so they never go missing.
    stopRendering.current?.();
    stopRendering.current = shapes.length
      ? renderUntil(
          () => !viewer.isDestroyed() && viewer.scene.requestRender(),
          () => viewer.isDestroyed() || viewer.dataSourceDisplay.ready,
        )
      : undefined;
  }, [points, mode, result, viewer]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPoints([]);
  };
  const needed = mode === 'distance' ? 2 : 3;
  return (
    <>
      <div className="measure-crosshair" aria-hidden="true" />
      <section className="measure-panel" aria-label="Medir" ref={panel}>
        <div className="measure-head">
          <div className="segmented" role="group" aria-label="Tipo de medida">
            <button
              type="button"
              aria-pressed={mode === 'distance'}
              onClick={() => switchMode('distance')}
            >
              <Ruler size={13} /> Distancia
            </button>
            <button type="button" aria-pressed={mode === 'area'} onClick={() => switchMode('area')}>
              <Shapes size={13} /> Área
            </button>
          </div>
          <Button size="icon" variant="ghost" aria-label="Cerrar medición" onClick={onClose}>
            <X size={15} />
          </Button>
        </div>
        <dl
          className={`measure-results ${mode === 'area' ? 'two' : ''}`}
          aria-live="polite"
          data-testid="measure-results"
        >
          {mode === 'distance' ? (
            <>
              <div>
                <dt>3D</dt>
                <dd>{points.length > 1 ? formatLength(result.distance3d) : '—'}</dd>
              </div>
              <div>
                <dt title="Geodésica sobre el elipsoide WGS84, sin contar el desnivel">
                  Horizontal
                </dt>
                <dd>{points.length > 1 ? formatLength(result.ground) : '—'}</dd>
              </div>
              <div>
                <dt>Desnivel</dt>
                <dd>{points.length > 1 ? formatHeight(result.height) : '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Área horizontal</dt>
                <dd>{points.length > 2 ? formatArea(result.area) : '—'}</dd>
              </div>
              <div>
                <dt>Perímetro</dt>
                <dd>{points.length > 2 ? formatLength(result.perimeter) : '—'}</dd>
              </div>
            </>
          )}
        </dl>
        <p className={`measure-hint ${miss ? 'warn' : ''}`}>
          {miss
            ? 'Ahí no hay nada que medir: apunta a la nube o al mapa.'
            : points.length < needed
              ? `Clic en el mapa o «Centro» (${points.length}/${needed} puntos)`
              : `${points.length} puntos · Retroceso deshace, Esc cierra`}
        </p>
        {ground && (
          <label
            className="measure-snap"
            title="Lleva cada punto a la altura del modelo del terreno (suelo LiDAR, malla de 2 m) en ese sitio: un clic sobre un coche, una valla o un árbol mide el suelo de debajo."
          >
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Al suelo (MDT)
          </label>
        )}
        <div className="measure-actions">
          <Button
            size="sm"
            variant="outline"
            aria-label="Añadir punto en el centro"
            title="Añade el punto bajo la cruz central (con las flechas mueves el mapa)"
            onClick={addCentre}
          >
            <Crosshair size={13} /> Centro
          </Button>
          <Button size="sm" variant="ghost" disabled={!points.length} onClick={undo}>
            <Undo2 size={13} /> Deshacer
          </Button>
          <Button size="sm" variant="ghost" disabled={!points.length} onClick={() => setPoints([])}>
            <Trash2 size={13} /> Borrar
          </Button>
        </div>
      </section>
    </>
  );
}
