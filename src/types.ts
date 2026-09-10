export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type MmdFormat = 'pmd' | 'pmx';

export interface PmxVertex {
  position: Vec3;
  normal: Vec3;
  uv: Vec2;
  additionalUvs: Vec4[];
  deformType: number;
  boneIndices: number[];
  boneWeights: number[];
  sdef?: {
    c: Vec3;
    r0: Vec3;
    r1: Vec3;
  };
  edgeRatio: number;
}

export interface PmxMaterial {
  name: string;
  englishName: string;
  diffuse: Vec4;
  specular: Vec3;
  shininess: number;
  ambient: Vec3;
  flags: number;
  edgeColor: Vec4;
  edgeSize: number;
  textureIndex: number;
  environmentTextureIndex: number;
  environmentFlag: number;
  toonFlag: number;
  toonIndex: number;
  comment: string;
  indexCount: number;
}

export interface PmxBoneGrant {
  isLocal: boolean;
  affectRotation: boolean;
  affectPosition: boolean;
  parentIndex: number;
  ratio: number;
}

export interface PmxIkLink {
  index: number;
  hasLimit: boolean;
  lower?: Vec3;
  upper?: Vec3;
}

export interface PmxIk {
  effector: number;
  iteration: number;
  maxAngle: number;
  links: PmxIkLink[];
}

export interface PmxBone {
  name: string;
  englishName: string;
  position: Vec3;
  parentIndex: number;
  transformationClass: number;
  flags: number;
  connectIndex?: number;
  offsetPosition?: Vec3;
  grant?: PmxBoneGrant;
  fixAxis?: Vec3;
  localXVector?: Vec3;
  localZVector?: Vec3;
  externalParentKey?: number;
  ik?: PmxIk;
}

export interface PmxMorphElement {
  index: number;
  ratio?: number;
  position?: Vec3;
  uv?: Vec4;
  rotation?: Vec4;
  materialType?: number;
  diffuse?: Vec4;
  specular?: Vec3;
  shininess?: number;
  ambient?: Vec3;
  edgeColor?: Vec4;
  edgeSize?: number;
  textureColor?: Vec4;
  sphereTextureColor?: Vec4;
  toonColor?: Vec4;
}

export interface PmxMorph {
  name: string;
  englishName: string;
  panel: number;
  type: number;
  elements: PmxMorphElement[];
}

export interface PmxRigidBody {
  name: string;
  englishName: string;
  boneIndex: number;
  groupIndex: number;
  groupTarget: number;
  shapeType: number;
  width: number;
  height: number;
  depth: number;
  position: Vec3;
  rotation: Vec3;
  mass: number;
  positionDamping: number;
  rotationDamping: number;
  restitution: number;
  friction: number;
  type: number;
}

export interface PmxConstraint {
  name: string;
  englishName: string;
  type: number;
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

export interface PmxModel {
  metadata: {
    format: MmdFormat;
    version: number;
    encoding: number;
    additionalUvCount: number;
    modelName: string;
    englishModelName: string;
    comment: string;
    englishComment: string;
    vertexIndexSize: number;
    textureIndexSize: number;
    materialIndexSize: number;
    boneIndexSize: number;
    morphIndexSize: number;
    rigidBodyIndexSize: number;
  };
  vertices: PmxVertex[];
  faces: [number, number, number][];
  textures: string[];
  materials: PmxMaterial[];
  bones: PmxBone[];
  morphs: PmxMorph[];
  rigidBodies: PmxRigidBody[];
  constraints: PmxConstraint[];
}

export interface AssetFile {
  path: string;
  file: File;
}

export interface TextureSettings {
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  keepAspectRatio: boolean;
  quality: number;
  sourceFormat: string;
  autoConverted: boolean;
}

export interface TextureAsset {
  sourcePath: string;
  file: File;
  settings: TextureSettings;
  referencedBy: number[];
  thumbnailUrl?: string;
}

export interface ModelMetadata {
  name?: string;
  version?: string;
  authors?: string;
  copyrightInformation?: string;
  contactInformation?: string;
  references?: string;
  thirdPartyLicenses?: string;
}

export interface ConversionWarning {
  message: string;
  detail?: string;
}

export interface ConversionResult {
  bytes: Uint8Array;
  filename: string;
  warnings: ConversionWarning[];
  stats: {
    vertices: number;
    triangles: number;
    materials: number;
    bones: number;
    morphs: number;
    springs: number;
    colliders: number;
    textures: number;
  };
}

export interface ConversionProgress {
  phase: string;
  value: number;
}
