import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { ConversionWarning } from './types';

const REQUIRED_BONES = [
  'hips', 'spine', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
] as const;

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseGltf(loader: GLTFLoader, bytes: Uint8Array): Promise<{ scene: Object3D; userData: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    loader.parse(exactArrayBuffer(bytes), '', (gltf) => resolve(gltf), (error) => reject(error));
  });
}

export async function validateVrm(bytes: Uint8Array): Promise<ConversionWarning[]> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await parseGltf(loader, bytes);
  try {
    const vrm = gltf.userData.vrm as { humanoid?: { getRawBoneNode: (name: string) => unknown }; meta?: { metaVersion?: string } } | undefined;
    if (!vrm) throw new Error('生成したGLBをVRMとして読み込めませんでした');
    if (!vrm.humanoid) throw new Error('生成したVRMにhumanoid情報がありません');
    const missing = REQUIRED_BONES.filter((name) => !vrm.humanoid?.getRawBoneNode(name));
    if (missing.length > 0) throw new Error(`生成したVRMの必須ボーンを再読込で確認できません: ${missing.join('、')}`);
    if (vrm.meta?.metaVersion !== '1') throw new Error('生成したVRMのメタデータがVRM形式ではありません');
  } finally {
    VRMUtils.deepDispose(gltf.scene);
  }
  return [];
}
