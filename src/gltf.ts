export type GltfJsonObject = Record<string, unknown>;

type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
type ComponentType = 5121 | 5123 | 5125 | 5126;

function asBytes(data: Uint8Array | ArrayBufferView): Uint8Array {
  return data instanceof Uint8Array
    ? data
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function componentCount(type: AccessorType): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT2': return 4;
    case 'MAT3': return 9;
    case 'MAT4': return 16;
  }
}

function paddedLength(length: number): number {
  return (length + 3) & ~3;
}

export class GltfBuilder {
  public readonly json: GltfJsonObject;
  private readonly binaryChunks: { offset: number; bytes: Uint8Array }[] = [];
  private binaryLength = 0;

  public constructor(generator: string) {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      skins: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [],
      extensionsUsed: [],
      extensions: {},
    };
  }

  public addBinary(data: Uint8Array | ArrayBufferView, target?: number): number {
    const bytes = asBytes(data);
    const alignedOffset = paddedLength(this.binaryLength);
    this.binaryLength = alignedOffset;
    const index = (this.json.bufferViews as GltfJsonObject[]).length;
    const view: GltfJsonObject = {
      buffer: 0,
      byteOffset: alignedOffset,
      byteLength: bytes.byteLength,
    };
    if (target !== undefined) view.target = target;
    (this.json.bufferViews as GltfJsonObject[]).push(view);
    this.binaryChunks.push({ offset: alignedOffset, bytes });
    this.binaryLength += bytes.byteLength;
    return index;
  }

  public addAccessor(
    data: Uint8Array | ArrayBufferView,
    componentType: ComponentType,
    type: AccessorType,
    count: number,
    options: { target?: number; normalized?: boolean; min?: number[]; max?: number[] } = {},
  ): number {
    const bufferView = this.addBinary(data, options.target);
    const accessor: GltfJsonObject = { bufferView, componentType, count, type };
    if (options.normalized) accessor.normalized = true;
    if (options.min) accessor.min = options.min;
    if (options.max) accessor.max = options.max;
    (this.json.accessors as GltfJsonObject[]).push(accessor);
    return (this.json.accessors as GltfJsonObject[]).length - 1;
  }

  public addFloatAccessor(
    values: Float32Array,
    type: AccessorType,
    options: { target?: number; min?: number[]; max?: number[] } = {},
  ): number {
    const size = componentCount(type);
    const count = values.length / size;
    if (!Number.isInteger(count)) throw new Error(`アクセサーの要素数が不正です: ${type}`);
    const min = options.min ?? [];
    const max = options.max ?? [];
    if (!options.min || !options.max) {
      for (let i = 0; i < size; i += 1) {
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (let j = i; j < values.length; j += size) {
          low = Math.min(low, values[j]);
          high = Math.max(high, values[j]);
        }
        min[i] = low;
        max[i] = high;
      }
    }
    return this.addAccessor(values, 5126, type, count, { ...options, min, max });
  }

  public addImage(bytes: Uint8Array, mimeType: string, name: string): number {
    const bufferView = this.addBinary(bytes);
    const image: GltfJsonObject = { bufferView, mimeType, name };
    (this.json.images as GltfJsonObject[]).push(image);
    return (this.json.images as GltfJsonObject[]).length - 1;
  }

  public addTexture(source: number): number {
    const textures = this.json.textures as GltfJsonObject[];
    const existing = textures.findIndex((texture) => texture.source === source);
    if (existing >= 0) return existing;
    textures.push({ sampler: this.addSampler(), source });
    return textures.length - 1;
  }

  public addSampler(): number {
    const samplers = this.json.samplers as GltfJsonObject[];
    if (samplers.length > 0) return 0;
    samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    return 0;
  }

  public addExtensionUsed(name: string): void {
    const extensionsUsed = this.json.extensionsUsed as string[];
    if (!extensionsUsed.includes(name)) extensionsUsed.push(name);
  }

  public build(): Uint8Array {
    const json = this.json;
    json.buffers = [{ byteLength: paddedLength(this.binaryLength) }];
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonChunkLength = paddedLength(jsonBytes.byteLength);
    const binChunkLength = paddedLength(this.binaryLength);
    const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
    const output = new Uint8Array(totalLength);
    const view = new DataView(output.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, jsonChunkLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    output.set(jsonBytes, 20);
    output.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonChunkLength);
    const binHeader = 20 + jsonChunkLength;
    view.setUint32(binHeader, binChunkLength, true);
    view.setUint32(binHeader + 4, 0x004e4942, true);
    for (const chunk of this.binaryChunks) output.set(chunk.bytes, binHeader + 8 + chunk.offset);
    return output;
  }
}

export function minMaxVec(values: number[], size: number): { min: number[]; max: number[] } {
  const min = Array.from({ length: size }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: size }, () => Number.NEGATIVE_INFINITY);
  for (let i = 0; i < values.length; i += size) {
    for (let j = 0; j < size; j += 1) {
      min[j] = Math.min(min[j], values[i + j]);
      max[j] = Math.max(max[j], values[i + j]);
    }
  }
  return { min, max };
}
