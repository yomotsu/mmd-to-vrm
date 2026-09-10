import type {
  PmxBone,
  PmxConstraint,
  PmxIk,
  PmxIkLink,
  PmxMaterial,
  PmxModel,
  PmxMorph,
  PmxRigidBody,
  PmxVertex,
  Vec3,
} from './types';

export interface ParseOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
}

class BinaryReader {
  private readonly view: DataView;
  private readonly shiftJis = new TextDecoder('shift_jis');
  private offset = 0;

  public constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  public get position(): number {
    return this.offset;
  }

  public get length(): number {
    return this.view.byteLength;
  }

  private ensure(bytes: number): void {
    if (bytes < 0 || this.offset + bytes > this.view.byteLength) {
      throw new Error(`PMDファイルが途中で終わっています（offset ${this.offset}）`);
    }
  }

  public u8(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  public i8(): number {
    this.ensure(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  public u16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  public i16(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  public u32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public f32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private bytes(count: number): Uint8Array {
    this.ensure(count);
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, count);
    this.offset += count;
    return value;
  }

  public chars(count: number): string {
    return Array.from(this.bytes(count), (value) => String.fromCharCode(value)).join('');
  }

  public fixedText(count: number): string {
    return this.shiftJis.decode(this.bytes(count)).replaceAll('\u0000', '');
  }

  public vec3(): Vec3 {
    return [this.f32(), this.f32(), this.f32()];
  }
}

function checkAbort(options: ParseOptions): void {
  if (options.signal?.aborted) throw new DOMException('変換をキャンセルしました', 'AbortError');
}

function progress(options: ParseOptions, reader: BinaryReader): void {
  options.onProgress?.(Math.min(reader.position / Math.max(reader.length, 1), 1));
  checkAbort(options);
}

interface PmdMaterialData {
  diffuse: [number, number, number, number];
  specular: Vec3;
  shininess: number;
  ambient: Vec3;
  toonIndex: number;
  edgeFlag: number;
  faceCount: number;
  fileName: string;
}

interface PmdBoneData {
  name: string;
  parentIndex: number;
  tailIndex: number;
  type: number;
  ikIndex: number;
  position: Vec3;
}

interface PmdIkData {
  target: number;
  effector: number;
  iteration: number;
  maxAngle: number;
  links: number[];
}

interface PmdMorphData {
  name: string;
  type: number;
  elements: { index: number; position: Vec3 }[];
}

interface PmdRigidBodyData {
  name: string;
  boneIndex: number;
  groupIndex: number;
  groupTarget: number;
  shapeType: number;
  width: number;
  height: number;
  depth: number;
  position: Vec3;
  rotation: Vec3;
  weight: number;
  positionDamping: number;
  rotationDamping: number;
  restitution: number;
  friction: number;
  type: number;
}

interface PmdConstraintData {
  name: string;
  rigidBodyIndex1: number;
  rigidBodyIndex2: number;
  position: Vec3;
  rotation: Vec3;
  translationLower: Vec3;
  translationUpper: Vec3;
  rotationLower: Vec3;
  rotationUpper: Vec3;
  springPosition: Vec3;
  springRotation: Vec3;
}

function addTexture(textures: string[], reference: string): number {
  const existing = textures.indexOf(reference);
  if (existing >= 0) return existing;
  textures.push(reference);
  return textures.length - 1;
}

function normalizeToonReference(toonTextures: string[], toonIndex: number): string {
  if (toonIndex >= 0 && toonIndex < toonTextures.length && toonTextures[toonIndex]) {
    return toonTextures[toonIndex];
  }
  const standardIndex = toonIndex >= 0 ? toonIndex + 1 : 0;
  return `toon${String(standardIndex).padStart(2, '0')}.bmp`;
}

function normalizeMaterials(
  rawMaterials: PmdMaterialData[],
  toonTextures: string[],
  textures: string[],
): PmxMaterial[] {
  return rawMaterials.map((raw, index) => {
    const textureNames = raw.fileName.split('*');
    const mapReference = textureNames[0]?.trim() ?? '';
    const sphereReference = textureNames.slice(1).join('*').trim();
    const toonReference = normalizeToonReference(toonTextures, raw.toonIndex);
    const material: PmxMaterial = {
      name: `material_${index + 1}`,
      englishName: '',
      diffuse: raw.diffuse,
      specular: raw.specular,
      shininess: raw.shininess,
      ambient: raw.ambient,
      // PMD has a boolean edge flag and no explicit double-sided flag. MMD
      // renders translucent PMD materials double-sided, so preserve that
      // behavior in the common PMX-style flag representation.
      flags: (raw.edgeFlag !== 0 ? 0x10 : 0) | (raw.diffuse[3] < 0.999 ? 0x01 : 0),
      edgeColor: [0, 0, 0, 1],
      edgeSize: raw.edgeFlag !== 0 ? 1 : 0,
      textureIndex: mapReference ? addTexture(textures, mapReference) : -1,
      environmentTextureIndex: sphereReference ? addTexture(textures, sphereReference) : -1,
      // PMD uses .sph for multiplication and .spa for addition. Store the
      // same convention as PMX so the existing VRM material conversion can
      // handle both formats.
      environmentFlag: sphereReference.toLowerCase().endsWith('.sph') ? 1 : sphereReference ? 2 : 0,
      // PMD toon references are resolved through the ten-entry toon table.
      // Put the resolved path in the common texture table; standard toon
      // names are recognized later and do not need to be present on disk.
      toonFlag: 0,
      toonIndex: addTexture(textures, toonReference),
      comment: '',
      indexCount: raw.faceCount * 3,
    };
    return material;
  });
}

function normalizeBones(rawBones: PmdBoneData[], englishNames: string[]): PmxBone[] {
  const bones = rawBones.map((raw) => {
    const hasTail = raw.tailIndex >= 0 && raw.tailIndex < rawBones.length;
    const bone: PmxBone = {
      name: raw.name,
      englishName: '',
      position: raw.position,
      parentIndex: raw.parentIndex,
      transformationClass: 0,
      flags: hasTail ? 0x0001 : 0,
    };
    if (hasTail) bone.connectIndex = raw.tailIndex;
    return bone;
  });
  for (let index = 0; index < bones.length; index += 1) {
    bones[index].englishName = englishNames[index] ?? '';
  }
  return bones;
}

function normalizeIks(rawIks: PmdIkData[], bones: PmxBone[]): void {
  for (const raw of rawIks) {
    if (raw.target < 0 || raw.target >= bones.length) continue;
    const links: PmxIkLink[] = raw.links.map((index) => ({ index, hasLimit: false }));
    const ik: PmxIk = {
      effector: raw.effector,
      iteration: raw.iteration,
      // MMDLoader applies this compatibility multiplier to PMD IK limits.
      maxAngle: raw.maxAngle * 4,
      links,
    };
    bones[raw.target].ik = ik;
  }
}

function normalizeMorphs(rawMorphs: PmdMorphData[], englishNames: string[]): PmxMorph[] {
  const base = rawMorphs[0]?.elements ?? [];
  return rawMorphs.slice(1).map((raw, index) => ({
    name: raw.name,
    englishName: englishNames[index] ?? '',
    panel: raw.type,
    // PMD morph entries reference the base morph's vertex list rather than
    // the model's vertex array directly. Convert them to ordinary vertex
    // morphs understood by the shared converter.
    type: 1,
    elements: raw.elements.map((element) => ({
      index: base[element.index]?.index ?? element.index,
      position: element.position,
    })),
  }));
}

function normalizeRigidBodies(rawBodies: PmdRigidBodyData[]): PmxRigidBody[] {
  return rawBodies.map((raw) => ({
    name: raw.name,
    englishName: '',
    boneIndex: raw.boneIndex,
    groupIndex: raw.groupIndex,
    groupTarget: raw.groupTarget,
    shapeType: raw.shapeType,
    width: raw.width,
    height: raw.height,
    depth: raw.depth,
    // PMD rigid-body positions are offsets from their assigned bone. Keep
    // that local offset; the common converter handles it like MMDLoader.
    position: raw.position,
    rotation: raw.rotation,
    mass: raw.weight,
    positionDamping: raw.positionDamping,
    rotationDamping: raw.rotationDamping,
    restitution: raw.restitution,
    friction: raw.friction,
    type: raw.type,
  }));
}

function normalizeConstraints(rawConstraints: PmdConstraintData[]): PmxConstraint[] {
  return rawConstraints.map((raw) => ({
    name: raw.name,
    englishName: '',
    type: 0,
    rigidBodyIndex1: raw.rigidBodyIndex1,
    rigidBodyIndex2: raw.rigidBodyIndex2,
    position: raw.position,
    rotation: raw.rotation,
    translationLower: raw.translationLower,
    translationUpper: raw.translationUpper,
    rotationLower: raw.rotationLower,
    rotationUpper: raw.rotationUpper,
    springPosition: raw.springPosition,
    springRotation: raw.springRotation,
  }));
}

export function parsePmd(buffer: ArrayBuffer, options: ParseOptions = {}): PmxModel {
  const reader = new BinaryReader(buffer);
  if (reader.chars(3) !== 'Pmd') throw new Error('PMDファイルではありません');
  const version = reader.f32();
  if (!Number.isFinite(version)) throw new Error('PMDバージョンが不正です');
  const modelName = reader.fixedText(20);
  const comment = reader.fixedText(256);

  const metadata = {
    format: 'pmd' as const,
    version,
    // PMD strings use Shift-JIS; this field is only retained for the common
    // metadata shape and is not used by the PMX parser.
    encoding: 1,
    additionalUvCount: 0,
    modelName,
    englishModelName: '',
    comment,
    englishComment: '',
    vertexIndexSize: 2,
    textureIndexSize: 4,
    materialIndexSize: 2,
    boneIndexSize: 2,
    morphIndexSize: 2,
    rigidBodyIndexSize: 4,
  };

  const vertices: PmxVertex[] = [];
  const vertexCount = reader.u32();
  for (let index = 0; index < vertexCount; index += 1) {
    const position = reader.vec3();
    const normal = reader.vec3();
    const uv: [number, number] = [reader.f32(), reader.f32()];
    const firstBone = reader.u16();
    const secondBone = reader.u16();
    const firstWeight = reader.u8() / 100;
    const edgeFlag = reader.u8();
    vertices.push({
      position,
      normal,
      uv,
      additionalUvs: [],
      deformType: 1,
      boneIndices: [firstBone, secondBone],
      boneWeights: [firstWeight, 1 - firstWeight],
      edgeRatio: edgeFlag === 0 ? 0 : 1,
    });
    if (index % 4096 === 0) progress(options, reader);
  }

  const faces: [number, number, number][] = [];
  const faceIndexCount = reader.u32();
  if (faceIndexCount % 3 !== 0) throw new Error('PMDの面インデックス数が3の倍数ではありません');
  for (let index = 0; index < faceIndexCount; index += 3) {
    faces.push([reader.u16(), reader.u16(), reader.u16()]);
    if (index % 16384 === 0) progress(options, reader);
  }

  const rawMaterials: PmdMaterialData[] = [];
  const materialCount = reader.u32();
  for (let index = 0; index < materialCount; index += 1) {
    rawMaterials.push({
      diffuse: [reader.f32(), reader.f32(), reader.f32(), reader.f32()],
      shininess: reader.f32(),
      specular: reader.vec3(),
      ambient: reader.vec3(),
      toonIndex: reader.i8(),
      edgeFlag: reader.u8(),
      faceCount: reader.u32() / 3,
      fileName: reader.fixedText(20),
    });
    if (index % 32 === 0) progress(options, reader);
  }

  const rawBones: PmdBoneData[] = [];
  const boneCount = reader.u16();
  for (let index = 0; index < boneCount; index += 1) {
    rawBones.push({
      name: reader.fixedText(20),
      parentIndex: reader.i16(),
      tailIndex: reader.i16(),
      type: reader.u8(),
      ikIndex: reader.i16(),
      position: reader.vec3(),
    });
    if (index % 128 === 0) progress(options, reader);
  }

  const rawIks: PmdIkData[] = [];
  const ikCount = reader.u16();
  for (let index = 0; index < ikCount; index += 1) {
    const target = reader.u16();
    const effector = reader.u16();
    const linkCount = reader.u8();
    const raw: PmdIkData = {
      target,
      effector,
      iteration: reader.u16(),
      maxAngle: reader.f32(),
      links: [],
    };
    for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) raw.links.push(reader.u16());
    rawIks.push(raw);
  }

  const rawMorphs: PmdMorphData[] = [];
  const morphCount = reader.u16();
  for (let index = 0; index < morphCount; index += 1) {
    const name = reader.fixedText(20);
    const elementCount = reader.u32();
    const raw: PmdMorphData = {
      name,
      type: reader.u8(),
      elements: [],
    };
    raw.elements = Array.from({ length: elementCount }, () => ({
      index: reader.u32(),
      position: reader.vec3(),
    }));
    rawMorphs.push(raw);
  }

  const morphFrameCount = reader.u8();
  for (let index = 0; index < morphFrameCount; index += 1) reader.u16();
  const boneFrameNameCount = reader.u8();
  for (let index = 0; index < boneFrameNameCount; index += 1) reader.fixedText(50);
  const boneFrameCount = reader.u32();
  for (let index = 0; index < boneFrameCount; index += 1) {
    reader.i16();
    reader.u8();
  }

  const englishCompatibility = reader.u8();
  let englishModelName = '';
  let englishComment = '';
  if (englishCompatibility > 0) {
    englishModelName = reader.fixedText(20);
    englishComment = reader.fixedText(256);
  }
  const englishBoneNames: string[] = [];
  const englishMorphNames: string[] = [];
  if (englishCompatibility > 0) {
    for (let index = 0; index < boneCount; index += 1) englishBoneNames.push(reader.fixedText(20));
    for (let index = 0; index < Math.max(0, morphCount - 1); index += 1) englishMorphNames.push(reader.fixedText(20));
  }

  const toonTextures: string[] = [];
  for (let index = 0; index < 10; index += 1) toonTextures.push(reader.fixedText(100));

  const rawRigidBodies: PmdRigidBodyData[] = [];
  const rigidBodyCount = reader.u32();
  for (let index = 0; index < rigidBodyCount; index += 1) {
    rawRigidBodies.push({
      name: reader.fixedText(20),
      boneIndex: reader.i16(),
      groupIndex: reader.u8(),
      groupTarget: reader.u16(),
      shapeType: reader.u8(),
      width: reader.f32(),
      height: reader.f32(),
      depth: reader.f32(),
      position: reader.vec3(),
      rotation: reader.vec3(),
      weight: reader.f32(),
      positionDamping: reader.f32(),
      rotationDamping: reader.f32(),
      restitution: reader.f32(),
      friction: reader.f32(),
      type: reader.u8(),
    });
    if (index % 64 === 0) progress(options, reader);
  }

  const rawConstraints: PmdConstraintData[] = [];
  const constraintCount = reader.u32();
  for (let index = 0; index < constraintCount; index += 1) {
    rawConstraints.push({
      name: reader.fixedText(20),
      rigidBodyIndex1: reader.u32(),
      rigidBodyIndex2: reader.u32(),
      position: reader.vec3(),
      rotation: reader.vec3(),
      translationLower: reader.vec3(),
      translationUpper: reader.vec3(),
      rotationLower: reader.vec3(),
      rotationUpper: reader.vec3(),
      springPosition: reader.vec3(),
      springRotation: reader.vec3(),
    });
    if (index % 64 === 0) progress(options, reader);
  }

  metadata.englishModelName = englishModelName;
  metadata.englishComment = englishComment;
  const bones = normalizeBones(rawBones, englishBoneNames);
  normalizeIks(rawIks, bones);
  const textures: string[] = [];
  const materials = normalizeMaterials(rawMaterials, toonTextures, textures);
  progress(options, reader);
  return {
    metadata,
    vertices,
    faces,
    textures,
    materials,
    bones,
    morphs: normalizeMorphs(rawMorphs, englishMorphNames),
    rigidBodies: normalizeRigidBodies(rawRigidBodies),
    constraints: normalizeConstraints(rawConstraints),
  };
}
