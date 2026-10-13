import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  LocateFixed,
  LoaderCircle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Layer, LayerStage } from '@geotwin/shared';
import { useLayerLimits, useLayers } from '../../hooks/data';
import { LAYERS_KEY } from '../../hooks/realtime-cache';
import { api, ApiError, uploadLayer, type UploadOptions } from '../../lib/api';
import { count, number } from '../../lib/format';
import { useLayerView } from '../../stores/layers';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import {
  CLASS_GROUPS,
  ellipsoidalRange,
  HEIGHT_RAMP,
  type ColorMode,
  type Quality,
} from './point-style';
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
const qualities: [Quality, string][] = [
  ['low', 'Baja'],
  ['medium', 'Media'],
  ['high', 'Alta'],
];

/** "Capas" panel of the twin: upload LAS/LAZ, follow processing live, show and style layers. */
export function LayersPanel() {
  const layers = useLayers();
  const limits = useLayerLimits().data;
  const client = useQueryClient();
  const [open, setOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 951px)').matches,
  );
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
      setOpen(true);
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
  const single = ready.filter((l) => !view.hidden[l.id]);
  const withGround = ready.filter((l) => l.terrain_url).length;
  const range = single.length === 1 ? ellipsoidalRange(single[0]!) : undefined;
  const limitText = limits ? `hasta ${mebibytes(limits.max_upload_bytes, 0)}` : '';

  return (
    <section
      className={`layers-panel ${open ? 'open' : ''}`}
      aria-label="Capas LiDAR"
      data-map-overlay
    >
      <button
        type="button"
        className="layers-head"
        aria-expanded={open}
        aria-controls="layers-body"
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>Capas</strong>
          <small>
            {list.length ? count(list.length, 'nube de puntos', 'nubes de puntos') : 'LiDAR'}
          </small>
        </span>
        <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
      </button>
      <div id="layers-body" className="layers-body" hidden={!open}>
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
              <Upload size={18} className="text-cyan-400" />
              <p>
                Arrastra aquí un fichero <b>.las</b> o <b>.laz</b>
                {limitText && ` (${limitText})`}
              </p>
              <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
                Elegir fichero
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
            <AlertTriangle size={14} /> {message.text}
          </p>
        )}
        {layers.isError ? (
          <p className="layer-message" role="alert">
            <AlertTriangle size={14} /> No se pudieron cargar las capas.
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
            {view.colorMode === 'height' && (
              <div className="height-legend">
                <i style={{ background: `linear-gradient(90deg, ${HEIGHT_RAMP.join(', ')})` }} />
                <span>
                  {range ? `${number(range.min, 1)} m` : 'baja'}
                  <small>altura elipsoidal{range ? '' : ', por capa'}</small>
                  {range ? `${number(range.max, 1)} m` : 'alta'}
                </span>
              </div>
            )}
            <fieldset className="class-filter">
              <legend>Clases ASPRS visibles</legend>
              {CLASS_GROUPS.map((group) => (
                <label key={group.key}>
                  <input
                    type="checkbox"
                    checked={view.classes[group.key]}
                    onChange={() => view.toggleClass(group.key)}
                  />
                  {view.colorMode === 'classification' && (
                    <i style={{ background: group.color }} aria-hidden="true" />
                  )}
                  {group.label}
                </label>
              ))}
            </fieldset>
            <div className="layer-sliders">
              <label>
                <span>
                  Tamaño de punto <b>{view.pointSize} px</b>
                </span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={view.pointSize}
                  onChange={(e) => view.setPointSize(Number(e.target.value))}
                />
              </label>
              <label>
                Calidad
                <select
                  value={view.quality}
                  onChange={(e) => view.setQuality(e.target.value as Quality)}
                >
                  {qualities.map(([q, label]) => (
                    <option key={q} value={q}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
                  Oscurece los saltos de profundidad: ayuda a leer volúmenes, pero dibuja contornos
                  y la nube parece menos natural.
                </small>
              </span>
            </label>
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
                  Relieve del LiDAR
                  <small id="lidar-terrain-help">
                    El suelo de {count(withGround, 'capa', 'capas')} (clase 2, malla de 2 m) hace de
                    terreno: mapa, activos y nubes quedan a su altura real. Fuera de la cobertura es
                    un plano orientativo. Con el relieve de Cesium ion se usa ese.
                  </small>
                </span>
              </label>
            )}
            {!(withGround > 0 && view.lidarTerrain) && (
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
          </div>
        )}
      </div>
      <Dialog open={!!confirm} onOpenChange={(value) => !value && setConfirm(null)}>
        <DialogContent>
          <DialogTitle className="text-base font-semibold">¿Borrar la capa?</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-slate-400">
            Se borrarán «{confirm?.name}», sus teselas y el fichero original. No se puede deshacer.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
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
    </section>
  );
}

function LayerRow({ layer, onDelete }: { layer: Layer; onDelete: () => void }) {
  const hidden = useLayerView((s) => !!s.hidden[layer.id]),
    render = useLayerView((s) => s.render[layer.id]),
    toggle = useLayerView((s) => s.toggle),
    flyTo = useLayerView((s) => s.requestFlyTo);
  const isReady = layer.status === 'ready';
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
        <strong title={layer.source.filename}>{layer.name}</strong>
        <span className={`layer-status layer-status-${layer.status}`}>
          {layer.status === 'queued' && 'En cola'}
          {layer.status === 'processing' && (
            <>
              <LoaderCircle size={11} className="animate-spin" /> Procesando {layer.progress} %
            </>
          )}
          {isReady && 'Lista'}
          {layer.status === 'failed' && 'Error'}
        </span>
      </div>
      {layer.status === 'processing' && (
        <>
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
        </>
      )}
      {layer.status === 'failed' && <p className="layer-error">{layer.error}</p>}
      {isReady && (
        <small className="layer-meta">
          {layer.point_count !== null && `${number(layer.point_count)} puntos · `}
          {!!layer.excluded?.points &&
            `${number(layer.excluded.points)} de solape o ruido fuera (clases ${layer.excluded.classes.join(', ')}) · `}
          {mebibytes(layer.source.size_bytes)} {layer.source.format.toUpperCase()} · {layer.crs_in}
          {layer.vertical.method &&
            ` · N ${number(layer.vertical.geoid_offset_m ?? 0, 2)} m (${methodLabel[layer.vertical.method]})`}
        </small>
      )}
      {isReady && render === 'error' && (
        <p className="layer-error">No se pudieron cargar algunas teselas.</p>
      )}
      {layer.attribution && <small className="layer-attribution">{layer.attribution}</small>}
      <div className="layer-actions">
        {isReady && (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={!hidden}
              aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} ${layer.name}`}
              onClick={() => toggle(layer.id)}
            >
              {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              {hidden ? 'Oculta' : render === 'loading' ? 'Cargando…' : 'Visible'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Ir a ${layer.name}`}
              onClick={() => flyTo(layer.id)}
            >
              <LocateFixed size={14} /> Ir
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-label={`Borrar ${layer.name}`}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </li>
  );
}
