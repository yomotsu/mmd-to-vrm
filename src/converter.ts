import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  decodeTexture,
  encodeTexture,
  isMmdStandardToonTexture,
  resolveTextureFile,
  type DecodedImage,
} from './assets';
import { GltfBuilder, minMaxVec, type GltfJsonObject } from './gltf';
import type {
  AssetFile,
  ConversionProgress,
  ConversionResult,
  ConversionWarning,
  ModelMetadata,
  PmxBone,
  PmxConstraint,
  PmxMaterial,
  PmxModel,
  PmxRigidBody,
  TextureAsset,
  Vec3,
} from './types';

export type MaterialMode = 'mtoon' | 'lit';

export interface ConvertOptions {
  pmxPath: string;
  model: PmxModel;
  assets: AssetFile[];
  textureAssets: TextureAsset[];
  metadata: ModelMetadata;
  materialMode?: MaterialMode;
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
}

const PMX_TO_METERS = 0.08;
const VRM_LICENSE_URL = 'https://vrm.dev/licenses/1.0/';
const REQUIRED_HUMANOID_BONES = [
  'hips', 'spine', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
] as const;

const HUMAN_BONE_ALIASES: Record<string, string[]> = {
  hips: ['hips', 'hip', 'center', 'センター', '腰', '骨盤'],
  spine: ['spine', '上半身', '上半身1', '上半身2', '胸', 'body'],
  chest: ['chest', '上半身2', '胸', '胸1'],
  upperChest: ['upperchest', '上半身3', '上胸'],
  neck: ['neck', '首'],
  head: ['head', '頭'],
  leftEye: ['lefteye', 'eye_l', 'eye.l', '左目', '目l', '目左'],
  rightEye: ['righteye', 'eye_r', 'eye.r', '右目', '目r', '目右'],
  jaw: ['jaw', 'あご', '顎'],
  leftUpperLeg: ['leftupperleg', 'leftthigh', 'thigh_l', 'leg_l', '左足', '左大腿'],
  leftLowerLeg: ['leftlowerleg', 'leftcalf', 'calf_l', 'knee_l', '左ひざ', '左膝'],
  leftFoot: ['leftfoot', 'foot_l', '左足首', '左足先'],
  leftToes: ['lefttoes', 'toes_l', '左つま先', '左爪先'],
  rightUpperLeg: ['rightupperleg', 'rightthigh', 'thigh_r', 'leg_r', '右足', '右大腿'],
  rightLowerLeg: ['rightlowerleg', 'rightcalf', 'calf_r', 'knee_r', '右ひざ', '右膝'],
  rightFoot: ['rightfoot', 'foot_r', '右足首', '右足先'],
  rightToes: ['righttoes', 'toes_r', '右つま先', '右爪先'],
  leftShoulder: ['leftshoulder', 'shoulder_l', '肩l', '左肩'],
  leftUpperArm: ['leftupperarm', 'leftarm', 'upperarm_l', 'arm_l', '左腕'],
  leftLowerArm: ['leftlowerarm', 'leftforearm', 'forearm_l', 'elbow_l', '左ひじ', '左肘'],
  leftHand: ['lefthand', 'hand_l', '左手首', '左手'],
  rightShoulder: ['rightshoulder', 'shoulder_r', '肩r', '右肩'],
  rightUpperArm: ['rightupperarm', 'rightarm', 'upperarm_r', 'arm_r', '右腕'],
  rightLowerArm: ['rightlowerarm', 'rightforearm', 'forearm_r', 'elbow_r', '右ひじ', '右肘'],
  rightHand: ['righthand', 'hand_r', '右手首', '右手'],
  leftThumbMetacarpal: ['leftthumbmetacarpal', 'thumb0_l', 'thumb1_l', '左親指０', '左親指0', '左親指１', '左親指1'],
  leftThumbProximal: ['leftthumbproximal', 'thumb1_l', 'thumb2_l', '左親指１', '左親指1', '左親指２', '左親指2'],
  leftThumbDistal: ['leftthumbdistal', 'thumb2_l', 'thumb3_l', '左親指２', '左親指2', '左親指３', '左親指3'],
  leftIndexProximal: ['leftindexproximal', 'index1_l', 'fore1_l', '左人指１', '左人差し指１', '左人指1'],
  leftIndexIntermediate: ['leftindexintermediate', 'index2_l', 'fore2_l', '左人指２', '左人差し指２', '左人指2'],
  leftIndexDistal: ['leftindexdistal', 'index3_l', 'fore3_l', '左人指３', '左人差し指３', '左人指3'],
  leftMiddleProximal: ['leftmiddleproximal', 'middle1_l', '左中指１', '左中指1'],
  leftMiddleIntermediate: ['leftmiddleintermediate', 'middle2_l', '左中指２', '左中指2'],
  leftMiddleDistal: ['leftmiddledistal', 'middle3_l', '左中指３', '左中指3'],
  leftRingProximal: ['leftringproximal', 'ring1_l', 'third1_l', '左薬指１', '左薬指1'],
  leftRingIntermediate: ['leftringintermediate', 'ring2_l', 'third2_l', '左薬指２', '左薬指2'],
  leftRingDistal: ['leftringdistal', 'ring3_l', 'third3_l', '左薬指３', '左薬指3'],
  leftLittleProximal: ['leftlittleproximal', 'pinky1_l', 'little1_l', '左小指１', '左小指1'],
  leftLittleIntermediate: ['leftlittleintermediate', 'pinky2_l', 'little2_l', '左小指２', '左小指2'],
  leftLittleDistal: ['leftlittledistal', 'pinky3_l', 'little3_l', '左小指３', '左小指3'],
  rightThumbMetacarpal: ['rightthumbmetacarpal', 'thumb0_r', 'thumb1_r', '右親指０', '右親指0', '右親指１', '右親指1'],
  rightThumbProximal: ['rightthumbproximal', 'thumb1_r', 'thumb2_r', '右親指１', '右親指1', '右親指２', '右親指2'],
  rightThumbDistal: ['rightthumbdistal', 'thumb2_r', 'thumb3_r', '右親指２', '右親指2', '右親指３', '右親指3'],
  rightIndexProximal: ['rightindexproximal', 'index1_r', 'fore1_r', '右人指１', '右人差し指１', '右人指1'],
  rightIndexIntermediate: ['rightindexintermediate', 'index2_r', 'fore2_r', '右人指２', '右人差し指２', '右人指2'],
  rightIndexDistal: ['rightindexdistal', 'index3_r', 'fore3_r', '右人指３', '右人差し指３', '右人指3'],
  rightMiddleProximal: ['rightmiddleproximal', 'middle1_r', '右中指１', '右中指1'],
  rightMiddleIntermediate: ['rightmiddleintermediate', 'middle2_r', '右中指２', '右中指2'],
  rightMiddleDistal: ['rightmiddledistal', 'middle3_r', '右中指３', '右中指3'],
  rightRingProximal: ['rightringproximal', 'ring1_r', 'third1_r', '右薬指１', '右薬指1'],
  rightRingIntermediate: ['rightringintermediate', 'ring2_r', 'third2_r', '右薬指２', '右薬指2'],
  rightRingDistal: ['rightringdistal', 'ring3_r', 'third3_r', '右薬指３', '右薬指3'],
  rightLittleProximal: ['rightlittleproximal', 'pinky1_r', 'little1_r', '右小指１', '右小指1'],
  rightLittleIntermediate: ['rightlittleintermediate', 'pinky2_r', 'little2_r', '右小指２', '右小指2'],
  rightLittleDistal: ['rightlittledistal', 'pinky3_r', 'little3_r', '右小指３', '右小指3'],
};

const EXPRESSION_ALIASES: Record<string, string[]> = {
  aa: ['あ', 'あー', 'aa', 'a', '口あ'],
  ih: ['い', 'いー', 'ih', 'i', '口い'],
  ou: ['う', 'うー', 'ou', 'u', '口う'],
  ee: ['え', 'えー', 'ee', 'e', '口え'],
  oh: ['お', 'おー', 'oh', 'o', '口お'],
  blink: ['まばたき', '瞬き', 'blink'],
  happy: ['笑い', '笑顔', 'にこり', 'happy', 'joy'],
  angry: ['怒り', '怒る', 'angry'],
  sad: ['悲しい', '悲しみ', 'sad'],
  relaxed: ['リラックス', '困る', 'relaxed'],
};

const VRM_PRESET_NAMES = new Set([
  'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'happy', 'angry', 'sad', 'relaxed',
  'lookUp', 'lookDown', 'lookLeft', 'lookRight', 'blinkLeft', 'blinkRight', 'neutral',
]);

function sourceFormatLabel(model: PmxModel): string {
  return model.metadata.format.toUpperCase();
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('変換をキャンセルしました', 'AbortError');
}

function progress(options: ConvertOptions, value: number, label: string): void {
  options.onProgress?.({ value: Math.max(0, Math.min(1, value)), phase: label });
  checkAbort(options.signal);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function color3(value: Vec3): Vec3 {
  return [clamp(value[0], 0, 1), clamp(value[1], 0, 1), clamp(value[2], 0, 1)];
}

function srgbToLinear(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped <= 0.04045
    ? clamped / 12.92
    : ((clamped + 0.055) / 1.055) ** 2.4;
}

function pmxColor3(value: Vec3): Vec3 {
  const clamped = color3(value);
  return [srgbToLinear(clamped[0]), srgbToLinear(clamped[1]), srgbToLinear(clamped[2])];
}

// MMD's built-in toon textures are one-dimensional ramps. MToon does not
// consume a gradient texture in the same way, so use the darkest red-channel
// value as its shadow color when the PMX references one of those built-ins.
const MMD_STANDARD_TOON_DARK_SRGB: Record<string, number> = {
  '00': 255,
  '01': 205,
  '02': 245,
  '03': 154,
  '04': 248,
  '05': 254,
  '06': 195,
  '07': 255,
  '08': 255,
  '09': 255,
  '10': 255,
};

function standardToonIndex(model: PmxModel, material: PmxMaterial): string | undefined {
  if (material.toonFlag === 0 && material.toonIndex >= 0 && material.toonIndex < model.textures.length) {
    const reference = model.textures[material.toonIndex];
    const match = reference.match(/(?:^|[\\/])toon(10|0[0-9])\.bmp$/i);
    if (match) return match[1];
  }
  if (material.toonIndex < 0 || material.toonFlag !== 0) {
    const index = material.toonIndex + 1;
    if (index >= 0 && index <= 10) return String(index).padStart(2, '0');
  }
  return undefined;
}

function standardToonShadeColor(model: PmxModel, material: PmxMaterial): Vec3 | undefined {
  const index = standardToonIndex(model, material);
  if (!index) return undefined;
  const value = (MMD_STANDARD_TOON_DARK_SRGB[index] ?? 255) / 255;
  const linear = srgbToLinear(value);
  return [linear, linear, linear];
}

function convertPosition(position: Vec3): Vec3 {
  return [position[0] * PMX_TO_METERS, position[1] * PMX_TO_METERS, -position[2] * PMX_TO_METERS];
}

function convertDirection(direction: Vec3): Vec3 {
  return [direction[0], direction[1], -direction[2]];
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s_./\\\-‐‑–—]+/g, '');
}

function boneDisplayName(bone: PmxBone): string {
  return bone.name || bone.englishName || '無名ボーン';
}

function addWarning(warnings: ConversionWarning[], message: string, detail?: string): void {
  warnings.push({ message, detail });
}

function uniqueName(name: string, used: Set<string>, fallback: string): string {
  const base = (name.trim() || fallback).replace(/[\\/:*?"<>|]/g, '_');
  let result = base;
  let suffix = 2;
  while (used.has(result)) result = `${base}_${suffix++}`;
  used.add(result);
  return result;
}

interface HumanMapping {
  roleToBone: Map<string, number>;
  boneToRole: Map<number, string>;
}

interface BoneLayout {
  originalWorld: Matrix4[];
  poseWorld: Matrix4[];
  localTranslations: Vec3[];
  localRotations: Quaternion[];
  nodeIndices: number[];
}

function chooseHumanoidBones(model: PmxModel, warnings: ConversionWarning[]): HumanMapping {
  const candidatesByRole = new Map<string, { index: number; score: number }[]>();
  const normalizedAliases = new Map<string, Set<string>>();
  for (const [role, aliases] of Object.entries(HUMAN_BONE_ALIASES)) {
    normalizedAliases.set(role, new Set(aliases.map(normalizedName)));
  }

  for (const [role, aliases] of normalizedAliases) {
    const candidates: { index: number; score: number }[] = [];
    for (let index = 0; index < model.bones.length; index += 1) {
      const bone = model.bones[index];
      const names = [normalizedName(bone.name), normalizedName(bone.englishName)].filter(Boolean);
      let score = 0;
      for (const name of names) {
        if (name === normalizedName(aliases.values().next().value ?? '')) score = Math.max(score, 1);
        if (aliases.has(name)) score = Math.max(score, 100);
        for (const alias of aliases) {
          if (alias && name.includes(alias)) score = Math.max(score, 45);
        }
      }
      if (score > 0) candidates.push({ index, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    candidatesByRole.set(role, candidates);
  }

  const roleToBone = new Map<string, number>();
  const boneToRole = new Map<number, string>();
  const roles = Object.keys(HUMAN_BONE_ALIASES);
  for (const role of roles) {
    const candidates = candidatesByRole.get(role) ?? [];
    if (candidates.length === 0) continue;
    const bestScore = candidates[0].score;
    const tied = candidates.filter((candidate) => candidate.score === bestScore);
    if (tied.length > 1) {
      addWarning(warnings, `VRMボーン「${role}」の候補が複数あるため自動選択しました`, tied.map((candidate) => boneDisplayName(model.bones[candidate.index])).join('、'));
    }
    const selected = candidates.find((candidate) => !boneToRole.has(candidate.index)) ?? candidates[0];
    if (boneToRole.has(selected.index)) {
      addWarning(warnings, `VRMボーン「${role}」は既存の自動割り当てと重複しました`, boneDisplayName(model.bones[selected.index]));
      continue;
    }
    roleToBone.set(role, selected.index);
    boneToRole.set(selected.index, role);
  }

  const fallback = ['lowerbody', '下半身'].map(normalizedName);
  if (!roleToBone.has('hips')) {
    const lowerBody = model.bones.findIndex((bone) => fallback.includes(normalizedName(bone.name)) || fallback.includes(normalizedName(bone.englishName)));
    if (lowerBody >= 0 && !boneToRole.has(lowerBody)) {
      roleToBone.set('hips', lowerBody);
      boneToRole.set(lowerBody, 'hips');
      addWarning(warnings, 'VRMのhipsが見つからないため、下半身ボーンをhipsとして使用しました', boneDisplayName(model.bones[lowerBody]));
    }
  }

  const missing = REQUIRED_HUMANOID_BONES.filter((role) => !roleToBone.has(role));
  if (missing.length > 0) {
    throw new Error(`必須VRMボーンが不足しています: ${missing.join('、')}`);
  }
  return { roleToBone, boneToRole };
}

function repairParents(model: PmxModel, warnings: ConversionWarning[]): number[] {
  const parents = model.bones.map((bone, index) => {
    if (bone.parentIndex === -1) return -1;
    if (bone.parentIndex < 0 || bone.parentIndex >= model.bones.length || bone.parentIndex === index) {
      addWarning(warnings, '不正なボーン親参照をルートへ修復しました', boneDisplayName(bone));
      return -1;
    }
    return bone.parentIndex;
  });
  const state = new Uint8Array(parents.length);
  const visit = (index: number): void => {
    if (state[index] === 2) return;
    if (state[index] === 1) {
      parents[index] = -1;
      state[index] = 2;
      addWarning(warnings, 'ボーン階層の循環を検出したため、該当ボーンをルートに移動しました', boneDisplayName(model.bones[index]));
      return;
    }
    state[index] = 1;
    const parent = parents[index];
    if (parent >= 0) visit(parent);
    state[index] = 2;
  };
  for (let index = 0; index < parents.length; index += 1) visit(index);
  return parents;
}

function convertedVector(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], -value[2]);
}

function boneDirectionFor(model: PmxModel, parents: number[], index: number): Vector3 | undefined {
  const bone = model.bones[index];
  const position = convertedVector(bone.position);
  if (bone.connectIndex !== undefined && bone.connectIndex >= 0 && bone.connectIndex < model.bones.length
    && bone.connectIndex !== index) {
    const direction = convertedVector(model.bones[bone.connectIndex].position).sub(position);
    if (direction.lengthSq() >= 1e-10) return direction;
  }
  if (bone.offsetPosition && bone.offsetPosition.some((value) => Math.abs(value) > 1e-6)) {
    const direction = convertedVector(bone.offsetPosition);
    if (direction.lengthSq() >= 1e-10) return direction;
  }
  const childIndex = parents.findIndex((parent) => parent === index);
  if (childIndex >= 0) {
    const direction = convertedVector(model.bones[childIndex].position).sub(position);
    if (direction.lengthSq() >= 1e-10) return direction;
  }
  const parent = parents[index];
  if (parent >= 0) {
    const direction = position.clone().sub(convertedVector(model.bones[parent].position));
    if (direction.lengthSq() >= 1e-10) return direction;
  }
  return undefined;
}

function projectedAxis(reference: Vector3, direction: Vector3): Vector3 | undefined {
  const projected = reference.clone().addScaledVector(direction, -reference.dot(direction));
  return projected.lengthSq() >= 1e-10 ? projected.normalize() : undefined;
}

function makeBoneFrameRotation(
  model: PmxModel,
  parents: number[],
  index: number,
  warnings: ConversionWarning[],
): Quaternion {
  const bone = model.bones[index];
  const direction = boneDirectionFor(model, parents, index);
  const xAxis = bone.localXVector
    ? convertedVector(bone.localXVector)
    : bone.fixAxis
      ? convertedVector(bone.fixAxis)
      : direction?.clone();
  if (!xAxis || xAxis.lengthSq() < 1e-10) {
    addWarning(warnings, 'ボーンの向きを推定できないため、標準軸を使用しました', boneDisplayName(bone));
    xAxis?.set(1, 0, 0);
  }
  const normalizedX = (xAxis && xAxis.lengthSq() >= 1e-10 ? xAxis : new Vector3(1, 0, 0)).normalize();
  let zAxis = bone.localZVector ? convertedVector(bone.localZVector) : undefined;
  if (zAxis) zAxis = projectedAxis(zAxis, normalizedX);
  if (!zAxis) {
    const references = [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)];
    zAxis = references.map((reference) => projectedAxis(reference, normalizedX)).find((value): value is Vector3 => value !== undefined);
  }
  if (!zAxis) {
    addWarning(warnings, 'ボーンのロール軸を推定できないため、標準軸を使用しました', boneDisplayName(bone));
    zAxis = new Vector3(0, 0, 1);
  }
  const yAxis = zAxis.clone().cross(normalizedX).normalize();
  const correctedZ = normalizedX.clone().cross(yAxis).normalize();
  const basis = new Matrix4().makeBasis(normalizedX, yAxis, correctedZ);
  return new Quaternion().setFromRotationMatrix(basis);
}

function makeBoneLayout(model: PmxModel, parents: number[], mapping: HumanMapping, warnings: ConversionWarning[]): BoneLayout {
  const unitScale = new Vector3(1, 1, 1);
  const sourcePositions = model.bones.map((bone) => convertedVector(bone.position));
  const sourceRotations = model.bones.map((_, index) => makeBoneFrameRotation(model, parents, index, warnings));
  const originalWorld = sourcePositions.map((position, index) => new Matrix4().compose(position, sourceRotations[index], unitScale));

  // A PMX model can be authored in an A-pose, while VRM requires the
  // exported humanoid rest pose to look like a T-pose. Apply the arm
  // correction to the world frame of the whole arm subtree. Keeping this
  // separate from originalWorld is important: originalWorld is the bind
  // pose of the vertices, while poseWorld is the VRM rest pose.
  const corrections: { ancestor: number; origin: Vector3; rotation: Quaternion }[] = [];
  const alignArm = (role: string, target: Vec3): void => {
    const index = mapping.roleToBone.get(role);
    if (index === undefined) return;
    const direction = boneDirectionFor(model, parents, index);
    if (!direction || direction.lengthSq() < 1e-10) {
      addWarning(warnings, `Tポーズ化できない${role}ボーンがあります`, boneDisplayName(model.bones[index]));
      return;
    }
    direction.normalize();
    corrections.push({
      ancestor: index,
      origin: sourcePositions[index].clone(),
      rotation: new Quaternion().setFromUnitVectors(direction, new Vector3(...target).normalize()),
    });
  };
  alignArm('leftUpperArm', [1, 0, 0]);
  alignArm('rightUpperArm', [-1, 0, 0]);

  const posePositions = sourcePositions.map((position) => position.clone());
  const poseRotations = sourceRotations.map((rotation) => rotation.clone());
  for (let index = 0; index < model.bones.length; index += 1) {
    const correction = corrections.find(({ ancestor }) => {
      let current = index;
      while (current >= 0) {
        if (current === ancestor) return true;
        current = parents[current];
      }
      return false;
    });
    if (!correction) continue;
    posePositions[index].sub(correction.origin).applyQuaternion(correction.rotation).add(correction.origin);
    poseRotations[index].premultiply(correction.rotation).normalize();
  }

  const poseWorld = posePositions.map((position, index) => new Matrix4().compose(position, poseRotations[index], unitScale));
  const localTranslations: Vec3[] = [];
  const localRotations: Quaternion[] = [];
  for (let index = 0; index < model.bones.length; index += 1) {
    const parent = parents[index];
    const parentPosition = parent >= 0 ? posePositions[parent] : new Vector3();
    const localPosition = posePositions[index].clone().sub(parentPosition);
    const localRotation = poseRotations[index].clone();
    if (parent >= 0) {
      const parentInverse = poseRotations[parent].clone().invert();
      localPosition.applyQuaternion(parentInverse);
      localRotation.premultiply(parentInverse);
    }
    localTranslations.push(localPosition.toArray() as Vec3);
    localRotations.push(localRotation.normalize());
  }

  return { originalWorld, poseWorld, localTranslations, localRotations, nodeIndices: [] };
}

function addNodeChild(nodes: GltfJsonObject[], parent: number, child: number): void {
  const node = nodes[parent];
  const children = (node.children as number[] | undefined) ?? [];
  children.push(child);
  node.children = children;
}

function makeSkinWeights(model: PmxModel, warnings: ConversionWarning[]): { joints: Uint16Array; weights: Float32Array } {
  const joints = new Uint16Array(model.vertices.length * 4);
  const weights = new Float32Array(model.vertices.length * 4);
  let warnedSdef = false;
  let warnedInvalid = false;
  for (let index = 0; index < model.vertices.length; index += 1) {
    const vertex = model.vertices[index];
    if (vertex.deformType === 3 && !warnedSdef) {
      addWarning(warnings, 'SDEFは標準glTFの線形スキニングでは完全再現できないため、BDEF2相当へ近似しました');
      warnedSdef = true;
    }
    const pairs = vertex.boneIndices.map((bone, pairIndex) => ({ bone, weight: vertex.boneWeights[pairIndex] ?? 0 }))
      .filter((pair) => pair.weight > 0 && pair.bone >= 0 && pair.bone < model.bones.length)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
    if (pairs.length === 0) {
      pairs.push({ bone: 0, weight: 1 });
      if (!warnedInvalid) {
        addWarning(warnings, 'ボーンウェイトが不正な頂点を検出したため、先頭ボーンへ割り当てました');
        warnedInvalid = true;
      }
    }
    const total = pairs.reduce((sum, pair) => sum + pair.weight, 0) || 1;
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      joints[index * 4 + pairIndex] = pairs[pairIndex].bone;
      weights[index * 4 + pairIndex] = pairs[pairIndex].weight / total;
    }
  }
  return { joints, weights };
}

function materialIndexForFaces(model: PmxModel, warnings: ConversionWarning[]): number[] {
  const result = new Array<number>(model.faces.length).fill(0);
  let face = 0;
  for (let materialIndex = 0; materialIndex < model.materials.length && face < result.length; materialIndex += 1) {
    const count = Math.max(0, Math.floor(model.materials[materialIndex].indexCount / 3));
    for (let index = 0; index < count && face < result.length; index += 1) result[face++] = materialIndex;
  }
  if (face < result.length) {
    addWarning(warnings, 'マテリアルインデックス数と面数が一致しないため、残りの面を最後のマテリアルへ割り当てました');
    const fallback = Math.max(0, model.materials.length - 1);
    while (face < result.length) result[face++] = fallback;
  }
  return result;
}

interface BakedMorph {
  name: string;
  deltas: Float32Array;
}

function bakeMorphs(model: PmxModel, warnings: ConversionWarning[]): BakedMorph[] {
  const vertexCount = model.vertices.length;
  const cache = new Map<number, Float32Array>();
  const warnedTypes = new Set<number>();
  const visiting = new Set<number>();
  const expand = (index: number): Float32Array => {
    const cached = cache.get(index);
    if (cached) return cached;
    const morph = model.morphs[index];
    const output = new Float32Array(vertexCount * 3);
    if (!morph) return output;
    if (visiting.has(index)) {
      addWarning(warnings, 'モーフの循環参照を検出したため、該当モーフを無視しました', morph.name || morph.englishName);
      return output;
    }
    visiting.add(index);
    if (morph.type === 1) {
      for (const element of morph.elements) {
        if (element.index < 0 || element.index >= vertexCount || !element.position) continue;
        const delta = convertPosition(element.position);
        output[element.index * 3] += delta[0];
        output[element.index * 3 + 1] += delta[1];
        output[element.index * 3 + 2] += delta[2];
      }
    } else if (morph.type === 0) {
      for (const element of morph.elements) {
        if (element.index < 0 || element.index >= model.morphs.length) continue;
        const child = expand(element.index);
        const ratio = element.ratio ?? 0;
        for (let value = 0; value < output.length; value += 1) output[value] += child[value] * ratio;
      }
    } else if (!warnedTypes.has(morph.type)) {
      warnedTypes.add(morph.type);
      addWarning(warnings, `頂点以外のモーフ種別(${morph.type})はVRMの表情へ変換できないため省略しました`);
    }
    visiting.delete(index);
    cache.set(index, output);
    return output;
  };

  const usedNames = new Set<string>();
  const baked: BakedMorph[] = [];
  for (let index = 0; index < model.morphs.length; index += 1) {
    const morph = model.morphs[index];
    if (morph.type !== 0 && morph.type !== 1) continue;
    const deltas = expand(index);
    let nonZero = false;
    for (const value of deltas) {
      if (Math.abs(value) > 1e-8) {
        nonZero = true;
        break;
      }
    }
    if (!nonZero) continue;
    const name = uniqueName(morph.name || morph.englishName, usedNames, `morph_${index}`);
    baked.push({ name, deltas });
  }
  return baked;
}

function makeExpressionName(name: string): { preset?: string; custom: string } {
  const normalized = normalizedName(name);
  for (const [preset, aliases] of Object.entries(EXPRESSION_ALIASES)) {
    if (aliases.some((alias) => normalizedName(alias) === normalized)) return { preset, custom: name };
  }
  return { custom: name };
}

function makeExpressionSet(model: PmxModel, baked: BakedMorph[], meshNode: number, warnings: ConversionWarning[]): GltfJsonObject {
  const preset = new Map<string, GltfJsonObject>();
  const custom = new Map<string, GltfJsonObject>();
  const used = new Set<string>();
  for (let index = 0; index < baked.length; index += 1) {
    const morph = baked[index];
    const expression = makeExpressionName(morph.name);
    const bind = { node: meshNode, index, weight: 1 };
    if (expression.preset) {
      const target = preset.get(expression.preset) ?? { isBinary: false, morphTargetBinds: [] };
      (target.morphTargetBinds as GltfJsonObject[]).push(bind);
      preset.set(expression.preset, target);
      continue;
    }
    let customName = morph.name;
    if (VRM_PRESET_NAMES.has(customName)) customName = `mmd_${customName}`;
    customName = uniqueName(customName, used, `morph_${index}`);
    custom.set(customName, { isBinary: false, morphTargetBinds: [bind] });
  }
  if (model.morphs.some((morph) => morph.type >= 2 && morph.type <= 8)) {
    addWarning(warnings, 'マテリアル・ボーン・UV・インパルスモーフは表情としては変換していません');
  }
  return { preset: Object.fromEntries(preset), custom: Object.fromEntries(custom) };
}

function addTextureData(
  builder: GltfBuilder,
  asset: TextureAsset,
  encoded: Awaited<ReturnType<typeof encodeTexture>>,
): number {
  const image = builder.addImage(encoded.bytes, encoded.mimeType, asset.sourcePath);
  const texture = builder.addTexture(image);
  if (encoded.mimeType === 'image/webp') {
    const textureDefinition = (builder.json.textures as GltfJsonObject[])[texture];
    textureDefinition.extensions = {
      ...(textureDefinition.extensions as GltfJsonObject | undefined),
      EXT_texture_webp: { source: image },
    };
  }
  return texture;
}

interface TextureTable {
  byPath: Map<string, number>;
  encodedByPath: Map<string, Awaited<ReturnType<typeof encodeTexture>>>;
  decodedByTexture: Map<number, DecodedImage>;
}

async function encodeTextures(options: ConvertOptions, builder: GltfBuilder, warnings: ConversionWarning[]): Promise<TextureTable> {
  const byPath = new Map<string, number>();
  const encodedByPath = new Map<string, Awaited<ReturnType<typeof encodeTexture>>>();
  const decodedByTexture = new Map<number, DecodedImage>();
  for (let index = 0; index < options.textureAssets.length; index += 1) {
    const asset = options.textureAssets[index];
    progress(options, 0.02 + (index / Math.max(1, options.textureAssets.length)) * 0.18, `テクスチャを処理中: ${asset.sourcePath}`);
    try {
      const decoded = await decodeTexture(asset, options.signal);
      const encoded = await encodeTexture(asset, decoded, options.signal);
      const texture = addTextureData(builder, asset, encoded);
      byPath.set(asset.sourcePath, texture);
      encodedByPath.set(asset.sourcePath, encoded);
      decodedByTexture.set(texture, decoded);
    } catch (error) {
      throw new Error(`テクスチャ「${asset.sourcePath}」を変換できません: ${String(error)}`);
    }
  }
  if (options.textureAssets.length > 0 && !byPath.size) addWarning(warnings, '使用可能なテクスチャがありません');
  return { byPath, encodedByPath, decodedByTexture };
}

function alphaAtUv(image: DecodedImage, uv: [number, number]): number {
  let x = Math.round(uv[0] * image.width) % image.width;
  let y = Math.round(uv[1] * image.height) % image.height;
  if (x < 0) x += image.width;
  if (y < 0) y += image.height;
  return image.data[(y * image.width + x) * 4 + 3];
}

function materialUsesTransparentTexel(model: PmxModel, materialIndex: number, image: DecodedImage): boolean {
  let firstFace = 0;
  for (let index = 0; index < materialIndex; index += 1) {
    firstFace += Math.max(0, Math.floor(model.materials[index].indexCount / 3));
  }
  const faceCount = Math.min(
    Math.max(0, Math.floor(model.materials[materialIndex].indexCount / 3)),
    Math.max(0, model.faces.length - firstFace),
  );
  // Match MMDLoader's UV/alpha test: sample each triangle's corners and its
  // center. Looking at the entire atlas marks unrelated transparent regions
  // as transparent and changes the depth behavior of layered meshes.
  for (let faceOffset = 0; faceOffset < faceCount; faceOffset += 1) {
    const face = model.faces[firstFace + faceOffset];
    const uvs = face.map((vertexIndex) => model.vertices[vertexIndex]?.uv ?? [0, 0] as [number, number]);
    if (uvs.some((uv) => alphaAtUv(image, uv) < 253)) return true;
    const center: [number, number] = [
      (uvs[0][0] + uvs[1][0] + uvs[2][0]) / 3,
      (uvs[0][1] + uvs[1][1] + uvs[2][1]) / 3,
    ];
    if (alphaAtUv(image, center) < 253) return true;
  }
  return false;
}

function toonRampShadeColor(image: DecodedImage): Vec3 | undefined {
  const samples: { color: Vec3; luminance: number }[] = [];
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] < 253) continue;
    const color = pmxColor3([
      image.data[index] / 255,
      image.data[index + 1] / 255,
      image.data[index + 2] / 255,
    ]);
    samples.push({
      color,
      luminance: color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722,
    });
  }
  if (samples.length === 0) return undefined;
  samples.sort((a, b) => a.luminance - b.luminance);
  const sampleCount = Math.max(1, Math.ceil(samples.length * 0.125));
  const total: Vec3 = [0, 0, 0];
  for (let index = 0; index < sampleCount; index += 1) {
    total[0] += samples[index].color[0];
    total[1] += samples[index].color[1];
    total[2] += samples[index].color[2];
  }
  return total.map((value) => value / sampleCount) as Vec3;
}

function textureIndex(
  model: PmxModel,
  material: PmxMaterial,
  property: 'textureIndex' | 'environmentTextureIndex' | 'toonIndex',
  options: ConvertOptions,
  textureTable: TextureTable,
  warnings: ConversionWarning[],
  missingOptionalReferences: Set<string>,
): number | undefined {
  const index = material[property];
  if (index < 0 || index >= model.textures.length) return undefined;
  const reference = model.textures[index];
  try {
    const source = resolveTextureFile(options.pmxPath, reference, options.assets);
    return textureTable.byPath.get(source.path);
  } catch (error) {
    if (property !== 'textureIndex') {
      if (!missingOptionalReferences.has(reference)) {
        missingOptionalReferences.add(reference);
        const label = property === 'toonIndex' ? 'トゥーン' : 'スフィア（matcap）';
        const standardToon = property === 'toonIndex' && isMmdStandardToonTexture(reference);
        addWarning(
          warnings,
          standardToon
            ? 'MMD標準トゥーンテクスチャが見つからないため、MToonのトゥーン割り当てを省略しました'
            : `${sourceFormatLabel(model)}の${label}テクスチャが見つからないため、割り当てを省略しました`,
          reference,
        );
      }
      return undefined;
    }
    throw error;
  }
}

function makeMaterials(
  builder: GltfBuilder,
  model: PmxModel,
  options: ConvertOptions,
  textureTable: TextureTable,
  warnings: ConversionWarning[],
): number[] {
  const materialIndices: number[] = [];
  const materials = builder.json.materials as GltfJsonObject[];
  const useLit = options.materialMode === 'lit';
  let warnedLitMatcap = false;
  const convertedToonTextures = new Set<number>();
  const missingOptionalReferences = new Set<string>();
  for (let materialIndex = 0; materialIndex < model.materials.length; materialIndex += 1) {
    const material = model.materials[materialIndex];
    const baseTexture = textureIndex(model, material, 'textureIndex', options, textureTable, warnings, missingOptionalReferences);
    const environmentTexture = !useLit && (material.environmentFlag === 1 || material.environmentFlag === 2)
      ? textureIndex(model, material, 'environmentTextureIndex', options, textureTable, warnings, missingOptionalReferences)
      : undefined;
    const standardShadeColor = !useLit ? standardToonShadeColor(model, material) : undefined;
    const toonTexture = !useLit && standardShadeColor === undefined && material.toonFlag === 0
      ? textureIndex(model, material, 'toonIndex', options, textureTable, warnings, missingOptionalReferences)
      : undefined;
    let toonShadeColor = standardShadeColor;
    if (toonTexture !== undefined) {
      const decodedToon = textureTable.decodedByTexture.get(toonTexture);
      const customShadeColor = decodedToon ? toonRampShadeColor(decodedToon) : undefined;
      if (customShadeColor) {
        toonShadeColor = customShadeColor;
        if (!convertedToonTextures.has(toonTexture)) {
          convertedToonTextures.add(toonTexture);
          addWarning(warnings, `${sourceFormatLabel(model)}のカスタムトゥーンランプをMToonの影色へ変換しました`, model.textures[material.toonIndex]);
        }
      }
    }
    if (useLit && !warnedLitMatcap && material.environmentFlag !== 0 && material.environmentTextureIndex >= 0) {
      addWarning(warnings, `${sourceFormatLabel(model)}のスフィア（matcap）テクスチャはLitでは使用しませんでした`);
      warnedLitMatcap = true;
    }
    // PMX material colors are authored in sRGB-like values. glTF and MToon
    // factors are consumed as linear values, just like MMDLoader's
    // `Color.setRGB(..., SRGBColorSpace)` path.
    const diffuse = pmxColor3([material.diffuse[0], material.diffuse[1], material.diffuse[2]]);
    const ambient = pmxColor3(material.ambient);
    const alpha = clamp(material.diffuse[3], 0, 1);
    const baseImage = baseTexture !== undefined ? textureTable.decodedByTexture.get(baseTexture) : undefined;
    const baseTextureHasTransparency = baseImage !== undefined
      && materialUsesTransparentTexel(model, materialIndex, baseImage);
    const alphaMode = alpha < 0.999
      ? 'BLEND'
      : baseTextureHasTransparency
        ? 'MASK'
        : 'OPAQUE';
    const ambientEmission = ambient.map((value) => value * (baseTexture === undefined ? 1 : 0.2)) as Vec3;
    const pbr: GltfJsonObject = {
      baseColorFactor: [diffuse[0], diffuse[1], diffuse[2], alpha],
      metallicFactor: 0,
      // Convert MMD's Blinn-Phong exponent to the closest portable PBR
      // roughness value for Lit output.
      roughnessFactor: clamp(Math.sqrt(2 / (Math.max(0, material.shininess) + 2)), 0.04, 1),
    };
    if (baseTexture !== undefined) pbr.baseColorTexture = { index: baseTexture };
    const gltfMaterial: GltfJsonObject = {
      name: material.name || material.englishName || `material_${materials.length}`,
      pbrMetallicRoughness: pbr,
      // MMDLoader starts from PMX ambient and reduces it to 20% when a color
      // map is present. Keep that small ambient contribution in the VRM's
      // standard emissive channel for both material modes.
      emissiveFactor: [ambientEmission[0], ambientEmission[1], ambientEmission[2]],
      // PMX bit 0 means double-sided, not transparent. Treating it as BLEND
      // disables depth writes and makes hands/thighs disappear when layers
      // overlap from a side or near-edge view. For textures with their own
      // transparent regions, MASK keeps the depth write while discarding the
      // transparent texels instead of drawing them as opaque face polygons.
      alphaMode,
      ...(alphaMode === 'MASK' ? { alphaCutoff: 0.5 } : {}),
      doubleSided: (material.flags & 0x01) !== 0,
    };
    if (!useLit) {
      const mtoon: GltfJsonObject = {
        specVersion: '1.0',
        transparentWithZWrite: alphaMode !== 'BLEND',
        // MToon shadeMultiplyTexture is a UV mask, not an MMD lighting ramp.
        // Use the PMX base texture as that mask so the shadow keeps the
        // material's painted color, then use the darkest representative ramp
        // color as the multiplier. This matches MMD's diffuse*texture*toon
        // multiplication more closely than using a flat shadow tint.
        shadeColorFactor: baseTexture === undefined
          ? diffuse.map((value, index) => value * (toonShadeColor?.[index] ?? 1))
          : (toonShadeColor ?? [1, 1, 1]),
        shadingToonyFactor: 0.9,
        shadingShiftFactor: 0,
        matcapFactor: [1, 1, 1],
        // MMD's additive sphere map is added to the final color without being
        // scaled by direct-light intensity. MToon's matcap is attached to rim
        // lighting, so leave that lighting mix at its neutral value when none
        // is assigned and reduce it when a sphere texture is present.
        rimLightingMixFactor: environmentTexture === undefined ? 1 : 0,
        outlineWidthMode: 'worldCoordinates',
        // MMDLoader converts PMX's edge size to a local outline width with
        // `edgeSize / 300`. Apply the PMX-to-meter scale after that conversion;
        // using the raw edge size here makes a typical value of 1 become an
        // 8 cm MToon outline, which renders as a large black shell.
        outlineWidthFactor: (material.flags & 0x10) !== 0
          ? Math.max(0, (material.edgeSize / 300) * PMX_TO_METERS)
          : 0,
        outlineColorFactor: pmxColor3([material.edgeColor[0], material.edgeColor[1], material.edgeColor[2]]),
        outlineLightingMixFactor: 1,
      };
      if (baseTexture !== undefined) {
        mtoon.shadeMultiplyTexture = { index: baseTexture };
      }
      if (environmentTexture !== undefined && material.environmentFlag === 2) {
        mtoon.matcapTexture = { index: environmentTexture };
      } else if (environmentTexture !== undefined && material.environmentFlag === 1) {
        // MToon's matcap contribution is additive. Assigning an MMD
        // multiply-sphere to it makes the whole material brighter, so an
        // omitted map is a closer result than the wrong blend operation.
        addWarning(warnings, '乗算スフィアテクスチャはMToonに同等の合成がないため省略しました', material.name);
      }
      gltfMaterial.extensions = { VRMC_materials_mtoon: mtoon };
      builder.addExtensionUsed('VRMC_materials_mtoon');
    } else {
      gltfMaterial.extensions = {
        KHR_materials_specular: {
          specularFactor: 1,
          specularColorFactor: pmxColor3(material.specular),
        },
      };
      builder.addExtensionUsed('KHR_materials_specular');
    }
    materials.push(gltfMaterial);
    materialIndices.push(materials.length - 1);
  }
  return materialIndices;
}

function addMesh(
  builder: GltfBuilder,
  model: PmxModel,
  materialIndices: number[],
  bakedMorphs: BakedMorph[],
  warnings: ConversionWarning[],
): { mesh: number } {
  if (model.vertices.length === 0 || model.faces.length === 0) throw new Error('頂点または面がありません');
  const positions = new Float32Array(model.vertices.length * 3);
  const normals = new Float32Array(model.vertices.length * 3);
  const uvs = new Float32Array(model.vertices.length * 2);
  for (let index = 0; index < model.vertices.length; index += 1) {
    const vertex = model.vertices[index];
    const position = convertPosition(vertex.position);
    const normal = convertDirection(vertex.normal);
    positions.set(position, index * 3);
    normals.set(normal, index * 3);
    uvs.set(vertex.uv, index * 2);
  }
  const positionValues = Array.from(positions);
  const positionRange = minMaxVec(positionValues, 3);
  const positionAccessor = builder.addFloatAccessor(positions, 'VEC3', { target: 34962, min: positionRange.min, max: positionRange.max });
  const normalAccessor = builder.addFloatAccessor(normals, 'VEC3', { target: 34962 });
  const uvAccessor = builder.addFloatAccessor(uvs, 'VEC2', { target: 34962 });
  const skinWeights = makeSkinWeights(model, warnings);
  const jointsAccessor = builder.addAccessor(skinWeights.joints, model.bones.length > 255 ? 5123 : 5123, 'VEC4', model.vertices.length, { target: 34962 });
  const weightsAccessor = builder.addFloatAccessor(skinWeights.weights, 'VEC4', { target: 34962 });
  const faceMaterials = materialIndexForFaces(model, warnings);
  const indicesByMaterial = model.materials.map(() => [] as number[]);
  for (let faceIndex = 0; faceIndex < model.faces.length; faceIndex += 1) {
    const materialIndex = clamp(faceMaterials[faceIndex], 0, Math.max(0, indicesByMaterial.length - 1));
    const face = model.faces[faceIndex];
    const destination = indicesByMaterial[materialIndex] ?? indicesByMaterial[0];
    if (!destination) continue;
    // PMX is left-handed; the reflected Z axis also reverses triangle winding.
    destination.push(face[2], face[1], face[0]);
  }
  const primitives: GltfJsonObject[] = [];
  for (let materialIndex = 0; materialIndex < indicesByMaterial.length; materialIndex += 1) {
    const indices = indicesByMaterial[materialIndex];
    if (indices.length === 0) continue;
    const indexData = model.vertices.length <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);
    const indexAccessor = builder.addAccessor(indexData, model.vertices.length <= 65535 ? 5123 : 5125, 'SCALAR', indices.length, { target: 34963 });
    const primitive: GltfJsonObject = {
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor, JOINTS_0: jointsAccessor, WEIGHTS_0: weightsAccessor },
      indices: indexAccessor,
      material: materialIndices[materialIndex] ?? 0,
      mode: 4,
    };
    if (bakedMorphs.length > 0) {
      primitive.targets = bakedMorphs.map((morph) => ({ POSITION: builder.addFloatAccessor(morph.deltas, 'VEC3', { target: 34962 }) }));
    }
    primitives.push(primitive);
  }
  const mesh: GltfJsonObject = {
    name: model.metadata.modelName || 'MMD Model',
    primitives,
  };
  if (bakedMorphs.length > 0) mesh.weights = bakedMorphs.map(() => 0);
  const meshes = builder.json.meshes as GltfJsonObject[];
  meshes.push(mesh);
  return { mesh: meshes.length - 1 };
}

function matrixToArray(matrix: Matrix4): number[] {
  return Array.from(matrix.elements);
}

function makeHumanoidExtension(
  model: PmxModel,
  mapping: HumanMapping,
  metadata: ModelMetadata,
  modelNode: number,
  expressions: GltfJsonObject,
  lookAt: GltfJsonObject | undefined,
): GltfJsonObject {
  const humanBones: GltfJsonObject = {};
  for (const [role, index] of mapping.roleToBone) humanBones[role] = { node: index + 1 };
  return {
    specVersion: '1.0',
    meta: {
      metaVersion: '1',
      name: metadata.name?.trim() || model.metadata.modelName || 'MMD Model',
      version: '1.0',
      authors: [metadata.authors?.trim() || '不明'],
      copyrightInformation: metadata.copyrightInformation?.trim() || '',
      contactInformation: metadata.contactInformation?.trim() || '',
      references: metadata.references?.trim() ? [metadata.references.trim()] : [],
      thirdPartyLicenses: metadata.thirdPartyLicenses?.trim() || '',
      avatarPermission: 'onlyAuthor',
      commercialUsage: 'personalNonProfit',
      modification: 'prohibited',
      allowRedistribution: false,
      creditNotation: 'required',
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      licenseUrl: VRM_LICENSE_URL,
    },
    humanoid: {
      humanBones,
      // Kept in extras for tools which inspect the mesh root while debugging a conversion.
      extras: { modelNode },
    },
    expressions,
    ...(lookAt ? { lookAt } : {}),
  };
}

function makeLookAt(mapping: HumanMapping): GltfJsonObject | undefined {
  if (!mapping.roleToBone.has('leftEye') || !mapping.roleToBone.has('rightEye')) return undefined;
  return {
    type: 'bone',
    offsetFromHeadBone: [0, 0.06, 0],
    rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
    rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
    rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
    rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
  };
}

function rigidBodyBoneIndex(body: PmxRigidBody, model: PmxModel): number | undefined {
  return body.boneIndex >= 0 && body.boneIndex < model.bones.length ? body.boneIndex : undefined;
}

function normalizedRigidBodyTypes(model: PmxModel, parents: number[]): number[] {
  const types = model.rigidBodies.map((body) => body.type);
  // MMDLoader applies the same compatibility rule before constructing its
  // Bullet world: a type-2 body directly below a dynamic type-1 body is
  // treated as type 1. Keep the conversion's spring graph and collider list
  // consistent with that behavior without mutating the parsed PMX model.
  for (const constraint of model.constraints) {
    const bodyA = model.rigidBodies[constraint.rigidBodyIndex1];
    const bodyB = model.rigidBodies[constraint.rigidBodyIndex2];
    if (!bodyA || !bodyB || types[constraint.rigidBodyIndex1] === 0 || types[constraint.rigidBodyIndex2] !== 2) continue;
    const boneA = rigidBodyBoneIndex(bodyA, model);
    const boneB = rigidBodyBoneIndex(bodyB, model);
    if (boneA !== undefined && boneB !== undefined && parents[boneB] === boneA) {
      types[constraint.rigidBodyIndex2] = 1;
    }
  }
  return types;
}

interface ColliderBuildResult {
  colliders: GltfJsonObject[];
  groups: Map<number, number[]>;
  groupBodies: Map<number, PmxRigidBody[]>;
  count: number;
}

function bodyLocalPosition(body: PmxRigidBody, boneIndex: number | undefined, layout: BoneLayout, model: PmxModel): Vec3 {
  const position = convertPosition(body.position);
  if (boneIndex === undefined) return position;
  if (model.metadata.format === 'pmd') return position;
  return new Vector3(...position).applyMatrix4(layout.originalWorld[boneIndex].clone().invert()).toArray() as Vec3;
}

function bodyQuaternion(body: PmxRigidBody): Quaternion {
  const rotation = body.rotation;
  // PMX Euler angles are expressed in the source's left-handed coordinates.
  return new Quaternion().setFromEuler(new Euler(-rotation[0], -rotation[1], rotation[2], 'XYZ'));
}

function colliderNode(
  nodes: GltfJsonObject[],
  parent: number,
  name: string,
  translation: Vec3,
  rotation: Quaternion,
): number {
  const node: GltfJsonObject = { name, translation, rotation: [rotation.x, rotation.y, rotation.z, rotation.w] };
  nodes.push(node);
  const index = nodes.length - 1;
  addNodeChild(nodes, parent, index);
  return index;
}

function makeCapsuleShape(offset: Vec3, tail: Vec3, radius: number): GltfJsonObject {
  return { capsule: { offset, tail, radius: Math.max(0.0001, radius) } };
}

function findSpringTailBone(model: PmxModel, boneIndex: number, parents: number[]): number | undefined {
  const bone = model.bones[boneIndex];
  if (bone.connectIndex !== undefined && bone.connectIndex >= 0 && bone.connectIndex < model.bones.length
    && bone.connectIndex !== boneIndex) {
    return bone.connectIndex;
  }
  const child = parents.findIndex((parent) => parent === boneIndex);
  return child >= 0 ? child : undefined;
}

function springTailTranslation(model: PmxModel, boneIndex: number, parents: number[], layout: BoneLayout): Vec3 {
  const bone = model.bones[boneIndex];
  let direction: Vec3;
  if (bone.offsetPosition && bone.offsetPosition.some((value) => Math.abs(value) > 1e-6)) {
    direction = convertDirection(bone.offsetPosition);
  } else {
    const parentIndex = parents[boneIndex];
    if (parentIndex >= 0) {
      const position = convertPosition(bone.position);
      const parentPosition = convertPosition(model.bones[parentIndex].position);
      direction = [position[0] - parentPosition[0], position[1] - parentPosition[1], position[2] - parentPosition[2]];
    } else {
      direction = [0, -PMX_TO_METERS, 0];
    }
  }
  const vector = new Vector3(...direction);
  if (vector.lengthSq() < 1e-10) vector.set(0, -PMX_TO_METERS, 0);
  const worldRotation = new Quaternion().setFromRotationMatrix(layout.poseWorld[boneIndex]);
  vector.applyQuaternion(worldRotation.invert());
  return [vector.x, vector.y, vector.z];
}

function addSyntheticSpringTail(
  model: PmxModel,
  nodes: GltfJsonObject[],
  boneNodes: number[],
  parents: number[],
  layout: BoneLayout,
  boneIndex: number,
): number {
  const boneNodeIndex = boneNodes[boneIndex];
  const translation = springTailTranslation(model, boneIndex, parents, layout);
  nodes.push({ name: `SpringTail_${boneIndex}`, translation, extras: { springTail: true, pmxBoneIndex: boneIndex } });
  const tailNodeIndex = nodes.length - 1;
  addNodeChild(nodes, boneNodeIndex, tailNodeIndex);
  return tailNodeIndex;
}

function colliderHitRadius(body: PmxRigidBody): number {
  if (body.shapeType !== 1) return Math.max(0.001, body.width * PMX_TO_METERS);
  const dimensions = [body.width, body.height, body.depth];
  let axis = 0;
  if (dimensions[1] > dimensions[axis]) axis = 1;
  if (dimensions[2] > dimensions[axis]) axis = 2;
  const other = [0, 1, 2].filter((value) => value !== axis);
  return Math.max(0.001, Math.min(dimensions[other[0]], dimensions[other[1]]) * PMX_TO_METERS);
}

function buildColliders(
  model: PmxModel,
  nodes: GltfJsonObject[],
  boneNodes: number[],
  layout: BoneLayout,
  bodyTypes: number[],
  warnings: ConversionWarning[],
): ColliderBuildResult {
  const colliders: GltfJsonObject[] = [];
  const groups = new Map<number, number[]>();
  const groupBodies = new Map<number, PmxRigidBody[]>();
  let warnedDynamicCollider = false;
  for (let bodyIndex = 0; bodyIndex < model.rigidBodies.length; bodyIndex += 1) {
    const body = model.rigidBodies[bodyIndex];
    // VRMC_springBone colliders are kinematic. A PMX dynamic rigid body
    // cannot be exported as a collider on the same spring chain without
    // creating a dependency cycle, and freezing it in model space produces
    // the large angle jumps seen on mobuko's collar and skirt. Keep only the
    // type-0 (bone-following) bodies as portable colliders.
    if (bodyTypes[bodyIndex] !== 0) {
      if (!warnedDynamicCollider) {
        addWarning(warnings, `${sourceFormatLabel(model)}の動的剛体はVRMの固定コライダーへ変換できないため省略しました`);
        warnedDynamicCollider = true;
      }
      continue;
    }
    const bodiesInGroup = groupBodies.get(body.groupIndex) ?? [];
    bodiesInGroup.push(body);
    groupBodies.set(body.groupIndex, bodiesInGroup);
    const boneIndex = rigidBodyBoneIndex(body, model);
    const followsBone = boneIndex !== undefined;
    const parent = followsBone ? boneNodes[boneIndex] : 0;
    const base = followsBone ? bodyLocalPosition(body, boneIndex, layout, model) : convertPosition(body.position);
    // MMDLoader stores the PMX rigid-body rotation in the bone-local offset
    // transform. The collider node is already parented to that bone, so keep
    // this quaternion local even when an arm rest-pose rotation is applied.
    const rotation = bodyQuaternion(body);
    const add = (suffix: string, translation: Vec3, shape: GltfJsonObject): void => {
      const node = colliderNode(nodes, parent, `Collider_${bodyIndex}${suffix}`, translation, rotation);
      const colliderIndex = colliders.length;
      colliders.push({ node, shape });
      const group = groups.get(body.groupIndex) ?? [];
      group.push(colliderIndex);
      groups.set(body.groupIndex, group);
    };
    const width = Math.max(0.001, body.width * PMX_TO_METERS);
    const height = Math.max(0.001, body.height * PMX_TO_METERS);
    const depth = Math.max(0.001, body.depth * PMX_TO_METERS);
    if (body.shapeType === 0) {
      // PMX width/height/depth use half-extents; for spheres and capsules
      // PMX's width is already the radius (the same convention as MMDLoader).
      add('', base, { sphere: { offset: [0, 0, 0], radius: width } });
    } else if (body.shapeType === 2) {
      add('', base, makeCapsuleShape([0, -height * 0.5, 0], [0, height * 0.5, 0], width));
    } else {
      // VRMC_springBone has no box shape. Four capsules around the long axis
      // preserve the box's corners without inventing a non-standard collider.
      const dimensions = [width, height, depth];
      let axis = 0;
      if (dimensions[1] > dimensions[axis]) axis = 1;
      if (dimensions[2] > dimensions[axis]) axis = 2;
      const other = [0, 1, 2].filter((value) => value !== axis);
      const radius = Math.min(dimensions[other[0]], dimensions[other[1]]);
      const halfLong = Math.max(0, dimensions[axis] - radius);
      const firstSigns = dimensions[other[0]] > radius + 1e-6 ? [-1, 1] : [1];
      const secondSigns = dimensions[other[1]] > radius + 1e-6 ? [-1, 1] : [1];
      for (const first of firstSigns) {
        for (const second of secondSigns) {
          const transverse: Vec3 = [0, 0, 0];
          transverse[other[0]] = first * Math.max(0, dimensions[other[0]] - radius);
          transverse[other[1]] = second * Math.max(0, dimensions[other[1]] - radius);
          const capsuleOffset: Vec3 = [...transverse];
          const capsuleTail: Vec3 = [...transverse];
          capsuleOffset[axis] = -halfLong;
          capsuleTail[axis] = halfLong;
          add(
            `_${first > 0 ? 'p' : 'n'}${second > 0 ? 'p' : 'n'}`,
            base,
            makeCapsuleShape(convertDirection(capsuleOffset), convertDirection(capsuleTail), radius),
          );
        }
      }
    addWarning(warnings, `${sourceFormatLabel(model)}のボックス剛体を複数のカプセルへ近似しました`, body.name || body.englishName);
    }
  }
  return { colliders, groups, groupBodies, count: colliders.length };
}

function rigidBodyGroupsCanCollide(first: PmxRigidBody, second: PmxRigidBody): boolean {
  const firstGroupBit = 2 ** first.groupIndex;
  const secondGroupBit = 2 ** second.groupIndex;
  return (first.groupTarget & secondGroupBit) !== 0 && (second.groupTarget & firstGroupBit) !== 0;
}

function boneDepth(index: number, parents: number[]): number {
  let depth = 0;
  const visited = new Set<number>();
  let current = index;
  while (current >= 0 && !visited.has(current)) {
    visited.add(current);
    current = parents[current];
    depth += 1;
  }
  return depth;
}

function longestBoneChain(indices: number[], parents: number[], warnings: ConversionWarning[], detail: string): number[] {
  const available = new Set(indices);
  const roots = indices.filter((index) => !available.has(parents[index])).sort((a, b) => boneDepth(a, parents) - boneDepth(b, parents));
  const start = roots[0] ?? indices.slice().sort((a, b) => boneDepth(a, parents) - boneDepth(b, parents))[0];
  if (start === undefined) return [];
  const visit = (index: number): number[] => {
    const children = indices.filter((candidate) => parents[candidate] === index).sort((a, b) => boneDepth(a, parents) - boneDepth(b, parents));
    if (children.length > 1) addWarning(warnings, '分岐した剛体グラフを最長のボーンチェーンへ分割しました', detail);
    let best: number[] = [];
    for (const child of children) {
      const candidate = visit(child);
      if (candidate.length > best.length) best = candidate;
    }
    return [index, ...best];
  };
  return visit(start);
}

function maxRotationSpring(constraints: PmxConstraint[]): number {
  let maximum = 0;
  for (const constraint of constraints) {
    for (const value of constraint.springRotation) maximum = Math.max(maximum, Math.abs(value));
  }
  return maximum;
}

function makeSpringJointSettings(
  bodies: DynamicBodyItem[],
  constraints: PmxConstraint[],
): { hitRadius: number; stiffness: number; gravityPower: number; gravityDir: Vec3; dragForce: number } {
  const body = bodies[0]?.body;
  const rotationSpring = maxRotationSpring(constraints);
  // VRM uses a scalar linear restoring force while PMX stores a rotational
  // spring per axis. Use the strongest PMX axis and convert its Bullet-like
  // coefficient to the meter-space force expected by VRMSpringBone. This is
  // deliberately monotonic: the 10/50/100 coefficients used by mobuko must
  // remain distinguishable instead of being replaced by damping.
  const stiffness = rotationSpring > 0
    ? clamp(Math.sqrt(rotationSpring) * 0.5, 0.25, 6)
    : clamp(0.25 + (body?.rotationDamping ?? 0.5) * 0.2, 0.25, 0.75);
  const hitRadius = bodies.reduce((maximum, item) => Math.max(maximum, colliderHitRadius(item.body)), 0.01);
  const mass = bodies.reduce((maximum, item) => Math.max(maximum, item.body.mass), 0);
  const dragForce = bodies.reduce((sum, item) => sum + clamp(item.body.positionDamping, 0, 1), 0) / Math.max(1, bodies.length);
  return {
    hitRadius: Math.max(0.0001, hitRadius),
    stiffness,
    // PMX has a scene-wide gravity rather than a per-joint gravity setting.
    // Preserve the existing conservative scale so the portable VRM does not
    // immediately collapse while still making heavier PMX bodies respond.
    gravityPower: clamp(mass * 0.05, 0, 1),
    gravityDir: [0, -1, 0],
    dragForce: clamp(dragForce, 0, 1),
  };
}

interface DynamicBodyItem {
  body: PmxRigidBody;
  index: number;
  bone: number;
  type: number;
}

function makeSpringBoneExtension(
  model: PmxModel,
  nodes: GltfJsonObject[],
  boneNodes: number[],
  parents: number[],
  layout: BoneLayout,
  colliderResult: ColliderBuildResult,
  mapping: HumanMapping,
  warnings: ConversionWarning[],
): { extension?: GltfJsonObject; springCount: number } {
  const bodyTypes = normalizedRigidBodyTypes(model, parents);
  const dynamicBodies: DynamicBodyItem[] = model.rigidBodies
    .map((body, index) => ({ body, index, bone: rigidBodyBoneIndex(body, model), type: bodyTypes[index] }))
    .filter((item): item is DynamicBodyItem => item.type !== 0 && item.bone !== undefined);

  const adjacency = new Map<number, Set<number>>();
  for (const item of dynamicBodies) adjacency.set(item.index, new Set());
  for (const constraint of model.constraints) {
    const left = adjacency.get(constraint.rigidBodyIndex1);
    const right = adjacency.get(constraint.rigidBodyIndex2);
    if (left && right) {
      left.add(constraint.rigidBodyIndex2);
      right.add(constraint.rigidBodyIndex1);
    }
  }
  const byBody = new Map(dynamicBodies.map((item) => [item.index, item]));
  const seen = new Set<number>();
  const components: number[][] = [];
  const visit = (bodyIndex: number, component: number[]): void => {
    if (seen.has(bodyIndex)) return;
    seen.add(bodyIndex);
    component.push(bodyIndex);
    for (const neighbor of adjacency.get(bodyIndex) ?? []) visit(neighbor, component);
  };
  for (const item of dynamicBodies) {
    if (!seen.has(item.index)) {
      const component: number[] = [];
      visit(item.index, component);
      components.push(component);
    }
  }

  const allGroups = [...colliderResult.groups.keys()].sort((a, b) => a - b);
  const colliderGroups = allGroups.map((groupIndex) => ({ name: `${sourceFormatLabel(model)} Group ${groupIndex}`, colliders: colliderResult.groups.get(groupIndex) ?? [] }));
  const colliderGroupIndices = new Map(allGroups.map((groupIndex, index) => [groupIndex, index]));
  if (dynamicBodies.length === 0) {
    return {
      extension: { specVersion: '1.0', colliders: colliderResult.colliders, colliderGroups, springs: [] },
      springCount: 0,
    };
  }
  const springBones: GltfJsonObject[] = [];
  const hipsNode = mapping.roleToBone.get('hips');
  if (model.constraints.length > 0) {
    addWarning(warnings, `${sourceFormatLabel(model)}ジョイントの移動・回転制限はVRM SpringBoneのチェーン構造と近似パラメータへ変換しました`);
  }
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex];
    const boneIndices = [...new Set(component.map((bodyIndex) => byBody.get(bodyIndex)?.bone).filter((value): value is number => value !== undefined))];
    let orderedBones = longestBoneChain(boneIndices, parents, warnings, byBody.get(component[0])?.body.name || `component_${componentIndex + 1}`);
    if (orderedBones.length === 0) {
      const item = byBody.get(component[0]);
      if (item) addWarning(warnings, '接続剛体から有効なボーンチェーンを作れないため、スプリングを省略しました', item.body.name || item.body.englishName);
      continue;
    }
    const springBodies = component
      .map((bodyIndex) => byBody.get(bodyIndex))
      .filter((item): item is DynamicBodyItem => item !== undefined);
    const componentSet = new Set(component);
    const componentConstraints = model.constraints.filter((constraint) => componentSet.has(constraint.rigidBodyIndex1)
      || componentSet.has(constraint.rigidBodyIndex2));
    const allowedColliderGroups = allGroups.filter((groupIndex) => {
      const candidateBodies = colliderResult.groupBodies.get(groupIndex) ?? [];
      return candidateBodies.some((colliderBody) => springBodies.some((springBody) => rigidBodyGroupsCanCollide(springBody.body, colliderBody)));
    });
    const springColliderGroups = allowedColliderGroups
      .map((groupIndex) => colliderGroupIndices.get(groupIndex))
      .filter((index): index is number => index !== undefined);
    const joints = orderedBones.map((boneIndex) => {
      const bodiesForBone = springBodies.filter((item) => item.bone === boneIndex);
      const bodyIndices = new Set(bodiesForBone.map((item) => item.index));
      const constraintsForBone = componentConstraints.filter((constraint) => bodyIndices.has(constraint.rigidBodyIndex1)
        || bodyIndices.has(constraint.rigidBodyIndex2));
      const settings = makeSpringJointSettings(bodiesForBone, constraintsForBone);
      return {
        node: boneNodes[boneIndex],
        ...settings,
      };
    });
    const lastBoneIndex = orderedBones[orderedBones.length - 1];
    const tailBoneIndex = findSpringTailBone(model, lastBoneIndex, parents);
    const tailNode = tailBoneIndex !== undefined
      ? boneNodes[tailBoneIndex]
      : addSyntheticSpringTail(model, nodes, boneNodes, parents, layout, lastBoneIndex);
    const lastJoint = joints[joints.length - 1];
    joints.push({ ...lastJoint, node: tailNode });
    const spring: GltfJsonObject = {
      name: `${sourceFormatLabel(model)} Spring ${componentIndex + 1}`,
      joints,
      colliderGroups: springColliderGroups,
    };
    if (hipsNode !== undefined) spring.center = boneNodes[hipsNode];
    springBones.push(spring);
  }
  if (springBones.length === 0) {
    return {
      extension: { specVersion: '1.0', colliders: colliderResult.colliders, colliderGroups, springs: [] },
      springCount: 0,
    };
  }
  return {
    extension: { specVersion: '1.0', colliders: colliderResult.colliders, colliderGroups, springs: springBones },
    springCount: springBones.length,
  };
}

function addInverseBindMatrices(builder: GltfBuilder, layout: BoneLayout): number {
  const values: number[] = [];
  for (const matrix of layout.originalWorld) values.push(...matrixToArray(matrix.clone().invert()));
  return builder.addFloatAccessor(new Float32Array(values), 'MAT4');
}

export async function convertPmxToVrm(options: ConvertOptions): Promise<ConversionResult> {
  const warnings: ConversionWarning[] = [];
  checkAbort(options.signal);
  progress(options, 0, 'VRM変換を開始');
  const builder = new GltfBuilder('MMD to VRM Converter');
  builder.addExtensionUsed('VRMC_vrm');
  const mapping = chooseHumanoidBones(options.model, warnings);
  progress(options, 0.03, 'VRMボーンを自動割り当て');
  const parents = repairParents(options.model, warnings);
  const bodyTypes = normalizedRigidBodyTypes(options.model, parents);
  const layout = makeBoneLayout(options.model, parents, mapping, warnings);
  const nodes = builder.json.nodes as GltfJsonObject[];
  nodes.push({ name: options.metadata.name?.trim() || options.model.metadata.modelName || 'MMD Model', children: [] });
  const boneNodes: number[] = [];
  const usedNodeNames = new Set<string>();
  usedNodeNames.add(String(nodes[0].name));
  for (let index = 0; index < options.model.bones.length; index += 1) {
    const bone = options.model.bones[index];
    const parent = parents[index];
    const rotation = layout.localRotations[index];
    const node: GltfJsonObject = {
      name: uniqueName(boneDisplayName(bone), usedNodeNames, `bone_${index}`),
      translation: layout.localTranslations[index],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      extras: { mmdBoneIndex: index, pmxBoneIndex: index },
    };
    nodes.push(node);
    boneNodes.push(nodes.length - 1);
    layout.nodeIndices.push(nodes.length - 1);
    if (parent < 0) addNodeChild(nodes, 0, nodes.length - 1);
  }
  // PMX files usually list parents before children, but the format does not
  // require that ordering. Attach child links only after every node exists.
  for (let index = 0; index < options.model.bones.length; index += 1) {
    const parent = parents[index];
    if (parent >= 0) addNodeChild(nodes, boneNodes[parent], boneNodes[index]);
  }

  progress(options, 0.08, 'テクスチャを変換');
  const textureTable = await encodeTextures(options, builder, warnings);
  checkAbort(options.signal);
  progress(options, 0.23, 'マテリアルを作成');
  const materialIndices = makeMaterials(builder, options.model, options, textureTable, warnings);
  const bakedMorphs = bakeMorphs(options.model, warnings);
  progress(options, 0.28, 'メッシュとモーフを作成');
  const meshData = addMesh(builder, options.model, materialIndices, bakedMorphs, warnings);
  const meshNode: GltfJsonObject = { name: 'MMD Mesh', mesh: meshData.mesh, skin: 0 };
  nodes.push(meshNode);
  const meshNodeIndex = nodes.length - 1;
  addNodeChild(nodes, 0, meshNodeIndex);
  const inverseBindAccessor = addInverseBindMatrices(builder, layout);
  const skins = builder.json.skins as GltfJsonObject[];
  skins.push({ name: 'MMD Skin', joints: boneNodes, skeleton: boneNodes[mapping.roleToBone.get('hips') ?? 0], inverseBindMatrices: inverseBindAccessor });
  const expressions = makeExpressionSet(options.model, bakedMorphs, meshNodeIndex, warnings);
  const lookAt = makeLookAt(mapping);
  if (!lookAt) addWarning(warnings, '両目ボーンが見つからないため、LookAtを省略しました');
  const vrmExtension = makeHumanoidExtension(options.model, mapping, options.metadata, meshNodeIndex, expressions, lookAt);
  builder.json.extensions = { ...(builder.json.extensions as GltfJsonObject), VRMC_vrm: vrmExtension };
  const colliderResult = buildColliders(options.model, nodes, boneNodes, layout, bodyTypes, warnings);
  const springResult = makeSpringBoneExtension(options.model, nodes, boneNodes, parents, layout, colliderResult, mapping, warnings);
  if (springResult.extension) {
    builder.addExtensionUsed('VRMC_springBone');
    (builder.json.extensions as GltfJsonObject).VRMC_springBone = springResult.extension;
  }
  if ([...textureTable.encodedByPath.values()].some((encoded) => encoded.mimeType === 'image/webp')) builder.addExtensionUsed('EXT_texture_webp');
  builder.json.extras = {
    converter: 'mmd-to-vrm',
    sourceFormat: options.model.metadata.format,
    source: options.pmxPath,
    scale: PMX_TO_METERS,
    warnings,
  };
  (builder.json.scenes as GltfJsonObject[])[0].nodes = [0];
  progress(options, 0.92, 'VRM GLBを書き出し');
  const bytes = builder.build();
  progress(options, 1, '変換完了');
  const sourceName = options.pmxPath.split('/').pop() ?? 'model.pmd';
  const filename = sourceName.replace(/\.(?:pmd|pmx)$/i, '') + '.vrm';
  return {
    bytes,
    filename,
    warnings,
    stats: {
      vertices: options.model.vertices.length,
      triangles: options.model.faces.length,
      materials: options.model.materials.length,
      bones: options.model.bones.length,
      morphs: bakedMorphs.length,
      springs: springResult.springCount,
      colliders: colliderResult.count,
      textures: options.textureAssets.length,
    },
  };
}
