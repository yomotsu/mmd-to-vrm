import * as THREE from 'three';
import { MToonMaterial, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDAnimationHelper } from './mmd/animation/MMDAnimationHelper.js';
import { MMDLoader } from './mmd/loaders/MMDLoader.js';
import { normalizePath } from './assets';
import type { AssetFile } from './types';

const PREVIEW_ORIGIN = 'https://pmx-preview.invalid/';
const PREVIEW_DAMPING_FACTOR = 0.2;
const PREVIEW_ROTATE_SPEED = 2;
const PREVIEW_PAN_SPEED = 2;

export type VrmPreviewMaterialMode = 'mtoon' | 'mtoon-unlit' | 'mmdtoon' | 'pbr';

export interface PreviewController {
  loadMmd(model: AssetFile, assets: AssetFile[]): Promise<void>;
  loadVrm(bytes: Uint8Array): Promise<VrmPreviewMaterialMode>;
  setVrmMaterialMode(mode: VrmPreviewMaterialMode): boolean;
  clearMmd(): void;
  clearVrm(): void;
  update(delta: number): void;
  dispose(): void;
}

function encodedPath(path: string): string {
  return `${PREVIEW_ORIGIN}${normalizePath(path).split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function decodeRequestedPath(url: string): string | undefined {
  try {
    const parsed = new URL(url, PREVIEW_ORIGIN);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return undefined;
    return normalizePath(decodeURIComponent(parsed.pathname));
  } catch {
    return undefined;
  }
}

function createMappedLoadingManager(assets: AssetFile[]): { manager: THREE.LoadingManager; urls: Map<string, string> } {
  const manager = new THREE.LoadingManager();
  const urls = new Map<string, string>();
  const urlsByBasename = new Map<string, string[]>();
  for (const asset of assets) {
    const path = normalizePath(asset.path);
    const url = URL.createObjectURL(asset.file);
    urls.set(path, url);
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const matches = urlsByBasename.get(name) ?? [];
    matches.push(url);
    urlsByBasename.set(name, matches);
  }
  manager.setURLModifier((requestedUrl) => {
    const path = decodeRequestedPath(requestedUrl);
    if (!path) return requestedUrl;
    const exact = urls.get(path);
    if (exact) return exact;
    const lowerPath = path.toLowerCase();
    const matches = [...urls.entries()].filter(([assetPath]) => assetPath.toLowerCase() === lowerPath);
    if (matches.length === 1) return matches[0][1];
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const basenameMatches = urlsByBasename.get(name) ?? [];
    return basenameMatches.length === 1 ? basenameMatches[0] : requestedUrl;
  });
  return { manager, urls };
}

function revokeUrls(urls: Map<string, string>): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

function disposeMaterial(material: THREE.Material): void {
  const textures = new Set<THREE.Texture>();
  const materialRecord = material as THREE.Material & {
    uniforms?: Record<string, { value?: unknown }>;
  };
  const values = [
    ...Object.values(materialRecord),
    ...Object.values(materialRecord.uniforms ?? {}),
  ];
  for (const value of values) {
    if (value instanceof THREE.Texture) textures.add(value);
    if (value && typeof value === 'object' && 'value' in value) {
      const uniformValue = (value as { value?: unknown }).value;
      if (uniformValue instanceof THREE.Texture) textures.add(uniformValue);
    }
  }
  textures.forEach((texture) => texture.dispose());
  material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    drawable.geometry?.dispose();
    const materials = Array.isArray(drawable.material)
      ? drawable.material
      : drawable.material == null ? [] : [drawable.material];
    materials.forEach(disposeMaterial);
  });
}

function materialList(material: THREE.Material | THREE.Material[] | undefined): THREE.Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

type PreviewMaterialSource = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: THREE.Vector2;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  alphaMap?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  lightMapIntensity?: number;
  aoMap?: THREE.Texture | null;
  aoMapIntensity?: number;
  fog?: boolean;
};

interface VrmMaterialBinding {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  materials: THREE.Material[];
  visibility: boolean[];
}

function previewMaterialSource(material: THREE.Material): PreviewMaterialSource {
  return material as PreviewMaterialSource;
}

function clonePreviewTexture(texture: THREE.Texture | null | undefined): THREE.Texture | null {
  if (!texture) return null;
  const clone = texture.clone();
  clone.needsUpdate = true;
  return clone;
}

function copyPreviewMaterialState(source: PreviewMaterialSource, target: THREE.Material): void {
  target.name = source.name;
  target.blending = source.blending;
  target.side = source.side;
  target.vertexColors = source.vertexColors;
  target.opacity = source.opacity;
  target.transparent = source.transparent;
  target.alphaTest = source.alphaTest;
  target.blendSrc = source.blendSrc;
  target.blendDst = source.blendDst;
  target.blendEquation = source.blendEquation;
  target.blendSrcAlpha = source.blendSrcAlpha;
  target.blendDstAlpha = source.blendDstAlpha;
  target.blendEquationAlpha = source.blendEquationAlpha;
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.dithering = source.dithering;
  target.premultipliedAlpha = source.premultipliedAlpha;
  target.toneMapped = source.toneMapped;
  (target as THREE.Material & { fog?: boolean }).fog = source.fog;
  target.userData = { ...source.userData };
}

/**
 * A lighting-free view of the VRM base color. three-vrm's MToonMaterial is a
 * lit shader and has no unlit switch, so this preview mode intentionally uses
 * the equivalent three.js unlit material while keeping the VRM textures and
 * alpha settings.
 */
function createMtoonUnlitMaterial(sourceMaterial: THREE.Material): THREE.MeshBasicMaterial {
  const source = previewMaterialSource(sourceMaterial);
  const material = new THREE.MeshBasicMaterial({
    color: source.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: clonePreviewTexture(source.map),
    alphaMap: clonePreviewTexture(source.alphaMap),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    fog: source.fog ?? true,
  });
  copyPreviewMaterialState(source, material);
  return material;
}

/**
 * A regular MToon preview. MToon output can use the original material loaded
 * by VRMLoaderPlugin; this fallback is used when the generated VRM contains a
 * standard Lit material instead.
 */
function createMtoonMaterial(sourceMaterial: THREE.Material): MToonMaterial {
  const source = previewMaterialSource(sourceMaterial);
  const map = clonePreviewTexture(source.map);
  const shadeMultiplyTexture = clonePreviewTexture(source.map);
  const material = new MToonMaterial({
    color: source.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: map ?? undefined,
    normalMap: clonePreviewTexture(source.normalMap) ?? undefined,
    normalScale: source.normalScale?.clone(),
    emissive: source.emissive?.clone() ?? new THREE.Color(0, 0, 0),
    emissiveMap: clonePreviewTexture(source.emissiveMap) ?? undefined,
    emissiveIntensity: typeof source.emissiveIntensity === 'number' ? source.emissiveIntensity : 1,
    shadeColorFactor: new THREE.Color(1, 1, 1),
    shadeMultiplyTexture: shadeMultiplyTexture ?? undefined,
    shadingToonyFactor: 0.9,
    shadingShiftFactor: 0,
    matcapFactor: new THREE.Color(1, 1, 1),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    fog: source.fog ?? true,
  });
  copyPreviewMaterialState(source, material);
  return material;
}

function createPbrMaterial(sourceMaterial: THREE.Material): THREE.MeshStandardMaterial {
  const source = previewMaterialSource(sourceMaterial);
  const roughness = typeof source.roughness === 'number' && Number.isFinite(source.roughness)
    ? source.roughness
    : 0.8;
  const metalness = typeof source.metalness === 'number' && Number.isFinite(source.metalness)
    ? source.metalness
    : 0;
  const material = new THREE.MeshStandardMaterial({
    color: source.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: clonePreviewTexture(source.map),
    normalMap: clonePreviewTexture(source.normalMap),
    normalScale: source.normalScale?.clone(),
    emissive: source.emissive?.clone() ?? new THREE.Color(0, 0, 0),
    emissiveMap: clonePreviewTexture(source.emissiveMap),
    emissiveIntensity: typeof source.emissiveIntensity === 'number' ? source.emissiveIntensity : 1,
    roughness,
    metalness,
    alphaMap: clonePreviewTexture(source.alphaMap),
    lightMap: clonePreviewTexture(source.lightMap),
    lightMapIntensity: source.lightMapIntensity ?? 1,
    aoMap: clonePreviewTexture(source.aoMap),
    aoMapIntensity: source.aoMapIntensity ?? 1,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
  });
  copyPreviewMaterialState(source, material);
  return material;
}

function frameObject(root: THREE.Object3D, camera: THREE.PerspectiveCamera): THREE.Vector3 | undefined {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return undefined;

  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.y -= bounds.min.y;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.01);
  const viewSize = Math.max(size.x, size.y, size.z, 0.01);
  const distance = viewSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.18;
  const target = new THREE.Vector3(0, height * 0.52, 0);
  camera.position.set(0, target.y, Math.max(0.1, distance));
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 20);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target;
}

function loadMmd(loader: MMDLoader, url: string): Promise<THREE.SkinnedMesh> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (mesh: THREE.SkinnedMesh) => resolve(mesh),
      undefined,
      (error: unknown) => reject(error instanceof Error ? error : new Error('MMDプレビューを読み込めません')),
    );
  });
}

function loadVrm(loader: GLTFLoader, bytes: Uint8Array): Promise<{ scene: THREE.Group; vrm?: VRM }> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => resolve({ scene: gltf.scene, vrm: gltf.userData.vrm as VRM | undefined }),
      (error: unknown) => reject(error instanceof Error ? error : new Error('VRMプレビューを読み込めません')),
    );
  });
}

interface CameraState {
  direction: THREE.Vector3;
  distanceFactor: number;
  panFactor: THREE.Vector3;
  zoom: number;
}

class PreviewSide {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly frameTarget = new THREE.Vector3();
  private frameDistance = 1;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x111521, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = PREVIEW_DAMPING_FACTOR;
    this.controls.rotateSpeed = PREVIEW_ROTATE_SPEED;
    this.controls.enablePan = true;
    this.controls.panSpeed = PREVIEW_PAN_SPEED;
    this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(8);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(172);

    this.scene.add(new THREE.HemisphereLight(0xd7e8ff, 0x182033, 2.1));
    const keyLight = new THREE.DirectionalLight(0xfff4e2, 3.2);
    keyLight.position.set(-2, 4, 5);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9fc7ff, 1.2);
    fillLight.position.set(3, 2, -2);
    this.scene.add(fillLight);

    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  public resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || 320);
    const height = Math.max(1, rect.height || 360);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public frame(root: THREE.Object3D): void {
    const target = frameObject(root, this.camera);
    if (!target) return;
    this.controls.target.copy(target);
    this.controls.update();
    this.frameTarget.copy(target);
    this.frameDistance = Math.max(0.1, this.camera.position.distanceTo(this.controls.target));
  }

  public getCameraState(): CameraState {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = Math.max(0.1, offset.length());
    return {
      direction: offset.normalize(),
      distanceFactor: distance / this.frameDistance,
      panFactor: this.controls.target.clone().sub(this.frameTarget).multiplyScalar(1 / this.frameDistance),
      zoom: this.camera.zoom,
    };
  }

  public setCameraState(state: CameraState): void {
    // A side that was previously interacted with may still have an OrbitControls
    // damping delta. Flush that pending input before applying the shared state,
    // otherwise it can pull the two previews apart for a few frames.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;

    this.controls.target.copy(this.frameTarget).addScaledVector(state.panFactor, this.frameDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(
      state.direction,
      Math.max(0.1, this.frameDistance * state.distanceFactor),
    );
    this.camera.zoom = state.zoom;
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
  }

  public updateControls(): void {
    this.controls.update();
  }

  public dispose(): void {
    this.controls.dispose();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}

export function createPreviewController(
  mmdCanvas: HTMLCanvasElement,
  vrmCanvas: HTMLCanvasElement,
): PreviewController {
  const mmd = new PreviewSide(mmdCanvas);
  const vrm = new PreviewSide(vrmCanvas);
  const gltfLoader = new GLTFLoader();
  gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

  let mmdMesh: THREE.SkinnedMesh | null = null;
  let mmdHelper: MMDAnimationHelper | null = null;
  let mmdUrls = new Map<string, string>();
  let mmdSequence = 0;
  let vrmRoot: THREE.Group | null = null;
  let vrmModel: VRM | undefined;
  let vrmSequence = 0;
  let vrmPreviewMaterialMode: VrmPreviewMaterialMode = 'mtoon';
  let vrmMaterialBindings: VrmMaterialBinding[] = [];
  const activeVrmPreviewMaterials = new Set<THREE.Material>();
  let sharedCameraState: CameraState | undefined;
  let synchronizingCameras = false;

  const syncCamera = (source: PreviewSide, target: PreviewSide): void => {
    if (synchronizingCameras) return;
    sharedCameraState = source.getCameraState();
    synchronizingCameras = true;
    try {
      target.setCameraState(sharedCameraState);
    } finally {
      synchronizingCameras = false;
    }
  };
  mmd.controls.addEventListener('change', () => syncCamera(mmd, vrm));
  vrm.controls.addEventListener('change', () => syncCamera(vrm, mmd));

  const frameAndSync = (side: PreviewSide, root: THREE.Object3D, other: PreviewSide, otherRoot: THREE.Object3D | null): void => {
    // Frame the first model normally. Once a shared state exists (for example
    // when the VRM is loaded after the user has adjusted the MMD preview), keep
    // that exact rotation, zoom, and pan while fitting the new model's camera
    // clipping planes above.
    const previousState = sharedCameraState;
    synchronizingCameras = true;
    try {
      side.frame(root);
    } finally {
      synchronizingCameras = false;
    }
    if (previousState) {
      synchronizingCameras = true;
      try {
        side.setCameraState(previousState);
      } finally {
        synchronizingCameras = false;
      }
    }
    sharedCameraState = side.getCameraState();
    if (otherRoot) {
      synchronizingCameras = true;
      try {
        other.setCameraState(sharedCameraState);
      } finally {
        synchronizingCameras = false;
      }
    }
  };

  const captureVrmMaterials = (root: THREE.Object3D): VrmMaterialBinding[] => {
    const bindings: VrmMaterialBinding[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const original = mesh.material;
      const materials = materialList(original);
      bindings.push({
        mesh,
        original,
        materials,
        visibility: materials.map((material) => material.visible),
      });
    });
    return bindings;
  };

  const disposeActiveVrmPreviewMaterials = (): void => {
    activeVrmPreviewMaterials.forEach(disposeMaterial);
    activeVrmPreviewMaterials.clear();
  };

  const applyVrmMaterialMode = (): void => {
    if (!vrmRoot) return;

    disposeActiveVrmPreviewMaterials();
    const sourceMaterials = materialList(mmdMesh?.material);
    const sourceByName = new Map<string, THREE.Material>();
    for (const material of sourceMaterials) {
      if (material.name && !sourceByName.has(material.name)) sourceByName.set(material.name, material);
    }

    for (const binding of vrmMaterialBindings) {
      binding.materials.forEach((material, index) => {
        material.visible = binding.visibility[index] ?? true;
      });
      const nextMaterials = binding.materials.map((material, index) => {
        if (vrmPreviewMaterialMode === 'mtoon') {
          if (material instanceof MToonMaterial || (material as MToonMaterial).isMToonMaterial === true) {
            return material;
          }
          const previewMaterial = createMtoonMaterial(material);
          activeVrmPreviewMaterials.add(previewMaterial);
          return previewMaterial;
        }
        const isOutline = material.name.endsWith(' (Outline)');
        if (isOutline) {
          material.visible = false;
          return material;
        }
        if (vrmPreviewMaterialMode === 'mmdtoon') {
          const source = (material.name ? sourceByName.get(material.name) : undefined) ?? sourceMaterials[index];
          if (!source) return material;
          const previewMaterial = source.clone();
          activeVrmPreviewMaterials.add(previewMaterial);
          return previewMaterial;
        }
        if (vrmPreviewMaterialMode === 'mtoon-unlit') {
          const previewMaterial = createMtoonUnlitMaterial(material);
          activeVrmPreviewMaterials.add(previewMaterial);
          return previewMaterial;
        }
        const previewMaterial = createPbrMaterial(material);
        activeVrmPreviewMaterials.add(previewMaterial);
        return previewMaterial;
      });
      binding.mesh.material = Array.isArray(binding.original) ? nextMaterials : nextMaterials[0];
    }
  };

  const clearMmd = (): void => {
    mmdSequence += 1;
    if (mmdHelper && mmdMesh) mmdHelper.remove(mmdMesh);
    mmdHelper = null;
    if (mmdMesh) {
      mmd.scene.remove(mmdMesh);
      disposeObject(mmdMesh);
      mmdMesh = null;
    }
    revokeUrls(mmdUrls);
    mmdUrls = new Map<string, string>();
    if (vrmRoot && vrmPreviewMaterialMode === 'mmdtoon') applyVrmMaterialMode();
    if (!vrmRoot) sharedCameraState = undefined;
  };

  const clearVrm = (): void => {
    vrmSequence += 1;
    if (vrmRoot) {
      disposeActiveVrmPreviewMaterials();
      for (const binding of vrmMaterialBindings) {
        binding.mesh.material = binding.original;
        binding.materials.forEach((material, index) => {
          material.visible = binding.visibility[index] ?? true;
        });
      }
      vrmMaterialBindings = [];
      vrm.scene.remove(vrmRoot);
      VRMUtils.deepDispose(vrmRoot);
      vrmRoot = null;
    }
    vrmModel = undefined;
    if (!mmdMesh) sharedCameraState = undefined;
  };

  return {
    async loadMmd(model, assets): Promise<void> {
      const sequence = ++mmdSequence;
      const mapped = createMappedLoadingManager(assets);
      const loader = new MMDLoader(mapped.manager);
      const modelUrl = encodedPath(model.path);
      let managerError: Error | undefined;
      let resolveManager: (() => void) | undefined;
      let rejectManager: ((error: Error) => void) | undefined;
      const managerPromise = new Promise<void>((resolve, reject) => {
        resolveManager = resolve;
        rejectManager = reject;
      });
      mapped.manager.onLoad = () => resolveManager?.();
      mapped.manager.onError = (url) => {
        managerError = new Error(`MMDプレビューのファイルを読み込めません: ${url}`);
        rejectManager?.(managerError);
      };
      try {
        const [mesh] = await Promise.all([loadMmd(loader, modelUrl), managerPromise]);
        if (managerError) throw managerError;
        if (sequence !== mmdSequence) {
          disposeObject(mesh);
          revokeUrls(mapped.urls);
          return;
        }
        clearMmd();
        mmdUrls = mapped.urls;
        mmdMesh = mesh;
        mmdMesh.frustumCulled = false;
        mmd.scene.add(mmdMesh);
        mmdHelper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
        mmdHelper.add(mmdMesh, { physics: false });
        if (vrmRoot && vrmPreviewMaterialMode === 'mmdtoon') applyVrmMaterialMode();
        frameAndSync(mmd, mmdMesh, vrm, vrmRoot);
      } catch (error) {
        revokeUrls(mapped.urls);
        throw error;
      }
    },

    async loadVrm(bytes): Promise<VrmPreviewMaterialMode> {
      const sequence = ++vrmSequence;
      const loaded = await loadVrm(gltfLoader, bytes);
      if (sequence !== vrmSequence) {
        VRMUtils.deepDispose(loaded.scene);
        return vrmPreviewMaterialMode;
      }
      clearVrm();
      vrmRoot = loaded.scene;
      vrmModel = loaded.vrm;
      vrmMaterialBindings = captureVrmMaterials(vrmRoot);
      applyVrmMaterialMode();
      vrm.scene.add(vrmRoot);
      frameAndSync(vrm, vrmRoot, mmd, mmdMesh);
      vrmModel?.update(0);
      return vrmPreviewMaterialMode;
    },

    setVrmMaterialMode(mode): boolean {
      vrmPreviewMaterialMode = mode;
      if (!vrmRoot) return false;
      applyVrmMaterialMode();
      return true;
    },

    clearMmd,
    clearVrm,

    update(delta): void {
      if (vrmModel) vrmModel.update(Math.max(0, Math.min(delta, 0.05)));
      mmd.updateControls();
      vrm.updateControls();
      mmd.render();
      vrm.render();
    },

    dispose(): void {
      clearMmd();
      clearVrm();
      mmd.dispose();
      vrm.dispose();
    },
  };
}
