/**
 * The small API the HUD plates use to read the scene, built from Cesium inside the lazy viewer
 * chunk (see stores/viewer.ts). Positions are page pixels: the canvas fills the screen.
 */
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  HeadingPitchRange,
  Math as CesiumMath,
  SceneTransforms,
  type Viewer,
} from 'cesium';
import type { GeoPoint, SceneApi } from '../../stores/viewer';

const geo = (c: Cartographic): GeoPoint => ({
  lng: CesiumMath.toDegrees(c.longitude),
  lat: CesiumMath.toDegrees(c.latitude),
  h: c.height,
});

export function createSceneApi(
  v: Viewer,
  actions: {
    ground: (lng: number, lat: number) => number;
    home: () => void;
    togglePhotoreal: () => void;
    toggleBuildings: () => void;
  },
): SceneApi {
  const scene = v.scene,
    camera = v.camera;
  // Camera events fire for small moves too: plates follow the camera smoothly.
  camera.percentageChanged = 0.001;
  const local = (x: number, y: number) => {
    const rect = scene.canvas.getBoundingClientRect();
    return new Cartesian2(x - rect.left, y - rect.top);
  };
  const pickCartesian = (x: number, y: number) => {
    const ray = camera.getPickRay(local(x, y));
    if (!ray) return undefined;
    // With the Google mesh the globe is hidden: read the depth instead.
    if (!scene.globe.show)
      return scene.pickPositionSupported ? scene.pickPosition(local(x, y)) : undefined;
    return scene.globe.pick(ray, scene);
  };
  const pickGround = (x: number, y: number) => {
    const hit = pickCartesian(x, y);
    return hit ? geo(Cartographic.fromCartesian(hit)) : null;
  };
  const centre = () => {
    const rect = scene.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  return {
    viewer: v,
    canvas: scene.canvas,
    project: (lng, lat, h) => {
      if (v.isDestroyed()) return null;
      const at = SceneTransforms.worldToWindowCoordinates(
        scene,
        Cartesian3.fromDegrees(lng, lat, h),
      );
      if (!at) return null;
      const rect = scene.canvas.getBoundingClientRect();
      return { x: rect.left + at.x, y: rect.top + at.y };
    },
    onCamera: (callback) => {
      const a = camera.changed.addEventListener(callback),
        b = camera.moveEnd.addEventListener(callback);
      return () => {
        a();
        b();
      };
    },
    onRender: (callback) => scene.postRender.addEventListener(callback),
    camera: () => {
      const c = camera.positionCartographic;
      const lng = CesiumMath.toDegrees(c.longitude),
        lat = CesiumMath.toDegrees(c.latitude);
      const { x, y } = centre();
      const hit = pickCartesian(x, y);
      let metresPerPixel: number | null = null;
      if (hit) {
        const distance = Cartesian3.distance(camera.positionWC, hit);
        const size = camera.frustum.getPixelDimensions(
          scene.canvas.clientWidth || 1,
          scene.canvas.clientHeight || 1,
          distance,
          1,
          new Cartesian2(),
        );
        metresPerPixel = size.x;
      }
      return {
        heading: CesiumMath.toDegrees(camera.heading),
        pitch: CesiumMath.toDegrees(camera.pitch),
        height: c.height - actions.ground(lng, lat),
        center: hit ? geo(Cartographic.fromCartesian(hit)) : null,
        metresPerPixel,
      };
    },
    pickGround,
    pickSurface: (x, y) => {
      if (v.isDestroyed() || !scene.pickPositionSupported) return null;
      const position = local(x, y);
      const hit = scene.pickPosition(position);
      if (!hit || !Number.isFinite(hit.x) || Cartesian3.magnitude(hit) < 6e6) return null;
      const picked: unknown = scene.pick(position);
      const primitive =
        typeof picked === 'object' && picked && 'primitive' in picked
          ? picked.primitive
          : undefined;
      return {
        point: geo(Cartographic.fromCartesian(hit)),
        cloud: primitive instanceof Cesium3DTileset,
      };
    },
    groundAt: actions.ground,
    zoom: (direction) => {
      const amount = camera.positionCartographic.height * 0.4;
      if (direction > 0) camera.zoomIn(amount);
      else camera.zoomOut(amount);
      scene.requestRender();
    },
    northUp: () => {
      const { x, y } = centre();
      const hit = pickCartesian(x, y);
      if (hit)
        camera.flyToBoundingSphere(new BoundingSphere(hit, 0), {
          offset: new HeadingPitchRange(
            0,
            camera.pitch,
            Cartesian3.distance(camera.positionWC, hit),
          ),
          duration: 0.8,
        });
      else
        camera.setView({
          orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
        });
      scene.requestRender();
    },
    home: actions.home,
    togglePhotoreal: actions.togglePhotoreal,
    toggleBuildings: actions.toggleBuildings,
  };
}
