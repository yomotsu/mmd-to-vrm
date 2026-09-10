import type {
  PmxBone,
  PmxConstraint,
  PmxIk,
  PmxIkLink,
  PmxMaterial,
  PmxModel,
  PmxMorph,
  PmxMorphElement,
  PmxRigidBody,
  PmxVertex,
  Vec3,
  Vec4,
} from './types';

export interface ParseOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
}

class BinaryReader {
  private readonly view: DataView;
  private readonly utf8 = new TextDecoder('utf-8');
  private readonly utf16 = new TextDecoder('utf-16le');
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

  public ensure(bytes: number): void {
    if (bytes < 0 || this.offset + bytes > this.view.byteLength) {
      throw new Error(`PMXファイルが途中で終わっています（offset ${this.offset}）`);
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

  public i32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public f32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public bytes(count: number): Uint8Array {
    this.ensure(count);
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, count);
    this.offset += count;
    return value;
  }

  public chars(count: number): string {
    return Array.from(this.bytes(count), (value) => String.fromCharCode(value)).join('');
  }

  public vec2(): [number, number] {
    return [this.f32(), this.f32()];
  }

  public vec3(): Vec3 {
    return [this.f32(), this.f32(), this.f32()];
  }

  public vec4(): Vec4 {
    return [this.f32(), this.f32(), this.f32(), this.f32()];
  }

  public readIndex(size: number, unsigned = false): number {
    switch (size) {
      case 1:
        return unsigned ? this.u8() : this.i8();
      case 2:
        return unsigned ? this.u16() : this.i16();
      case 4:
        return unsigned ? this.u32() : this.i32();
      default:
        throw new Error(`PMXのインデックスサイズが不正です: ${size}`);
    }
  }

  public text(encoding: number): string {
    const byteLength = this.u32();
    const bytes = this.bytes(byteLength);
    const value = (encoding === 0 ? this.utf16 : this.utf8).decode(bytes);
    return value.replaceAll('\u0000', '');
  }
}

function checkAbort(options: ParseOptions): void {
  if (options.signal?.aborted) {
    throw new DOMException('変換をキャンセルしました', 'AbortError');
  }
}

function progress(options: ParseOptions, reader: BinaryReader): void {
  options.onProgress?.(Math.min(reader.position / Math.max(reader.length, 1), 1));
  checkAbort(options);
}

function parseVertex(reader: BinaryReader, model: PmxModel): PmxVertex {
  const position = reader.vec3();
  const normal = reader.vec3();
  const uv = reader.vec2();
  const additionalUvs: Vec4[] = [];
  for (let i = 0; i < model.metadata.additionalUvCount; i += 1) {
    additionalUvs.push(reader.vec4());
  }

  const deformType = reader.u8();
  let boneIndices: number[];
  let boneWeights: number[];
  let sdef: PmxVertex['sdef'];

  switch (deformType) {
    case 0:
      boneIndices = [reader.readIndex(model.metadata.boneIndexSize)];
      boneWeights = [1];
      break;
    case 1: {
      boneIndices = [
        reader.readIndex(model.metadata.boneIndexSize),
        reader.readIndex(model.metadata.boneIndexSize),
      ];
      const weight = reader.f32();
      boneWeights = [weight, 1 - weight];
      break;
    }
    case 2:
      boneIndices = Array.from({ length: 4 }, () => reader.readIndex(model.metadata.boneIndexSize));
      boneWeights = Array.from({ length: 4 }, () => reader.f32());
      break;
    case 3: {
      boneIndices = [
        reader.readIndex(model.metadata.boneIndexSize),
        reader.readIndex(model.metadata.boneIndexSize),
      ];
      const weight = reader.f32();
      boneWeights = [weight, 1 - weight];
      sdef = { c: reader.vec3(), r0: reader.vec3(), r1: reader.vec3() };
      break;
    }
    case 4:
      throw new Error('QDEF（変形タイプ4）はこの変換器では対応していません');
    default:
      throw new Error(`未知のPMX変形タイプです: ${deformType}`);
  }

  return {
    position,
    normal,
    uv,
    additionalUvs,
    deformType,
    boneIndices,
    boneWeights,
    sdef,
    edgeRatio: reader.f32(),
  };
}

function parseMaterial(reader: BinaryReader, model: PmxModel): PmxMaterial {
  const name = reader.text(model.metadata.encoding);
  const englishName = reader.text(model.metadata.encoding);
  const diffuse = reader.vec4();
  const specular = reader.vec3();
  const shininess = reader.f32();
  const ambient = reader.vec3();
  const flags = reader.u8();
  const edgeColor = reader.vec4();
  const edgeSize = reader.f32();
  const textureIndex = reader.readIndex(model.metadata.textureIndexSize);
  const environmentTextureIndex = reader.readIndex(model.metadata.textureIndexSize);
  const environmentFlag = reader.u8();
  const toonFlag = reader.u8();
  const toonIndex = toonFlag === 0 ? reader.readIndex(model.metadata.textureIndexSize) : reader.i8();
  const comment = reader.text(model.metadata.encoding);
  const indexCount = reader.u32();
  return {
    name,
    englishName,
    diffuse,
    specular,
    shininess,
    ambient,
    flags,
    edgeColor,
    edgeSize,
    textureIndex,
    environmentTextureIndex,
    environmentFlag,
    toonFlag,
    toonIndex,
    comment,
    indexCount,
  };
}

function parseBone(reader: BinaryReader, model: PmxModel): PmxBone {
  const name = reader.text(model.metadata.encoding);
  const englishName = reader.text(model.metadata.encoding);
  const position = reader.vec3();
  const parentIndex = reader.readIndex(model.metadata.boneIndexSize);
  const transformationClass = reader.u32();
  const flags = reader.u16();
  const bone: PmxBone = { name, englishName, position, parentIndex, transformationClass, flags };

  if ((flags & 0x0001) !== 0) {
    bone.connectIndex = reader.readIndex(model.metadata.boneIndexSize);
  } else {
    bone.offsetPosition = reader.vec3();
  }
  if ((flags & 0x0100) !== 0 || (flags & 0x0200) !== 0) {
    bone.grant = {
      isLocal: (flags & 0x0080) !== 0,
      affectRotation: (flags & 0x0100) !== 0,
      affectPosition: (flags & 0x0200) !== 0,
      parentIndex: reader.readIndex(model.metadata.boneIndexSize),
      ratio: reader.f32(),
    };
  }
  if ((flags & 0x0400) !== 0) bone.fixAxis = reader.vec3();
  if ((flags & 0x0800) !== 0) {
    bone.localXVector = reader.vec3();
    bone.localZVector = reader.vec3();
  }
  if ((flags & 0x2000) !== 0) bone.externalParentKey = reader.u32();
  if ((flags & 0x0020) !== 0) {
    const ik: PmxIk = {
      effector: reader.readIndex(model.metadata.boneIndexSize),
      iteration: reader.u32(),
      maxAngle: reader.f32(),
      links: [],
    };
    const linkCount = reader.u32();
    for (let i = 0; i < linkCount; i += 1) {
      const link: PmxIkLink = {
        index: reader.readIndex(model.metadata.boneIndexSize),
        hasLimit: reader.u8() === 1,
      };
      if (link.hasLimit) {
        link.lower = reader.vec3();
        link.upper = reader.vec3();
      }
      ik.links.push(link);
    }
    bone.ik = ik;
  }
  return bone;
}

function parseMorph(reader: BinaryReader, model: PmxModel): PmxMorph {
  const morph: PmxMorph = {
    name: reader.text(model.metadata.encoding),
    englishName: reader.text(model.metadata.encoding),
    panel: reader.u8(),
    type: reader.u8(),
    elements: [],
  };
  const count = reader.u32();
  for (let i = 0; i < count; i += 1) {
    const element: PmxMorphElement = { index: 0 };
    switch (morph.type) {
      case 0:
        element.index = reader.readIndex(model.metadata.morphIndexSize);
        element.ratio = reader.f32();
        break;
      case 1:
        element.index = reader.readIndex(model.metadata.vertexIndexSize, true);
        element.position = reader.vec3();
        break;
      case 2:
        element.index = reader.readIndex(model.metadata.boneIndexSize);
        element.position = reader.vec3();
        element.rotation = reader.vec4();
        break;
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
        element.index = reader.readIndex(model.metadata.vertexIndexSize, true);
        element.uv = reader.vec4();
        break;
      case 8:
        element.index = reader.readIndex(model.metadata.materialIndexSize);
        element.materialType = reader.u8();
        element.diffuse = reader.vec4();
        element.specular = reader.vec3();
        element.shininess = reader.f32();
        element.ambient = reader.vec3();
        element.edgeColor = reader.vec4();
        element.edgeSize = reader.f32();
        element.textureColor = reader.vec4();
        element.sphereTextureColor = reader.vec4();
        element.toonColor = reader.vec4();
        break;
      default:
        throw new Error(`未知のPMXモーフタイプです: ${morph.type}`);
    }
    morph.elements.push(element);
  }
  return morph;
}

function parseRigidBody(reader: BinaryReader, model: PmxModel): PmxRigidBody {
  return {
    name: reader.text(model.metadata.encoding),
    englishName: reader.text(model.metadata.encoding),
    boneIndex: reader.readIndex(model.metadata.boneIndexSize),
    groupIndex: reader.u8(),
    groupTarget: reader.u16(),
    shapeType: reader.u8(),
    width: reader.f32(),
    height: reader.f32(),
    depth: reader.f32(),
    position: reader.vec3(),
    rotation: reader.vec3(),
    mass: reader.f32(),
    positionDamping: reader.f32(),
    rotationDamping: reader.f32(),
    restitution: reader.f32(),
    friction: reader.f32(),
    type: reader.u8(),
  };
}

function parseConstraint(reader: BinaryReader, model: PmxModel): PmxConstraint {
  return {
    name: reader.text(model.metadata.encoding),
    englishName: reader.text(model.metadata.encoding),
    type: reader.u8(),
    rigidBodyIndex1: reader.readIndex(model.metadata.rigidBodyIndexSize),
    rigidBodyIndex2: reader.readIndex(model.metadata.rigidBodyIndexSize),
    position: reader.vec3(),
    rotation: reader.vec3(),
    translationLower: reader.vec3(),
    translationUpper: reader.vec3(),
    rotationLower: reader.vec3(),
    rotationUpper: reader.vec3(),
    springPosition: reader.vec3(),
    springRotation: reader.vec3(),
  };
}

export function parsePmx(buffer: ArrayBuffer, options: ParseOptions = {}): PmxModel {
  const reader = new BinaryReader(buffer);
  const magic = reader.chars(4);
  if (magic !== 'PMX ') throw new Error('PMXファイルではありません');
  const version = reader.f32();
  if (version !== 2 && version !== 2.1) {
    throw new Error(`PMXバージョン${version}には対応していません（2.0/2.1のみ）`);
  }
  const headerSize = reader.u8();
  if (headerSize < 8) throw new Error('PMXヘッダーサイズが不正です');
  const encoding = reader.u8();
  const additionalUvCount = reader.u8();
  const metadata = {
    format: 'pmx' as const,
    version,
    encoding,
    additionalUvCount,
    modelName: '',
    englishModelName: '',
    comment: '',
    englishComment: '',
    vertexIndexSize: reader.u8(),
    textureIndexSize: reader.u8(),
    materialIndexSize: reader.u8(),
    boneIndexSize: reader.u8(),
    morphIndexSize: reader.u8(),
    rigidBodyIndexSize: reader.u8(),
  };
  if (headerSize > 8) reader.bytes(headerSize - 8);
  metadata.modelName = reader.text(encoding);
  metadata.englishModelName = reader.text(encoding);
  metadata.comment = reader.text(encoding);
  metadata.englishComment = reader.text(encoding);

  const model: PmxModel = {
    metadata,
    vertices: [],
    faces: [],
    textures: [],
    materials: [],
    bones: [],
    morphs: [],
    rigidBodies: [],
    constraints: [],
  };

  const vertexCount = reader.u32();
  for (let i = 0; i < vertexCount; i += 1) {
    model.vertices.push(parseVertex(reader, model));
    if (i % 4096 === 0) progress(options, reader);
  }

  const faceIndexCount = reader.u32();
  if (faceIndexCount % 3 !== 0) throw new Error('PMXの面インデックス数が3の倍数ではありません');
  for (let i = 0; i < faceIndexCount; i += 3) {
    const a = reader.readIndex(metadata.vertexIndexSize, true);
    const b = reader.readIndex(metadata.vertexIndexSize, true);
    const c = reader.readIndex(metadata.vertexIndexSize, true);
    model.faces.push([a, b, c]);
    if (i % 16384 === 0) progress(options, reader);
  }

  const textureCount = reader.u32();
  for (let i = 0; i < textureCount; i += 1) {
    model.textures.push(reader.text(encoding));
    if (i % 128 === 0) progress(options, reader);
  }

  const materialCount = reader.u32();
  for (let i = 0; i < materialCount; i += 1) {
    model.materials.push(parseMaterial(reader, model));
    if (i % 32 === 0) progress(options, reader);
  }

  const boneCount = reader.u32();
  for (let i = 0; i < boneCount; i += 1) {
    model.bones.push(parseBone(reader, model));
    if (i % 128 === 0) progress(options, reader);
  }

  const morphCount = reader.u32();
  for (let i = 0; i < morphCount; i += 1) {
    model.morphs.push(parseMorph(reader, model));
    if (i % 64 === 0) progress(options, reader);
  }

  const frameCount = reader.u32();
  for (let i = 0; i < frameCount; i += 1) {
    reader.text(encoding);
    reader.text(encoding);
    reader.u8();
    const elementCount = reader.u32();
    for (let j = 0; j < elementCount; j += 1) {
      const target = reader.u8();
      reader.readIndex(target === 0 ? metadata.boneIndexSize : metadata.morphIndexSize);
    }
  }

  const rigidBodyCount = reader.u32();
  for (let i = 0; i < rigidBodyCount; i += 1) {
    model.rigidBodies.push(parseRigidBody(reader, model));
    if (i % 64 === 0) progress(options, reader);
  }

  const constraintCount = reader.u32();
  for (let i = 0; i < constraintCount; i += 1) {
    model.constraints.push(parseConstraint(reader, model));
    if (i % 64 === 0) progress(options, reader);
  }

  progress(options, reader);
  return model;
}
