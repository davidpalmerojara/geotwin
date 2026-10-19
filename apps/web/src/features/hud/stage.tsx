import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset, Installation } from '@geotwin/shared';
import { useAssets, useInstallations } from '../../hooks/data';
import { useRealtime } from '../../hooks/realtime';
import { useRouteSync } from '../../hooks/route';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useScene } from '../../stores/viewer';
import { ErrorState, Loading } from '../../components/common';
import { AssetCard } from '../assets/asset-card';
import { LayersPanel, LayersSummary } from '../layers/layers-panel';
import { PhonePlate, PlacePlate } from './place-plate';
import { PhoneToolBar, ToolBar, toolButtonId } from './tool-bar';
import { FloatingPanel } from './floating-panel';
import { SectionSheet } from './section-sheet';
import { CameraFeed, HeadingPlate, PhoneHeading } from './heading-plate';
import { ScalePlate } from './scale-bar';
import { ReadoutPlate } from './readout-plate';
import { CreditsPlate } from './credits-plate';
import { NotesStack } from './notes-stack';
import { EdgeChips } from './edge-chips';
import { Palette } from './palette';
import { RadiusPanel } from './radius-panel';
import { useShortcuts } from './use-shortcuts';
import { PhoneSheet } from './bottom-sheet';
import { SceneAssetList } from './scene-asset-list';
import { usePhone } from '../../hooks/media';
import { ProfileDrawer, ProfileHint } from '../section/profile-drawer';

const CesiumView = lazy(() => import('../digital-twin/cesium-view'));
// The measuring tool is only downloaded when it is first opened.
const MeasureTool = lazy(() => import('../measure/measure-tool'));
// Perfil, Corte and Radio in the scene (Cesium), on demand too.
const SectionScene = lazy(() => import('../section/section-scene'));
// Stable empty arrays so the viewer's effects do not re-run on every render while loading.
const noAssets: Asset[] = [];
const noInstallations: Installation[] = [];

/**
 * The whole application: the 3D scene runs to every edge of the screen and is mounted once, never
 * rebuilt (not for a section sheet, another installation or a new URL); the HUD floats over it as
 * opaque plates. Sections open as sheets over the scene.
 */
export function Stage() {
  useRealtime();
  useRouteSync();
  useShortcuts();
  const assets = useAssets(),
    installations = useInstallations();
  const page = useUI((s) => s.page),
    selected = useUI((s) => s.selectedAssetId),
    installationId = useUI((s) => s.installationId),
    select = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation);
  const panel = useTool((s) => s.panel),
    closePanel = useTool((s) => s.closePanel),
    tool = useTool((s) => s.tool);
  const profiling = tool === 'profile';
  const api = useScene((s) => s.api),
    lidarOn = useScene((s) => s.terrain === 'lidar'),
    lidar = useScene((s) => s.lidar);
  const phone = usePhone();
  const failed = assets.isError || installations.isError;
  // The viewer is never gated on query state: unmounting it would destroy the WebGL context, the
  // chosen base layer, ion terrain and buildings, and the camera.
  const [ground, setGround] = useState<((lng: number, lat: number) => number) | undefined>();
  useEffect(() => {
    setGround(() => (lidarOn && api ? api.groundAt : undefined));
  }, [lidarOn, api, lidar]);
  // Panels and sheets run from under the tool bar down to the bottom plates: the CSS gets both
  // limits as variables, kept current as plates wrap or notes appear.
  const stage = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const top = element.querySelector('.hud-tl')?.getBoundingClientRect().bottom ?? 96;
      const bottom = element.querySelector('.hud-bottom')?.getBoundingClientRect().top;
      element.style.setProperty('--hud-top', `${Math.ceil(top) + 8}px`);
      element.style.setProperty(
        '--hud-bottom',
        `${Math.ceil(window.innerHeight - (bottom ?? window.innerHeight - 60)) + 8}px`,
      );
    };
    if (phone) return;
    measure();
    // The variables resize panels, sheets and the card, which other observers watch (the edge
    // chips, the card's placement). Written inside a ResizeObserver callback, those changes come
    // too late for the observers already run in that pass, and the browser reports «ResizeObserver
    // loop completed with undelivered notifications». So the callback only asks for one
    // measurement in the next frame, before its layout.
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    const observer = new ResizeObserver(schedule);
    for (const part of element.querySelectorAll('.hud-tl, .hud-bottom')) observer.observe(part);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [phone]);
  const measureTool = api ? (
    <Suspense fallback={<Loading />}>
      <MeasureTool viewer={api.viewer} ground={ground} />
    </Suspense>
  ) : (
    <Loading label="Esperando al visor…" />
  );
  const sectionScene = api && (profiling || tool === 'radius') && (
    <Suspense fallback={null}>
      <SectionScene viewer={api.viewer} ground={api.groundAt} />
    </Suspense>
  );
  const error = failed && (
    <div className="plate hud-error" data-map-overlay>
      <ErrorState
        error={assets.error ?? installations.error}
        retry={() => {
          void assets.refetch();
          void installations.refetch();
        }}
      />
    </div>
  );
  return (
    <main className="stage" ref={stage} aria-label="Gemelo digital de Laguna de Duero">
      <Suspense fallback={<Loading label="Inicializando motor geoespacial…" />}>
        <CesiumView
          assets={assets.data ?? noAssets}
          installations={installations.data ?? noInstallations}
          installationId={installationId}
          selectedId={selected}
          onSelect={select}
          onInstallation={setInstallation}
        />
      </Suspense>
      {sectionScene}
      <CameraFeed />
      {phone ? (
        <div className="hud hud-phone">
          <div className="phone-top">
            <PhonePlate />
            <div className="phone-row">
              <ScalePlate />
              <PhoneHeading />
            </div>
            {profiling && <ProfileHint />}
          </div>
          {profiling && panel !== 'layers' && page === 'twin' && <ProfileDrawer />}
          <SceneAssetList />
          {error}
          {page !== 'twin' ? (
            <SectionSheet sheet={page} />
          ) : profiling && panel !== 'layers' ? null : panel === 'layers' ? (
            <PhoneSheet
              key="layers"
              id="panel-layers"
              anchorId={toolButtonId('layers')}
              label="Capas"
              extra={<LayersSummary />}
              snaps={[45, 90]}
              initial={90}
              onClose={closePanel}
            >
              <LayersPanel />
            </PhoneSheet>
          ) : panel === 'measure' ? (
            <PhoneSheet
              key="measure"
              id="panel-measure"
              anchorId={toolButtonId('measure')}
              label="Medir"
              snaps={[25, 45, 90]}
              initial={45}
              onClose={closePanel}
            >
              {measureTool}
            </PhoneSheet>
          ) : panel === 'radius' ? (
            <PhoneSheet
              key="radius"
              id="panel-radius"
              label="Radio"
              extra={<span className="panel-sub">ST_DWithin · PostGIS</span>}
              snaps={[25, 45, 90]}
              initial={45}
              onClose={closePanel}
            >
              <RadiusPanel />
            </PhoneSheet>
          ) : (
            <AssetCard />
          )}
          <EdgeChips />
          <div className="phone-bottom">
            <NotesStack />
            <CreditsPlate />
          </div>
          <PhoneToolBar />
          <Palette />
        </div>
      ) : (
        <div className="hud">
          <div className="hud-tl">
            <PlacePlate />
            <ToolBar />
            {profiling && <ProfileHint />}
          </div>
          <SceneAssetList />
          {error}
          {page !== 'twin' ? (
            <SectionSheet sheet={page} />
          ) : panel === 'layers' ? (
            <FloatingPanel
              id="panel-layers"
              anchorId={toolButtonId('layers')}
              label="Capas"
              title="Capas"
              extra={<LayersSummary />}
              width={340}
              onClose={closePanel}
            >
              <LayersPanel />
            </FloatingPanel>
          ) : panel === 'measure' ? (
            <FloatingPanel
              id="panel-measure"
              anchorId={toolButtonId('measure')}
              label="Medir"
              title="Medir"
              width={330}
              onClose={closePanel}
            >
              {measureTool}
            </FloatingPanel>
          ) : panel === 'radius' ? (
            <FloatingPanel
              id="panel-radius"
              anchorId={toolButtonId('radius')}
              label="Radio"
              title="Radio"
              extra={<span className="panel-sub">ST_DWithin · PostGIS</span>}
              width={330}
              onClose={closePanel}
            >
              <RadiusPanel />
            </FloatingPanel>
          ) : null}
          <HeadingPlate />
          {profiling && <ProfileDrawer />}
          <AssetCard />
          <EdgeChips />
          <div className="hud-bottom">
            <div className="hud-bl">
              <ScalePlate />
              <ReadoutPlate />
            </div>
            <div className="hud-br">
              <NotesStack />
              <CreditsPlate />
            </div>
          </div>
          <Palette />
        </div>
      )}
    </main>
  );
}
