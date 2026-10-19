import { create } from 'zustand';
import type { Viewer } from 'cesium';
import type { LidarTerrain } from '../features/layers/lidar-terrain';
import type { ScreenBox } from '../features/digital-twin/camera';

/**
 * The 3D viewer, published for the HUD plates. The plates never import Cesium (it stays in the
 * lazy viewer chunk): the viewer hands them this small API, built from Cesium inside that chunk,
 * and the plates subscribe to camera changes and renders to write into their DOM directly,
 * without a React render per frame.
 */
export interface ScreenPoint {
  x: number;
  y: number;
}
export interface GeoPoint {
  lng: number;
  lat: number;
  /** Ellipsoidal height in metres. */
  h: number;
}
export interface CameraInfo {
  /** Degrees, 0 = north, clockwise. */
  heading: number;
  /** Degrees, −90 = straight down. */
  pitch: number;
  /** Metres above the ground under the camera. */
  height: number;
  /** The ground at the centre of the view, if the centre looks at the ground. */
  center: GeoPoint | null;
  /** Metres per pixel at the centre of the view. */
  metresPerPixel: number | null;
}
export interface SceneApi {
  viewer: Viewer;
  canvas: HTMLCanvasElement;
  /** Page pixels of a point; null when it is behind the camera. */
  project: (lng: number, lat: number, h: number) => ScreenPoint | null;
  /** Calls back on every camera move (and at its end); returns the unsubscribe function. */
  onCamera: (callback: () => void) => () => void;
  /** Calls back after every rendered frame. */
  onRender: (callback: () => void) => () => void;
  camera: () => CameraInfo;
  /** The globe (the terrain) under a page pixel. */
  pickGround: (x: number, y: number) => GeoPoint | null;
  /** What is drawn under a page pixel (a cloud point, a building, the terrain), from depth. */
  pickSurface: (x: number, y: number) => { point: GeoPoint; cloud: boolean } | null;
  /** Ellipsoidal height of the scene's ground under a point, as the viewer draws it. */
  groundAt: (lng: number, lat: number) => number;
  /** Page box of an installation's label as last drawn; null while it is hidden. */
  labelBox: (installationId: string) => ScreenBox | null;
  zoom: (direction: 1 | -1) => void;
  northUp: () => void;
  /** «Encuadre inicial»: the selected installation, or the whole network. */
  home: () => void;
  /** «Centrar activo» (F): flies to an asset of the scene; false if it is not in the scene. */
  centreAsset: (id: string) => boolean;
  togglePhotoreal: () => void;
  toggleBuildings: () => void;
}
export type LoadState = 'off' | 'loading' | 'on' | 'error';
export interface SceneState {
  api: SceneApi | null;
  terrain: 'ellipsoid' | 'world' | 'lidar';
  lidar: LidarTerrain | undefined;
  /** Assets are drawn at their mounting height (there is relief under them). */
  relief: boolean;
  photoreal: LoadState;
  buildings: LoadState;
  /** An error or a note from the viewer (Google, ion), shown in the notes stack. */
  mapMessage: string;
  /** The note shown when roof and tower assets are drawn flat for lack of relief. */
  reliefHint: string;
  /** Cesium's credit container, re-parented into the credits plate. */
  credits: HTMLElement | null;
}
export const useScene = create<SceneState & { set: (state: Partial<SceneState>) => void }>(
  (set) => ({
    api: null,
    terrain: 'ellipsoid',
    lidar: undefined,
    relief: false,
    photoreal: 'off',
    buildings: 'off',
    mapMessage: '',
    reliefHint: '',
    credits: null,
    set: (state) => set(state),
  }),
);
