import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Eye, EyeOff, LocateFixed, LoaderCircle, Trash2, X } from 'lucide-react';
import type { Layer, LayerStage } from '@geotwin/shared';
import { useLayerLimits, useLayers } from '../../hooks/data';
import { LAYERS_KEY } from '../../hooks/realtime-cache';
import { api, ApiError, uploadLayer, type UploadOptions } from '../../lib/api';
import { count, number } from '../../lib/format';
import { useLayerView } from '../../stores/layers';
import { useScene } from '../../stores/viewer';
import { Glyph } from '../hud/glyphs';
import { effectiveBase, PNOA_UNAVAILABLE, type BaseImagery } from './base-imagery';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import {
  CLASS_GROUPS,
  HYBRID_HIDDEN,
  type ColorMode,
  type PointMode,
  type Quality,
} from './point-style';
import { HeightRangeNote, HeightRuler, useHeightLegend } from './height-ruler';
import { usePhone } from '../../hooks/media';
import { mebibytes, quietMinutes, validateFile } from './upload';

const stageLabel: Record<LayerStage, string> = {
  queued: 'en cola',
  downloading: 'descargando',
  inspecting: 'analizando el fichero',
  tiling: 'generando teselas',
  uploading: 'publicando teselas',
  done: 'terminado',
};
const methodLabel = {
  egm08_rednap_grid: 'rejilla oficial EGM08-REDNAP',
  egm96_centre: 'EGM96 en el centro de la hoja',
  override: 'valor fijado a mano',
  none: 'alturas ya elipsoidales',
} as const;
const modes: [ColorMode, string][] = [
  ['rgb', 'RGB'],
  ['height', 'Altura'],
  ['classification', 'Clasificación'],
];
const pointModes: [PointMode, string][] = [
  ['all', 'Todos'],
  ['hybrid', 'Híbrido (sin suelo)'],
];
const bases: [BaseImagery, string][] = [
  ['pnoa', 'Ortofoto PNOA'],
  ['neutral', 'Neutro'],
  ['natural-earth', 'Natural Earth'],
];
const qualities: [Quality, string][] = [
  ['low', 'Baja'],
  ['medium', 'Media'],
  ['high', 'Alta'],
];

/** Title line of the Capas panel: how many sheets and points are loaded. */
export function LayersSummary() {
  const ready = (useLayers().data ?? []).filter((l) => l.status === 'ready');
  const points = ready.reduce((sum, l) => sum + (l.point_count ?? 0), 0);
  if (!ready.length) return null;
  return (
    <span className="panel-sub num">
      {count(ready.length, 'hoja', 'hojas')} · {number(points / 1e6, 1)} M puntos
    </span>
  );
}

/**
 * The Capas panel: upload LAS/LAZ and follow its processing live, show, style and filter the
 * point clouds, the LiDAR relief, the base under the clouds (orthophoto, neutral, Natural Earth),
 * Cesium ion's 3D buildings and Google's photorealistic mesh, and the legend of the scene.
 */
export function LayersPanel() {
  const layers = useLayers();
  const limits = useLayerLimits().data;
  const client = useQueryClient();
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  // A rejected upload or delete: shown under the drop zone and scrolled into view each time.
  const [message, setMessageState] = useState({ text: '', seq: 0 });
  const setMessage = (text: string) => setMessageState((m) => ({ text, seq: m.seq + 1 }));
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<UploadOptions>({});
  const [confirm, setConfirm] = useState<Layer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const abort = useRef<AbortController | null>(null);
  // Layers uploaded from this tab: the camera flies to each one when it becomes ready.
  const followed = useRef(new Set<string>());
  const view = useLayerView();
  const list = useMemo(() => layers.data ?? [], [layers.data]);
  const ready = list.filter((l) => l.status === 'ready');

  useEffect(() => {
    for (const layer of list)
      if (layer.status === 'ready' && followed.current.delete(layer.id))
        view.requestFlyTo(layer.id);
      else if (layer.status === 'failed') followed.current.delete(layer.id);
  }, [list, view]);
  useEffect(() => () => abort.current?.abort(), []);
  // The panel may be scrolled down to the style controls: never leave the message out of view.
  useEffect(() => {
    if (message.text) messageRef.current?.scrollIntoView({ block: 'nearest' });
  }, [message]);

  const start = async (file: File | undefined) => {
    if (!file || upload) return;
    setMessage('');
    const invalid = validateFile(file, limits?.max_upload_bytes);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ name: file.name, progress: 0 });
    try {
      const layer = await uploadLayer(
        file,
        {
          name: options.name?.trim() || undefined,
          attribution: options.attribution?.trim() || undefined,
        },
        (progress) => setUpload({ name: file.name, progress }),
        controller.signal,
      );
      followed.current.add(layer.id);
      // The layer:created event may already have added it; never list it twice.
      client.setQueryData<Layer[]>([...LAYERS_KEY], (current) =>
        current?.some((l) => l.id === layer.id) ? current : [layer, ...(current ?? [])],
      );
      setOptions({});
      if (details.current) details.current.open = false;
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'No se pudo subir el fichero.');
    } finally {
      abort.current = null;
      setUpload(null);
      if (input.current) input.current.value = '';
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void start(event.dataTransfer.files[0]);
  };
  const remove = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api.deleteLayer(confirm.id);
      client.setQueryData<Layer[]>([...LAYERS_KEY], (current) =>
        current?.filter((l) => l.id !== confirm.id),
      );
      setConfirm(null);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'No se pudo borrar la capa.');
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };
  const withGround = ready.filter((l) => l.terrain_url).length;
  const legend = useHeightLegend();
  const phone = usePhone();
  const hybrid = view.pointMode === 'hybrid';
  const base = effectiveBase(view.baseImagery, view.pnoa.state);
  const groundIsPhoto = base === 'pnoa';
  const scene = useScene();
  const photorealOn = scene.photoreal === 'on';
  // With «Fotorrealista (Google)» on, the ground under the points is Google's mesh.
  const groundIsGoogle = photorealOn;
  const token = !!import.meta.env.VITE_CESIUM_ION_TOKEN;
  // Every PNOA source failed while the orthophoto is the chosen base: the other choices say that
  // picking them also removes the warning.
  const pnoaFailed = view.baseImagery === 'pnoa' && view.pnoa.state === 'error';
  const limitText = limits ? `hasta ${mebibytes(limits.max_upload_bytes, 0)}` : '';

  return (
    <div className="layers-panel">
      <div className="layers-body">
        <div
          className={`layer-drop ${dragging ? 'dragging' : ''} ${list.length ? 'compact' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          {upload ? (
            <div className="layer-upload" role="status">
              <span>
                Subiendo <b>{upload.name}</b> · {Math.round(upload.progress * 100)} %
              </span>
              <progress max={1} value={upload.progress} aria-label="Progreso de la subida" />
              <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
                <X size={13} /> Cancelar
              </Button>
            </div>
          ) : (
            <>
              <p>
                Arrastra un fichero <b>.las</b> o <b>.laz</b>
                {limitText && ` (${limitText})`}
              </p>
              <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
                Elegir
              </Button>
              <input
                ref={input}
                type="file"
                accept=".las,.laz"
                className="sr-only"
                aria-label="Fichero LAS o LAZ"
                data-testid="layer-file"
                onChange={(e) => void start(e.target.files?.[0])}
              />
              <small>
                El tipo se comprueba por el contenido. Se convierte a 3D Tiles en segundo plano; las
                hojas <code>PNOA_…</code> reciben su atribución CC-BY.
              </small>
            </>
          )}
        </div>
        <details className="layer-options" ref={details}>
          <summary>Nombre y atribución (opcional)</summary>
          <label>
            Nombre
            <input
              value={options.name ?? ''}
              maxLength={100}
              placeholder="El del fichero"
              onChange={(e) => setOptions({ ...options, name: e.target.value })}
            />
          </label>
          <label>
            Atribución
            <input
              value={options.attribution ?? ''}
              maxLength={500}
              placeholder="Se muestra en los créditos del visor"
              onChange={(e) => setOptions({ ...options, attribution: e.target.value })}
            />
          </label>
        </details>
        {message.text && (
          <p className="layer-message" role="alert" ref={messageRef}>
            <Glyph status="warning" /> {message.text}
          </p>
        )}
        {layers.isError ? (
          <p className="layer-message" role="alert">
            <Glyph status="warning" /> No se pudieron cargar las capas.
          </p>
        ) : list.length ? (
          <ul className="layer-list">
            {list.map((layer) => (
              <LayerRow key={layer.id} layer={layer} onDelete={() => setConfirm(layer)} />
            ))}
          </ul>
        ) : (
          !layers.isPending && <p className="layer-empty">Aún no hay capas.</p>
        )}
        {ready.length > 0 && (
          <div className="layer-style">
            <div className="field-row">
              <span aria-hidden="true">Color</span>
              <div className="segmented" role="group" aria-label="Color de los puntos">
                {modes.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view.colorMode === mode}
                    onClick={() => view.setColorMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {legend && (
              <div className="height-legend">
                {phone && <HeightRuler range={legend.range} sheets={legend.sheets} height={200} />}
                <HeightRangeNote range={legend.range} sheets={legend.sheets} aside={!phone} />
              </div>
            )}
            <div className="point-mode">
              <span id="point-mode-label">Puntos</span>
              <div className="segmented" role="group" aria-labelledby="point-mode-label">
                {pointModes.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view.pointMode === mode}
                    onClick={() => view.setPointMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {hybrid && (
                <small className="layer-hint" data-testid="hybrid-hint">
                  {groundIsGoogle
                    ? 'Con «Fotorrealista (Google)» el suelo es la malla 3D de Google (no la ortofoto PNOA); edificios y vegetación siguen siendo puntos.'
                    : groundIsPhoto
                      ? 'El suelo es la ortofoto PNOA sobre el relieve del LiDAR; edificios y vegetación siguen siendo puntos.'
                      : base === 'natural-earth'
                        ? 'Sin la ortofoto PNOA, bajo los puntos se ve el atlas Natural Earth, con mucho menos detalle.'
                        : 'Sin la ortofoto PNOA, bajo los puntos queda el suelo oscuro del fondo neutro.'}
                </small>
              )}
            </div>
            <fieldset className="class-filter">
              <legend>Clases ASPRS visibles</legend>
              {CLASS_GROUPS.map((group) => (
                <label
                  key={group.key}
                  title={
                    hybrid && HYBRID_HIDDEN.includes(group.key)
                      ? groundIsGoogle
                        ? 'En modo híbrido el suelo es la malla de Google'
                        : 'En modo híbrido el suelo es la ortofoto'
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      view.classes[group.key] && !(hybrid && HYBRID_HIDDEN.includes(group.key))
                    }
                    disabled={hybrid && HYBRID_HIDDEN.includes(group.key)}
                    onChange={() => view.toggleClass(group.key)}
                  />
                  {view.colorMode === 'classification' && (
                    <i style={{ background: group.color }} aria-hidden="true" />
                  )}
                  {group.label}
                  {group.codes.length > 0 && (
                    <span className="f2 num class-codes" aria-hidden="true">
                      {group.codes.length > 1
                        ? `${group.codes[0]}–${group.codes.at(-1)}`
                        : group.codes[0]}
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
            <div className="field-row">
              <span id="quality-label">Calidad</span>
              <div className="segmented" role="group" aria-labelledby="quality-label">
                {qualities.map(([q, label]) => (
                  <button
                    key={q}
                    type="button"
                    aria-pressed={view.quality === q}
                    onClick={() => view.setQuality(q)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-row size-row">
              <span>Tamaño</span>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                aria-label="Tamaño de punto"
                value={view.pointSize}
                onChange={(e) => view.setPointSize(Number(e.target.value))}
              />
              <b className="num">{view.pointSize} px</b>
            </label>
            <label className="layer-check">
              <input
                type="checkbox"
                aria-label="Realzar bordes (EDL)"
                aria-describedby="edl-help"
                checked={view.edl}
                onChange={(e) => view.setEdl(e.target.checked)}
              />
              <span>
                Realzar bordes (EDL)
                <small id="edl-help">
                  Oscurece los saltos de profundidad: ayuda a leer volúmenes, pero dibuja contornos.
                </small>
              </span>
            </label>
          </div>
        )}
        <div className="layer-terrain">
          <h3>Terreno y fondo</h3>
          {withGround > 0 && (
            <label className="layer-check">
              <input
                type="checkbox"
                aria-label="Relieve del LiDAR"
                aria-describedby="lidar-terrain-help"
                checked={view.lidarTerrain}
                onChange={(e) => view.setLidarTerrain(e.target.checked)}
              />
              <span>
                Relieve del LiDAR <span className="f2">MDT 2 m</span>
                <small id="lidar-terrain-help">
                  El suelo de {count(withGround, 'capa', 'capas')} hace de terreno: mapa, activos y
                  nubes a su altura real, y la lectura da cotas. Fuera de las hojas es un plano
                  orientativo.
                </small>
              </span>
            </label>
          )}
          {ready.length > 0 && !(withGround > 0 && view.lidarTerrain) && (
            <label className="layer-check">
              <input
                type="checkbox"
                aria-label="Altura real sobre el globo básico"
                aria-describedby="real-height-help"
                checked={view.realHeight}
                onChange={(e) => view.setRealHeight(e.target.checked)}
              />
              <span>
                Altura real sobre el globo básico
                <small id="real-height-help">
                  Sin relieve, el globo es el elipsoide (h = 0) y la nube se baja hasta él para
                  verla sobre el mapa. Distancias y desniveles no cambian.
                </small>
              </span>
            </label>
          )}
          <div className="field-row">
            <span id="base-label">Fondo</span>
            <div
              className="segmented"
              role="group"
              aria-labelledby="base-label"
              title={
                photorealOn
                  ? 'Oculto con Fotorrealista: la malla de Google tapa el fondo'
                  : undefined
              }
            >
              {bases.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view.baseImagery === value}
                  title={
                    pnoaFailed && !photorealOn && value !== 'pnoa'
                      ? value === 'natural-earth'
                        ? 'Ocultar el aviso y quedarse con el atlas'
                        : 'Ocultar el aviso y quedarse con el fondo neutro'
                      : undefined
                  }
                  disabled={photorealOn}
                  onClick={() => view.setBaseImagery(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {photorealOn ? (
            <p className="layer-hint">
              Oculto con Fotorrealista: la malla de Google tapa el fondo.
            </p>
          ) : (
            view.baseImagery === 'pnoa' &&
            view.pnoa.state === 'error' && (
              <p className="layer-hint warn" data-testid="base-failure">
                <Glyph status="warning" /> {PNOA_UNAVAILABLE}
              </p>
            )
          )}
          <div className="layer-ion">
            <button
              type="button"
              className="switch-row"
              aria-pressed={scene.buildings === 'on'}
              disabled={!token || scene.buildings === 'loading' || !scene.api}
              aria-describedby="buildings-help"
              onClick={() => scene.api?.toggleBuildings()}
            >
              <i className="switch" aria-hidden="true" />
              Edificios 3D
            </button>
            <small id="buildings-help">
              {token
                ? scene.buildings === 'loading'
                  ? 'Cargando edificios OSM y terreno de Cesium ion…'
                  : 'Edificios OSM y terreno 3D de Cesium ion.'
                : 'Necesita un token de Cesium ion (VITE_CESIUM_ION_TOKEN).'}
            </small>
            <button
              type="button"
              className="switch-row"
              aria-label="Fotorrealista (Google)"
              aria-pressed={photorealOn}
              disabled={!token || scene.photoreal === 'loading' || !scene.api}
              aria-describedby="photoreal-help"
              onClick={() => scene.api?.togglePhotoreal()}
            >
              <i className="switch" aria-hidden="true" />
              Fotorrealista (Google)
            </button>
            <small id="photoreal-help">
              {token
                ? scene.photoreal === 'loading'
                  ? 'Cargando la malla de Google a través de Cesium ion…'
                  : 'Malla 3D de Google Photorealistic 3D Tiles a través de Cesium ion.'
                : 'Necesita un token de Cesium ion (VITE_CESIUM_ION_TOKEN).'}
            </small>
          </div>
        </div>
        <div className="layer-legend" aria-label="Leyenda">
          <h3>Leyenda</h3>
          <ul>
            <li>
              <Glyph status="healthy" /> operativo
            </li>
            <li>
              <Glyph status="warning" /> advertencia
            </li>
            <li>
              <Glyph status="critical" /> crítico
            </li>
            <li>
              <span className="sim">simulado</span> dato simulado
            </li>
            <li>
              <span className="legend-tag num">41,2 °C</span> borde discontinuo: lectura simulada en
              la escena
            </li>
            <li>
              <span className="legend-beam" aria-hidden="true" /> haz: alerta activa; con anillos,
              aún sin reconocer
            </li>
          </ul>
          <p className="layer-hint">
            Instalaciones ficticias en coordenadas reales. WGS 84 · SRID 4326.
          </p>
        </div>
      </div>
      <Dialog open={!!confirm} onOpenChange={(value) => !value && setConfirm(null)}>
        <DialogContent>
          <DialogTitle className="dialog-title">¿Borrar la capa?</DialogTitle>
          <DialogDescription className="dialog-description">
            Se borrarán «{confirm?.name}», sus teselas y el fichero original. No se puede deshacer.
          </DialogDescription>
          <div className="dialog-actions">
            <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void remove()}
            >
              Borrar capa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** «PNOA_2025_CYL_356-4606_H30_NPC01» → «356-4606»: the sheet, as surveyors name it. */
export const shortName = (name: string) =>
  /PNOA_\d{4}_[A-Z]+_(\d{3}-\d{4})/.exec(name)?.[1] ?? name;

function LayerRow({ layer, onDelete }: { layer: Layer; onDelete: () => void }) {
  const hidden = useLayerView((s) => !!s.hidden[layer.id]),
    render = useLayerView((s) => s.render[layer.id]),
    toggle = useLayerView((s) => s.toggle),
    flyTo = useLayerView((s) => s.requestFlyTo);
  const isReady = layer.status === 'ready';
  const [open, setOpen] = useState(false);
  // When did this tab last see the layer move? A coarse clock (10 s) is enough for minutes.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const step = `${layer.status}:${layer.stage}:${layer.progress}`;
  const [seen, setSeen] = useState({ step, at: clock });
  if (seen.step !== step) setSeen({ step, at: clock });
  const quiet = layer.status === 'processing' ? quietMinutes(seen.at, clock) : null;
  return (
    <li className="layer-row" data-testid={`layer-${layer.id}`} data-status={layer.status}>
      <div className="layer-row-head">
        {isReady ? (
          <button
            type="button"
            className="vis"
            aria-pressed={!hidden}
            aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} ${layer.name}`}
            title={hidden ? 'Oculta: pulsa para mostrarla' : 'Visible: pulsa para ocultarla'}
            onClick={() => toggle(layer.id)}
          >
            {hidden ? (
              <EyeOff size={13} aria-hidden="true" />
            ) : (
              <Eye size={13} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="vis" aria-hidden="true" />
        )}
        <strong title={`${layer.name} · ${layer.source.filename}`}>{shortName(layer.name)}</strong>
        <span className={`layer-status layer-status-${layer.status}`}>
          {layer.status === 'queued' && 'En cola'}
          {layer.status === 'processing' && (
            <>
              <LoaderCircle size={11} className="spin" aria-hidden="true" /> Procesando{' '}
              {layer.progress} %
            </>
          )}
          {isReady &&
            (render === 'loading' && !hidden
              ? 'Cargando…'
              : layer.point_count !== null
                ? `${number(layer.point_count / 1e6, 2)} M`
                : 'Lista')}
          {layer.status === 'failed' && 'Error'}
        </span>
        {isReady && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Ir a ${layer.name}`}
            title="Ir a la hoja"
            onClick={() => flyTo(layer.id)}
          >
            <LocateFixed size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={`Borrar ${layer.name}`}
          title="Borrar la capa"
          onClick={onDelete}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-label={`Detalles de ${layer.name}`}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={14} className={open ? 'flip' : undefined} aria-hidden="true" />
        </button>
      </div>
      {layer.status === 'processing' && (
        // Under the name, in the row's text column (past the eye's place), like the details.
        <div className="layer-progress">
          <progress
            max={100}
            value={layer.progress}
            aria-label={`Progreso de ${layer.name}: ${stageLabel[layer.stage]}`}
          />
          <small className="layer-meta">{stageLabel[layer.stage]}</small>
          {quiet !== null && (
            <small className="layer-quiet" role="status">
              Sin noticias del worker desde hace {quiet} min. Si se ha detenido, la tarea se
              reintentará cuando vuelva a estar en marcha.
            </small>
          )}
        </div>
      )}
      {layer.status === 'failed' && <p className="layer-error">{layer.error}</p>}
      {isReady && render === 'error' && (
        <p className="layer-error">No se pudieron cargar algunas teselas.</p>
      )}
      <div className="layer-details" hidden={!open}>
        {isReady && (
          <small className="layer-meta">
            {layer.point_count !== null && `${number(layer.point_count)} puntos · `}
            {!!layer.excluded?.points &&
              `${number(layer.excluded.points)} de solape o ruido fuera (clases ${layer.excluded.classes.join(', ')}) · `}
            {mebibytes(layer.source.size_bytes)} {layer.source.format.toUpperCase()} ·{' '}
            {layer.crs_in}
            {layer.vertical.method &&
              ` · N ${number(layer.vertical.geoid_offset_m ?? 0, 2)} m (${methodLabel[layer.vertical.method]})`}
          </small>
        )}
        {layer.attribution && <small className="layer-attribution">{layer.attribution}</small>}
      </div>
    </li>
  );
}
