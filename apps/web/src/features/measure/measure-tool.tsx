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
  LabelStyle,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { Crosshair, Ruler, Shapes, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { formatArea, formatHeight, formatLength, measure } from './geodesy';

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

export default function MeasureTool({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('distance');
  const [points, setPoints] = useState<Cartesian3[]>([]);
  const [miss, setMiss] = useState(false);
  const source = useRef<CustomDataSource | null>(null);
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
      handler.destroy();
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(ds, true);
        viewer.scene.canvas.style.cursor = '';
        viewer.scene.requestRender();
      }
      source.current = null;
    };
  }, [viewer, add]);

  // Keyboard: Esc closes, Backspace / Delete / Ctrl+Z undo (not while typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
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
    if (points.length > 1) {
      const line = mode === 'area' && points.length > 2 ? [...points, points[0]!] : points;
      ds.entities.add({
        polyline: {
          positions: line,
          width: 2.5,
          arcType: ArcType.NONE,
          material: accent,
          depthFailMaterial: new ColorMaterialProperty(accent.withAlpha(0.45)),
        },
      });
    }
    if (mode === 'area' && points.length > 2)
      ds.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(points),
          perPositionHeight: true,
          material: accent.withAlpha(0.18),
        },
      });
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
  }, [points, mode, result, viewer]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPoints([]);
  };
  const needed = mode === 'distance' ? 2 : 3;
  return (
    <>
      <div className="measure-crosshair" aria-hidden="true" />
      <section className="measure-panel" aria-label="Medir">
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
        <dl className="measure-results" aria-live="polite" data-testid="measure-results">
          {mode === 'distance' ? (
            <>
              <div>
                <dt>3D</dt>
                <dd>{points.length > 1 ? formatLength(result.distance3d) : '—'}</dd>
              </div>
              <div>
                <dt>Sobre el terreno</dt>
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
            ? 'Ahí no hay nada que medir: apunta a la nube, al terreno o al mapa.'
            : points.length < needed
              ? `Haz clic en el mapa o usa «Punto en el centro» (${points.length}/${needed} puntos).`
              : `${points.length} puntos. Sigue añadiendo o deshaz con Retroceso.`}
        </p>
        <div className="measure-actions">
          <Button size="sm" variant="outline" onClick={addCentre}>
            <Crosshair size={13} /> Punto en el centro
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
