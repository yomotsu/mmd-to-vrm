import { unzipSync } from 'fflate';
import type { AssetFile, PmxModel, TextureAsset, TextureSettings } from './types';

export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'sph', 'spa',
]);

function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function normalizePath(path: string): string {
  let value = path.replaceAll('\\', '/').trim();
  value = value.replace(/^([a-zA-Z]:)?\/+/, '');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function directoryOf(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

function joinPath(directory: string, relative: string): string {
  return normalizePath(directory ? `${directory}/${relative}` : relative);
}

function extensionOf(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1);
}

/**
 * MMD's default toon textures are commonly installed with MMD rather than
 * copied next to each model. They are optional for the converter, so a
 * missing reference to one of these files must not prevent the model from
 * loading.
 */
export function isMmdStandardToonTexture(path: string): boolean {
  return /^toon(?:0[0-9]|10)\.bmp$/i.test(basename(path));
}

function mimeForPath(path: string): string {
  switch (extensionOf(path)) {
    case 'png':
    case 'apng':
    case 'sph':
    case 'spa':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tga':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function isZip(file: File, path: string): boolean {
  return file.type === 'application/zip' || extensionOf(path) === 'zip';
}

function filePath(file: File): string {
  const candidate = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizePath(candidate || file.name);
}

async function unpackZip(file: File, archivePath: string): Promise<AssetFile[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new Error(`ZIPを解凍できません: ${file.name} (${String(error)})`);
  }

  const output: AssetFile[] = [];
  for (const [entryName, entryBytes] of Object.entries(entries)) {
    const path = normalizePath(entryName);
    if (!path || entryName.endsWith('/')) continue;
    if (entryBytes.byteLength === 0) continue;
    output.push({
      path,
      file: new File([entryBytes.buffer.slice(entryBytes.byteOffset, entryBytes.byteOffset + entryBytes.byteLength) as ArrayBuffer], basename(path), { type: mimeForPath(path) }),
    });
  }
  if (output.length === 0) throw new Error(`ZIPにファイルがありません: ${archivePath}`);
  return output;
}

export async function collectAssetFiles(files: File[]): Promise<AssetFile[]> {
  if (files.length === 0) throw new Error('PMD/PMXとテクスチャファイルを選択してください');
  const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (inputBytes > MAX_INPUT_BYTES) {
    throw new Error(`入力ファイルの合計が100MBを超えています（${formatBytes(inputBytes)}）`);
  }

  const output: AssetFile[] = [];
  let expandedBytes = 0;
  for (const file of files) {
    const path = filePath(file);
    if (isZip(file, path)) {
      const unpacked = await unpackZip(file, path);
      for (const entry of unpacked) {
        expandedBytes += entry.file.size;
        if (expandedBytes > MAX_INPUT_BYTES) {
          throw new Error('ZIP展開後のファイル合計が100MBを超えています');
        }
        output.push(entry);
      }
    } else {
      expandedBytes += file.size;
      if (expandedBytes > MAX_INPUT_BYTES) {
        throw new Error('入力ファイルの合計が100MBを超えています');
      }
      output.push({ path, file });
    }
  }

  const seen = new Set<string>();
  for (const asset of output) {
    if (seen.has(asset.path)) throw new Error(`同じパスのファイルが複数あります: ${asset.path}`);
    seen.add(asset.path);
  }
  return output;
}

export function findPmxFile(assets: AssetFile[]): AssetFile {
  const pmx = assets.filter((asset) => extensionOf(asset.path) === 'pmx');
  if (pmx.length === 0) throw new Error('PMXファイルが見つかりません');
  if (pmx.length > 1) throw new Error('PMXファイルは1つだけ入れてください');
  return pmx[0];
}

export function findMmdFile(assets: AssetFile[]): AssetFile {
  const models = assets.filter((asset) => {
    const extension = extensionOf(asset.path);
    return extension === 'pmd' || extension === 'pmx';
  });
  if (models.length === 0) throw new Error('PMDまたはPMXファイルが見つかりません');
  if (models.length > 1) throw new Error('PMD/PMXファイルは1つだけ入れてください');
  return models[0];
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function resolveTextureFile(
  pmxPath: string,
  reference: string,
  assets: AssetFile[],
): AssetFile {
  const normalizedReference = normalizePath(reference);
  if (!normalizedReference) throw new Error('空のテクスチャ参照があります');
  const pmxDirectory = directoryOf(pmxPath);
  const preferredPath = joinPath(pmxDirectory, normalizedReference);
  const exact = assets.find((asset) => samePath(asset.path, preferredPath));
  if (exact) return exact;

  const caseInsensitive = assets.filter((asset) => asset.path.toLowerCase() === preferredPath.toLowerCase());
  if (caseInsensitive.length === 1) return caseInsensitive[0];
  if (caseInsensitive.length > 1) {
    throw new Error(`テクスチャのパスが重複しています: ${reference}`);
  }

  const referenceBase = basename(normalizedReference).toLowerCase();
  const fallback = assets.filter((asset) => basename(asset.path).toLowerCase() === referenceBase);
  if (fallback.length === 1) return fallback[0];
  if (fallback.length > 1) {
    throw new Error(`同名テクスチャが複数あるため特定できません: ${reference}`);
  }
  throw new Error(`参照テクスチャが見つかりません: ${reference}`);
}

interface TextureReference {
  materialIndices: number[];
  required: boolean;
}

function textureReferences(model: PmxModel): Map<string, TextureReference> {
  const references = new Map<string, TextureReference>();
  const add = (index: number, materialIndex: number, required: boolean): void => {
    if (index < 0 || index >= model.textures.length) return;
    const path = model.textures[index];
    const reference = references.get(path) ?? { materialIndices: [], required: false };
    if (!reference.materialIndices.includes(materialIndex)) reference.materialIndices.push(materialIndex);
    reference.required = reference.required || required;
    references.set(path, reference);
  };
  model.materials.forEach((material, index) => {
    add(material.textureIndex, index, true);
    if (material.environmentFlag === 1 || material.environmentFlag === 2) {
      add(material.environmentTextureIndex, index, false);
    }
    if (material.toonFlag === 0) add(material.toonIndex, index, false);
  });
  return references;
}

export function makeTextureAssets(model: PmxModel, pmxPath: string, assets: AssetFile[]): TextureAsset[] {
  const references = textureReferences(model);
  const result: TextureAsset[] = [];
  const byPath = new Map<string, TextureAsset>();
  for (const [reference, referenceInfo] of references) {
    // MMD resolves toon00.bmp〜toon10.bmp to its built-in ramps. The
    // converter uses the corresponding MToon shade color, so these files are
    // neither required nor useful to embed in the VRM.
    if (!referenceInfo.required && isMmdStandardToonTexture(reference)) continue;
    let source: AssetFile;
    try {
      source = resolveTextureFile(pmxPath, reference, assets);
    } catch (error) {
      if (!referenceInfo.required) continue;
      throw error;
    }
    const materialIndices = referenceInfo.materialIndices;
    const existing = byPath.get(source.path);
    if (existing) {
      existing.referencedBy.push(...materialIndices.filter((index) => !existing.referencedBy.includes(index)));
      continue;
    }
    const sourceFormat = extensionOf(source.path);
    const autoFormat: TextureSettings['format'] = sourceFormat === 'jpg' || sourceFormat === 'jpeg'
      ? 'jpeg'
      : sourceFormat === 'webp'
        ? 'webp'
        : 'png';
    const asset: TextureAsset = {
      sourcePath: source.path,
      file: source.file,
      referencedBy: [...materialIndices],
      settings: {
        format: autoFormat,
        width: 0,
        height: 0,
        keepAspectRatio: true,
        quality: 80,
        sourceFormat: sourceFormat || 'unknown',
        autoConverted: autoFormat === 'png' && sourceFormat !== 'png',
      },
    };
    byPath.set(source.path, asset);
    result.push(asset);
  }
  return result;
}

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function checkImageAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('変換をキャンセルしました', 'AbortError');
}

async function imageBitmapToRgba(bitmap: ImageBitmap, signal?: AbortSignal): Promise<DecodedImage> {
  checkImageAbort(signal);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('画像処理用のCanvasを作成できません');
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

async function decodeWithBrowser(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  checkImageAbort(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return imageBitmapToRgba(bitmap, signal);
    } catch {
      // Some browsers do not decode every image extension through ImageBitmap.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`画像を読み込めません: ${file.name}`));
      element.src = url;
    });
    checkImageAbort(signal);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('画像処理用のCanvasを作成できません');
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function readI32(data: Uint8Array, offset: number): number {
  return readU32(data, offset) | 0;
}

function readU32BigEndian(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function containsApng(data: Uint8Array): boolean {
  if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = readU32BigEndian(data, offset);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    if (type === 'acTL') return true;
    offset += 12 + length;
    if (length > data.length || offset > data.length) break;
  }
  return false;
}

function containsAnimatedWebp(data: Uint8Array): boolean {
  if (data.length < 16 || String.fromCharCode(...data.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...data.slice(8, 12)) !== 'WEBP') return false;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const type = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const length = readU32(data, offset + 4);
    if (type === 'ANIM' || type === 'ANMF') return true;
    offset += 8 + length + (length & 1);
    if (length > data.length || offset > data.length) break;
  }
  return false;
}

function decodeBmp(buffer: ArrayBuffer): DecodedImage {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('BMPヘッダーが不正です');
  const pixelOffset = readU32(bytes, 10);
  const dibSize = readU32(bytes, 14);
  if (dibSize < 40) throw new Error('古い形式のBMPには対応していません');
  const width = readI32(bytes, 18);
  const rawHeight = readI32(bytes, 22);
  const height = Math.abs(rawHeight);
  const planes = readU16(bytes, 26);
  const bitsPerPixel = readU16(bytes, 28);
  const compression = readU32(bytes, 30);
  if (width <= 0 || height <= 0 || planes !== 1 || compression !== 0) {
    throw new Error('対応していないBMP形式です（非圧縮の8/24/32bitのみ）');
  }
  if (bitsPerPixel !== 8 && bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error('対応していないBMP色深度です（8/24/32bitのみ）');
  }

  const palette: number[][] = [];
  if (bitsPerPixel === 8) {
    const colorsUsed = readU32(bytes, 46) || 256;
    const paletteOffset = 14 + dibSize;
    for (let i = 0; i < colorsUsed; i += 1) {
      const offset = paletteOffset + i * 4;
      palette.push([bytes[offset + 2], bytes[offset + 1], bytes[offset], 255]);
    }
  }
  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = rawHeight > 0 ? height - 1 - y : y;
    const rowOffset = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      if (bitsPerPixel === 8) {
        const color = palette[bytes[rowOffset + x]] ?? [255, 0, 255, 255];
        output.set(color, destination);
      } else {
        const source = rowOffset + x * (bitsPerPixel / 8);
        output[destination] = bytes[source + 2];
        output[destination + 1] = bytes[source + 1];
        output[destination + 2] = bytes[source];
        output[destination + 3] = bitsPerPixel === 32 ? bytes[source + 3] : 255;
      }
    }
  }
  return { width, height, data: output };
}

function decodeTga(buffer: ArrayBuffer): DecodedImage {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 18) throw new Error('TGAヘッダーが不正です');
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const width = readU16(bytes, 12);
  const height = readU16(bytes, 14);
  const bitsPerPixel = bytes[16];
  const descriptor = bytes[17];
  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 3 && imageType !== 10 && imageType !== 11)) {
    throw new Error('対応していないTGA形式です');
  }
  if (![8, 16, 24, 32].includes(bitsPerPixel) || width === 0 || height === 0) {
    throw new Error('対応していないTGA色深度です');
  }
  const bytesPerPixel = Math.ceil(bitsPerPixel / 8);
  let offset = 18 + idLength;
  const pixelCount = width * height;
  const output = new Uint8ClampedArray(pixelCount * 4);
  let outputPixel = 0;
  const writePixel = (pixel: number[]): void => {
    const sourceX = outputPixel % width;
    const sourceY = Math.floor(outputPixel / width);
    const x = (descriptor & 0x10) !== 0 ? width - 1 - sourceX : sourceX;
    const y = (descriptor & 0x20) !== 0 ? sourceY : height - 1 - sourceY;
    const destination = (y * width + x) * 4;
    output.set(pixel, destination);
    outputPixel += 1;
  };
  const readPixel = (): number[] => {
    if (offset + bytesPerPixel > bytes.length) throw new Error('TGAのピクセルデータが不足しています');
    if (bitsPerPixel === 8) {
      return [bytes[offset], bytes[offset], bytes[offset], 255];
    }
    if (bitsPerPixel === 16) {
      const value = readU16(bytes, offset);
      return [
        Math.round(((value >> 10) & 0x1f) * 255 / 31),
        Math.round(((value >> 5) & 0x1f) * 255 / 31),
        Math.round((value & 0x1f) * 255 / 31),
        (value & 0x8000) !== 0 ? 255 : 0,
      ];
    }
    return [bytes[offset + 2], bytes[offset + 1], bytes[offset], bitsPerPixel === 32 ? bytes[offset + 3] : 255];
  };
  while (outputPixel < pixelCount) {
    if (imageType === 10 || imageType === 11) {
      if (offset >= bytes.length) throw new Error('TGAのRLEデータが不足しています');
      const packet = bytes[offset++];
      const count = (packet & 0x7f) + 1;
      if ((packet & 0x80) !== 0) {
        const pixel = readPixel();
        offset += bytesPerPixel;
        for (let i = 0; i < count && outputPixel < pixelCount; i += 1) writePixel(pixel);
      } else {
        for (let i = 0; i < count && outputPixel < pixelCount; i += 1) {
          const pixel = readPixel();
          offset += bytesPerPixel;
          writePixel(pixel);
        }
      }
    } else {
      const pixel = readPixel();
      offset += bytesPerPixel;
      writePixel(pixel);
    }
  }
  return { width, height, data: output };
}

async function decodeRawImage(file: File, signal?: AbortSignal, sourceBytes?: Uint8Array): Promise<DecodedImage> {
  const buffer = sourceBytes
    ? sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer
    : await file.arrayBuffer();
  const bytes = sourceBytes ?? new Uint8Array(buffer);
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return decodeBmp(buffer);
  if (extensionOf(file.name) === 'tga' || (bytes[1] === 0x00 && (bytes[2] === 0x02 || bytes[2] === 0x0a) && bytes[16] >= 8)) {
    return decodeTga(buffer);
  }
  return decodeWithBrowser(file, signal);
}

export async function decodeTexture(asset: TextureAsset, signal?: AbortSignal): Promise<DecodedImage> {
  checkImageAbort(signal);
  const sourceBytes = new Uint8Array(await asset.file.arrayBuffer());
  checkImageAbort(signal);
  if (containsApng(sourceBytes) || containsAnimatedWebp(sourceBytes)) asset.settings.autoConverted = true;
  const decoded = await decodeRawImage(asset.file, signal, sourceBytes);
  if (asset.settings.width === 0 || asset.settings.height === 0) {
    asset.settings.width = decoded.width;
    asset.settings.height = decoded.height;
  }
  return decoded;
}

function canvasFromImage(image: DecodedImage, width: number, height: number, jpeg = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像処理用のCanvasを作成できません');
  if (jpeg) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('画像処理用のCanvasを作成できません');
  const imageData = new ImageData(image.width, image.height);
  imageData.data.set(image.data);
  sourceContext.putImageData(imageData, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`画像を${type}へ変換できません`));
    }, type, quality / 100);
  });
}

export interface EncodedTexture {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  extension: 'png' | 'jpg' | 'webp';
}

function outputMime(format: TextureSettings['format']): EncodedTexture['mimeType'] {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

export async function encodeTexture(
  asset: TextureAsset,
  decoded: DecodedImage,
  signal?: AbortSignal,
): Promise<EncodedTexture> {
  checkImageAbort(signal);
  const width = Math.max(1, Math.min(Math.floor(asset.settings.width), decoded.width));
  const height = Math.max(1, Math.min(Math.floor(asset.settings.height), decoded.height));
  const format = asset.settings.format;
  const unchanged = width === decoded.width && height === decoded.height && !asset.settings.autoConverted;
  if (unchanged && ((format === 'png' && asset.settings.sourceFormat === 'png')
    || (format === 'jpeg' && (asset.settings.sourceFormat === 'jpg' || asset.settings.sourceFormat === 'jpeg'))
    || (format === 'webp' && asset.settings.sourceFormat === 'webp'))) {
    return {
      bytes: new Uint8Array(await asset.file.arrayBuffer()),
      mimeType: outputMime(format),
      width,
      height,
      extension: format === 'jpeg' ? 'jpg' : format,
    };
  }

  const canvas = canvasFromImage(decoded, width, height, format === 'jpeg');
  const blob = await canvasBlob(canvas, outputMime(format), asset.settings.quality);
  checkImageAbort(signal);
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: outputMime(format),
    width,
    height,
    extension: format === 'jpeg' ? 'jpg' : format,
  };
}

export async function makeThumbnail(_asset: TextureAsset, decoded: DecodedImage): Promise<string> {
  const scale = Math.min(1, 160 / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = canvasFromImage(decoded, width, height);
  return canvas.toDataURL('image/png');
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
