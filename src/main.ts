import './style.css';
import {
  collectAssetFiles,
  decodeTexture,
  findMmdFile,
  makeThumbnail,
  makeTextureAssets,
} from './assets';
import { convertPmxToVrm } from './converter';
import { parsePmd } from './pmd';
import { parsePmx } from './pmx';
import { createPreviewController, type VrmPreviewMaterialMode } from './preview';
import { validateVrm } from './validate';
import type { AssetFile, ConversionResult, ModelMetadata, PmxModel, TextureAsset } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('アプリケーションのルートが見つかりません');

app.innerHTML = `
  <main class="mx-auto w-[calc(100%-40px)] max-w-[1180px] py-32 pb-32 sm:w-[calc(100%-20px)] sm:max-w-[560px] sm:pt-32">
    <header class="mb-32">
      <div>
        <h1 class="mb-8 text-32 font-bold leading-display tracking-display text-teal-300">MMD →&nbsp;&nbsp;VRM Converter</h1>
        <p class="mb-0 max-w-[620px] text-12 text-slate-100">PMD / PMXとテクスチャをまとめて読み込み、ブラウザ内だけでVRMを生成します。</p>
      </div>
    </header>

    <section class="mt-16 rounded-sm border border-sky-200/12 bg-slate-800 p-24 shadow-panel sm:p-16">
      <div class="mb-16">
        <div>
          <p class="mb-4 font-mono text-12 font-medium tracking-kicker text-teal-300">STEP 01</p>
          <h2 class="mb-0 text-24 tracking-section">PMD / PMXとテクスチャを読み込む</h2>
        </div>
      </div>
      <div id="dropZone" class="grid min-h-128 place-items-center gap-4 rounded-sm border border-dashed border-teal-300/38 p-24 text-center text-slate-50 outline-none transition duration-150 hover:border-teal-300/60 hover:bg-teal-700/50 hover:shadow-drop-hover focus-visible:border-teal-300/60 focus-visible:bg-teal-700/50 focus-visible:shadow-drop-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" tabindex="0" role="button" aria-label="PMD / PMXとテクスチャをドロップ">
        <div class="grid h-[46px] w-[46px] place-items-center rounded-full border border-teal-300/45 bg-teal-300/8 text-24 leading-none text-teal-300">↓</div>
        <strong class="text-16 font-semibold">PMD / PMX・テクスチャ・ZIPをここへドロップ</strong>
        <span class="text-12 text-slate-200">フォルダごとのドロップにも対応</span>
      </div>
      <div class="mt-16 flex flex-wrap gap-8">
        <div id="filePicker" class="relative">
          <button id="filePickerButton" class="inline-flex min-h-32 cursor-pointer items-center justify-center rounded-[2px] border border-sky-200/20 bg-slate-300 px-16 py-8 font-mono text-12 font-medium tracking-action text-slate-100 no-underline transition duration-150 hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none" type="button" aria-haspopup="menu" aria-expanded="false">ファイル / フォルダを選択</button>
          <div id="filePickerMenu" class="absolute left-0 top-full z-10 mt-4 grid min-w-full gap-2 rounded-[2px] border border-sky-200/20 bg-slate-700 p-4 shadow-panel" role="menu" hidden>
            <button id="filePickerFilesButton" class="whitespace-nowrap rounded-[2px] px-8 py-8 text-left font-mono text-12 text-slate-50 hover:bg-teal-300/30" type="button" role="menuitem">ファイルを選択</button>
            <button id="filePickerFolderButton" class="whitespace-nowrap rounded-[2px] px-8 py-8 text-left font-mono text-12 text-slate-50 hover:bg-teal-300/30" type="button" role="menuitem">フォルダを選択</button>
          </div>
        </div>
        <input id="fileInput" class="sr-only" type="file" multiple accept=".pmd,.pmx,.zip,.png,.apng,.jpg,.jpeg,.webp,.gif,.bmp,.tga,.sph,.spa" />
        <input id="folderInput" class="sr-only" type="file" multiple webkitdirectory directory />
        <button id="clearButton" class="inline-flex min-h-32 cursor-pointer items-center justify-center rounded-[2px] border border-transparent bg-transparent px-16 py-8 font-mono text-12 font-medium tracking-action text-slate-200 no-underline transition duration-150 hover:-translate-y-px hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none" type="button">クリア</button>
      </div>
      <div id="fileSummary" class="mt-16 [overflow-wrap:anywhere] font-mono text-12 text-slate-200">まだファイルが読み込まれていません。</div>
      <div id="inputError" class="mt-16 rounded-[2px] border border-orange-300/35 bg-orange-300/8 px-16 py-8 text-12 text-orange-300" hidden></div>
    </section>

    <section class="mt-16 rounded-sm border border-sky-200/12 bg-slate-800 p-24 shadow-panel sm:p-16">
      <div class="mb-16">
        <div>
          <p class="mb-4 font-mono text-12 font-medium tracking-kicker text-teal-300">STEP 02</p>
          <h2 class="mb-0 text-24 tracking-section">テクスチャ設定</h2>
        </div>
      </div>
      <div id="textureList" class="grid gap-8">
        <div class="rounded-[2px] border border-dashed border-sky-200/12 p-24 text-center font-mono text-12 text-slate-200">PMD / PMXを読み込むと、参照されているテクスチャだけが表示されます。</div>
      </div>
    </section>

    <section class="mt-16 rounded-sm border border-sky-200/12 bg-slate-800 p-24 shadow-panel sm:p-16">
      <details class="group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-16 outline-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">
          <div>
            <p class="mb-4 font-mono text-12 font-medium tracking-kicker text-teal-300">STEP 03</p>
            <h2 class="mb-0 text-24 tracking-section">VRMメタデータ <span class="text-12 font-medium text-slate-200">任意</span></h2>
          </div>
          <span class="shrink-0 font-mono text-12 text-slate-200"><span class="group-open:hidden">開く</span><span class="hidden group-open:inline">閉じる</span></span>
        </summary>
        <div class="mt-16 grid grid-cols-2 gap-16 sm:grid-cols-1">
          <label class="grid gap-4"><span class="font-mono text-12 tracking-action text-slate-200">モデル名</span><input id="metaName" class="w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" type="text" placeholder="PMD / PMXのモデル名を使用" /></label>
          <label class="grid gap-4"><span class="font-mono text-12 tracking-action text-slate-200">作者</span><input id="metaAuthors" class="w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" type="text" placeholder="不明" /></label>
          <label class="grid gap-4"><span class="font-mono text-12 tracking-action text-slate-200">著作権</span><input id="metaCopyright" class="w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" type="text" /></label>
          <label class="grid gap-4"><span class="font-mono text-12 tracking-action text-slate-200">連絡先</span><input id="metaContact" class="w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" type="text" /></label>
          <label class="grid gap-4"><span class="font-mono text-12 tracking-action text-slate-200">参考作品・URL</span><input id="metaReferences" class="w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" type="text" /></label>
          <label class="col-span-full grid gap-4 sm:col-auto"><span class="font-mono text-12 tracking-action text-slate-200">第三者ライセンス</span><textarea id="metaThirdParty" class="w-full resize-y rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-8 text-slate-50 outline-none focus:border-teal-300" rows="2"></textarea></label>
        </div>
      </details>
    </section>

    <section class="mt-16 rounded-sm border border-sky-200/12 bg-slate-800 p-24 shadow-panel sm:p-16">
      <div class="mb-16">
        <div>
        <p class="mb-4 font-mono text-12 font-medium tracking-kicker text-teal-300">STEP 04</p>
          <h2 class="mb-0 text-24 tracking-section">変換</h2>
        </div>
      </div>
      <div class="mt-16 flex flex-wrap gap-8">
        <button id="convertButton" class="inline-flex min-h-32 cursor-pointer items-center justify-center rounded-[2px] border border-teal-300/70 bg-teal-300 px-16 py-8 font-mono text-12 font-medium tracking-action text-teal-950 shadow-teal-300-glow transition duration-150 enabled:hover:-translate-y-px enabled:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:border-slate-200/12 disabled:bg-slate-700 disabled:text-slate-200 disabled:opacity-50 disabled:grayscale disabled:shadow-none disabled:transform-none" type="button" disabled>VRMへ変換</button>
        <a id="downloadButton" class="pointer-events-none inline-flex min-h-32 cursor-not-allowed items-center justify-center rounded-[2px] border border-slate-200/12 bg-slate-700 px-16 py-8 font-mono text-12 font-medium tracking-action text-slate-200 opacity-50 grayscale no-underline shadow-none transition duration-150 hover:-translate-y-px hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" aria-disabled="true">VRMをダウンロード</a>
        <button id="cancelButton" class="rounded-[2px] bg-transparent px-8 py-4 font-mono text-12 text-orange-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" type="button" hidden>キャンセル</button>
      </div>
      <div id="stats" class="mt-16 flex flex-wrap gap-8" hidden></div>
      <div id="warningBox" class="mt-16 rounded-[2px] border border-amber-300/30 bg-amber-300/8 px-16 py-16 text-12 text-amber-300" hidden></div>
    </section>

    <section class="mt-16 rounded-sm border border-sky-200/12 bg-slate-800 p-24 shadow-panel sm:p-16">
      <div class="mb-16 flex items-center justify-between gap-16 sm:flex-col sm:items-start">
        <div>
        <p class="mb-4 font-mono text-12 font-medium tracking-kicker text-teal-300">STEP 05</p>
          <h2 class="mb-0 text-24 tracking-section">比較プレビュー</h2>
        </div>
        <span class="text-12 text-slate-200">MMD / VRMを左右に表示 · 同じカメラ・ライト・トーンマップで比較<br />左ドラッグ 回転 / ホイール ズーム / 右ドラッグ パン</span>
      </div>
      <div class="grid grid-cols-2 gap-16 sm:grid-cols-1">
        <article class="min-w-0 overflow-hidden rounded-[2px] border border-sky-200/12 bg-slate-950">
          <div class="flex items-baseline justify-between gap-8 border-b border-sky-200/12 px-16 py-8"><strong class="font-mono text-12 font-medium tracking-heading text-slate-50">MMD</strong><span id="mmdPreviewStatus" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10 text-slate-200">PMD / PMXを読み込むと表示します。</span></div>
          <div class="h-40 border-b border-sky-200/12 bg-slate-500 px-8 py-8" aria-hidden="true"></div>
          <div class="h-[390px] sm:h-[340px]"><canvas id="mmdPreviewCanvas" class="block h-full w-full cursor-grab active:cursor-grabbing" aria-label="MMDモデルプレビュー"></canvas></div>
        </article>
        <article class="min-w-0 overflow-hidden rounded-[2px] border border-sky-200/12 bg-slate-950">
          <div class="flex items-baseline justify-between gap-8 border-b border-sky-200/12 px-16 py-8"><strong class="font-mono text-12 font-medium tracking-heading text-slate-50">VRM 1.0</strong><span id="vrmPreviewStatus" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10 text-slate-200">変換後に表示します。</span></div>
          <div class="flex h-40 flex-wrap items-center gap-x-8 gap-y-4 border-b border-sky-200/12 bg-slate-500 px-8 py-8" role="group" aria-label="VRMプレビューマテリアル">
            <span class="mr-4 font-mono text-10 tracking-chip text-slate-200">表示マテリアル</span>
            <label class="has-[:checked]:border-teal-300/30 has-[:checked]:bg-teal-300/8 has-[:checked]:text-teal-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 inline-flex cursor-pointer items-center gap-4 border border-transparent px-4 py-4 font-mono text-10 text-slate-200"><input class="m-0 accent-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" type="radio" name="vrm-preview-material" value="mtoon" disabled /><span>MToon</span></label>
            <label class="has-[:checked]:border-teal-300/30 has-[:checked]:bg-teal-300/8 has-[:checked]:text-teal-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 inline-flex cursor-pointer items-center gap-4 border border-transparent px-4 py-4 font-mono text-10 text-slate-200"><input class="m-0 accent-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" type="radio" name="vrm-preview-material" value="mtoon-unlit" disabled /><span>MToon Unlit</span></label>
            <label class="has-[:checked]:border-teal-300/30 has-[:checked]:bg-teal-300/8 has-[:checked]:text-teal-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 inline-flex cursor-pointer items-center gap-4 border border-transparent px-4 py-4 font-mono text-10 text-slate-200"><input class="m-0 accent-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" type="radio" name="vrm-preview-material" value="mmdtoon" disabled /><span>MMDToon</span></label>
            <label class="has-[:checked]:border-teal-300/30 has-[:checked]:bg-teal-300/8 has-[:checked]:text-teal-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 inline-flex cursor-pointer items-center gap-4 border border-transparent px-4 py-4 font-mono text-10 text-slate-200"><input class="m-0 accent-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300" type="radio" name="vrm-preview-material" value="pbr" disabled /><span>PBR</span></label>
          </div>
          <div class="h-[390px] sm:h-[340px]"><canvas id="vrmPreviewCanvas" class="block h-full w-full cursor-grab active:cursor-grabbing" aria-label="VRMモデルプレビュー"></canvas></div>
        </article>
      </div>
    </section>

  </main>
`;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`UI要素が見つかりません: ${id}`);
  return element as T;
}

const dropZone = byId<HTMLDivElement>('dropZone');
const filePicker = byId<HTMLDivElement>('filePicker');
const filePickerButton = byId<HTMLButtonElement>('filePickerButton');
const filePickerMenu = byId<HTMLDivElement>('filePickerMenu');
const filePickerFilesButton = byId<HTMLButtonElement>('filePickerFilesButton');
const filePickerFolderButton = byId<HTMLButtonElement>('filePickerFolderButton');
const fileInput = byId<HTMLInputElement>('fileInput');
const folderInput = byId<HTMLInputElement>('folderInput');
const clearButton = byId<HTMLButtonElement>('clearButton');
const fileSummary = byId<HTMLDivElement>('fileSummary');
const inputError = byId<HTMLDivElement>('inputError');
const textureList = byId<HTMLDivElement>('textureList');
const convertButton = byId<HTMLButtonElement>('convertButton');
const downloadButton = byId<HTMLAnchorElement>('downloadButton');
const cancelButton = byId<HTMLButtonElement>('cancelButton');
const stats = byId<HTMLDivElement>('stats');
const warningBox = byId<HTMLDivElement>('warningBox');
const mmdPreviewCanvas = byId<HTMLCanvasElement>('mmdPreviewCanvas');
const vrmPreviewCanvas = byId<HTMLCanvasElement>('vrmPreviewCanvas');
const mmdPreviewStatus = byId<HTMLSpanElement>('mmdPreviewStatus');
const vrmPreviewStatus = byId<HTMLSpanElement>('vrmPreviewStatus');
const vrmPreviewMaterialInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="vrm-preview-material"]'));

function selectedVrmPreviewMaterialMode(): VrmPreviewMaterialMode {
  const value = vrmPreviewMaterialInputs.find((input) => input.checked)?.value;
  return value === 'mtoon' || value === 'mtoon-unlit' || value === 'mmdtoon' || value === 'pbr' ? value : 'mtoon';
}

const statusToneClasses: Record<'muted' | 'success' | 'error', string> = {
  muted: 'text-slate-200',
  success: 'text-lime-300',
  error: 'text-orange-300',
};
const previewStatusBaseClasses = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10';
const downloadEnabledClasses = [
  'pointer-events-auto',
  'cursor-pointer',
  'border-lime-300/45',
  'bg-lime-300',
  'text-lime-950',
  'shadow-lime-300-glow',
];
const downloadDisabledClasses = [
  'pointer-events-none',
  'cursor-not-allowed',
  'border-slate-200/12',
  'bg-slate-700',
  'text-slate-200',
  'opacity-50',
  'grayscale',
  'shadow-none',
];
const dropZoneDraggingClasses = [
  'border-teal-300/60',
  'bg-teal-700/50',
  'shadow-drop-hover',
];

let previewController: ReturnType<typeof createPreviewController> | null = null;
try {
  previewController = createPreviewController(mmdPreviewCanvas, vrmPreviewCanvas);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  mmdPreviewStatus.textContent = `プレビューを開始できません: ${message}`;
  vrmPreviewStatus.textContent = 'プレビューを開始できません。';
  mmdPreviewStatus.className = `${previewStatusBaseClasses} ${statusToneClasses.error}`;
  vrmPreviewStatus.className = `${previewStatusBaseClasses} ${statusToneClasses.error}`;
}

let assetFiles: AssetFile[] = [];
let modelAsset: AssetFile | undefined;
let model: PmxModel | undefined;
let textureAssets: TextureAsset[] = [];
let downloadUrl: string | undefined;
let loadSerial = 0;
let conversionController: AbortController | undefined;
let vrmConversionCompleted = false;
const originalTextureSizes = new Map<string, { width: number; height: number }>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character));
}

function setPreviewStatus(element: HTMLElement, message: string, kind: 'muted' | 'success' | 'error' = 'muted'): void {
  element.textContent = message;
  element.className = `${previewStatusBaseClasses} ${statusToneClasses[kind]}`;
}

function updateVrmPreviewMaterialControls(busy: boolean): void {
  const enabled = !busy && vrmConversionCompleted;
  if (!enabled) {
    vrmPreviewMaterialInputs.forEach((input) => {
      input.disabled = true;
      input.checked = false;
    });
    return;
  }
  const selected = vrmPreviewMaterialInputs.find((input) => input.checked)
    ?? vrmPreviewMaterialInputs.find((input) => input.value === 'mtoon')
    ?? vrmPreviewMaterialInputs[0];
  vrmPreviewMaterialInputs.forEach((input) => {
    input.disabled = false;
    input.checked = input === selected;
  });
}

function setBusy(busy: boolean): void {
  convertButton.disabled = busy || !model;
  cancelButton.hidden = !busy;
  clearButton.disabled = busy;
  filePickerButton.disabled = busy;
  fileInput.disabled = busy;
  folderInput.disabled = busy;
  updateVrmPreviewMaterialControls(busy);
}

function clearDownload(): void {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  downloadButton.removeAttribute('href');
  downloadButton.removeAttribute('download');
  setDownloadLabel();
  downloadButton.classList.remove(...downloadEnabledClasses);
  downloadButton.classList.add(...downloadDisabledClasses);
  downloadButton.setAttribute('aria-disabled', 'true');
}

function setInputError(message = ''): void {
  inputError.textContent = message;
  inputError.hidden = !message;
}

function formatDownloadSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))}KB`;
}

function setDownloadLabel(size?: string): void {
  downloadButton.textContent = 'VRMをダウンロード';
  if (!size) return;

  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'text-10';
  sizeLabel.textContent = `（${size}）`;
  downloadButton.append(sizeLabel);
}

function resetOutput(): void {
  clearDownload();
  warningBox.hidden = true;
  warningBox.innerHTML = '';
  stats.hidden = true;
  stats.innerHTML = '';
}

function renderWarnings(messages: ConversionResult['warnings']): void {
  if (messages.length === 0) {
    warningBox.hidden = true;
    warningBox.innerHTML = '';
    return;
  }
  warningBox.hidden = false;
  warningBox.innerHTML = `<details class="group"><summary class="flex cursor-pointer list-none items-center justify-between gap-16 outline-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"><strong>変換時の注意 (${messages.length})</strong><span class="shrink-0 font-mono text-12"><span class="group-open:hidden">開く</span><span class="hidden group-open:inline">閉じる</span></span></summary><ul class="mt-8 pl-16">${messages.map((warning) => `<li class="my-4">${escapeHtml(warning.message)}${warning.detail ? `<small class="block text-slate-200">${escapeHtml(warning.detail)}</small>` : ''}</li>`).join('')}</ul></details>`;
}

function renderStats(result: ConversionResult): void {
  stats.hidden = false;
  stats.innerHTML = [
    ['頂点', result.stats.vertices], ['三角形', result.stats.triangles], ['マテリアル', result.stats.materials],
    ['ボーン', result.stats.bones], ['表情', result.stats.morphs], ['スプリング', result.stats.springs],
    ['コライダー', result.stats.colliders], ['テクスチャ', result.stats.textures],
  ].map(([label, value]) => `<span class="inline-flex items-baseline gap-4 rounded-[2px] bg-slate-700 px-8 py-8 font-mono text-10 text-slate-200"><b class="text-14 text-slate-50">${value}</b>${label}</span>`).join('');
}

function sourceLabel(asset: TextureAsset): string {
  const source = asset.settings.sourceFormat.toUpperCase();
  return asset.settings.autoConverted ? `${source} → PNG` : source;
}

function shouldDisableSquareHeight(asset: TextureAsset): boolean {
  return asset.settings.keepAspectRatio && asset.settings.width === asset.settings.height;
}

function renderTextureList(): void {
  if (textureAssets.length === 0) {
    textureList.innerHTML = '<div class="rounded-[2px] border border-dashed border-sky-200/12 p-24 text-center font-mono text-12 text-slate-200">参照されているテクスチャはありません。</div>';
    return;
  }
  textureList.innerHTML = textureAssets.map((asset, index) => {
    const original = originalTextureSizes.get(asset.sourcePath) ?? { width: asset.settings.width, height: asset.settings.height };
    const thumbnail = asset.thumbnailUrl ?? '';
    return `<article class="grid grid-cols-[58px_minmax(190px,1fr)_104px_80px_80px_auto] items-center gap-8 rounded-[2px] border border-sky-200/12 bg-slate-600 p-8 max-[900px]:grid-cols-[58px_minmax(160px,1fr)_100px_78px_78px_auto] sm:grid-cols-[52px_1fr_1fr] sm:gap-8" data-texture-index="${index}">
      <div class="grid h-[58px] w-[58px] place-items-center overflow-hidden rounded-[2px] bg-slate-950 text-slate-200 sm:h-[52px] sm:w-[52px]">${thumbnail ? `<img class="h-full w-full object-contain" src="${thumbnail}" alt="">` : '<span>?</span>'}</div>
      <div class="min-w-0 sm:col-span-2"><strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-12" title="${escapeHtml(asset.sourcePath)}">${escapeHtml(asset.sourcePath)}</strong><span class="mt-4 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-12 text-slate-200">元サイズ ${original.width} × ${original.height} / ${sourceLabel(asset)}</span></div>
      <label class="grid gap-4"><span class="font-mono text-10 text-slate-200">形式<span data-texture-quality class="ml-2 ${asset.settings.format === 'png' ? 'hidden' : ''}">（品質 ${asset.settings.quality}）</span></span><select class="min-h-32 w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-4 text-slate-50 outline-none focus:border-teal-300" data-texture-field="format"><option value="png" ${asset.settings.format === 'png' ? 'selected' : ''}>PNG</option><option value="webp" ${asset.settings.format === 'webp' ? 'selected' : ''}>WebP</option><option value="jpeg" ${asset.settings.format === 'jpeg' ? 'selected' : ''}>JPG</option></select></label>
      <label class="grid gap-4"><span class="font-mono text-10 text-slate-200">幅</span><input class="min-h-32 w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-4 text-right text-slate-50 outline-none focus:border-teal-300" data-texture-field="width" type="number" min="1" max="${original.width}" step="1" value="${asset.settings.width}" /></label>
      <label class="grid gap-4"><span class="font-mono text-10 text-slate-200">高さ</span><input class="min-h-32 w-full rounded-[2px] border border-sky-200/20 bg-slate-400 px-8 py-4 text-right text-slate-50 outline-none focus:border-teal-300 disabled:cursor-not-allowed disabled:border-slate-200/12 disabled:bg-slate-700 disabled:text-slate-200 disabled:opacity-50" data-texture-field="height" type="number" min="1" max="${original.height}" step="1" value="${asset.settings.height}" ${shouldDisableSquareHeight(asset) ? 'disabled' : ''} /></label>
      <label class="grid grid-cols-[16px_auto] items-center gap-4 whitespace-nowrap sm:col-span-1"><input class="accent-teal-500" data-texture-field="keepAspectRatio" type="checkbox" ${asset.settings.keepAspectRatio ? 'checked' : ''} /><span class="font-mono text-10 text-slate-200">比率維持</span></label>
    </article>`;
  }).join('');
}

function refreshTextureRow(row: HTMLElement, asset: TextureAsset): void {
  const width = row.querySelector<HTMLInputElement>('[data-texture-field="width"]');
  const height = row.querySelector<HTMLInputElement>('[data-texture-field="height"]');
  const ratio = row.querySelector<HTMLInputElement>('[data-texture-field="keepAspectRatio"]');
  const quality = row.querySelector<HTMLElement>('[data-texture-quality]');
  if (width) width.value = String(asset.settings.width);
  if (height) {
    height.value = String(asset.settings.height);
    height.disabled = shouldDisableSquareHeight(asset);
  }
  if (ratio) ratio.checked = asset.settings.keepAspectRatio;
  if (quality) {
    quality.textContent = `（品質 ${asset.settings.quality}）`;
    quality.classList.toggle('hidden', asset.settings.format === 'png');
  }
}

function updateTextureSetting(target: EventTarget | null): void {
  const element = target instanceof HTMLElement ? target : null;
  const row = element?.closest<HTMLElement>('[data-texture-index]');
  if (!row) return;
  const index = Number(row.dataset.textureIndex);
  const asset = textureAssets[index];
  if (!asset) return;
  const field = element?.dataset.textureField;
  if (!field) return;
  const original = originalTextureSizes.get(asset.sourcePath) ?? { width: asset.settings.width, height: asset.settings.height };
  if (field === 'format' && element instanceof HTMLSelectElement) {
    asset.settings.format = element.value as TextureAsset['settings']['format'];
  } else if (field === 'keepAspectRatio' && element instanceof HTMLInputElement) {
    asset.settings.keepAspectRatio = element.checked;
    if (asset.settings.keepAspectRatio) {
      asset.settings.height = Math.max(1, Math.min(original.height, Math.round(asset.settings.width * original.height / original.width)));
    }
  } else if ((field === 'width' || field === 'height') && element instanceof HTMLInputElement) {
    const entered = Math.max(1, Math.min(Number(element.value) || 1, field === 'width' ? original.width : original.height));
    if (field === 'width') {
      asset.settings.width = Math.floor(entered);
      if (asset.settings.keepAspectRatio) asset.settings.height = Math.max(1, Math.min(original.height, Math.round(asset.settings.width * original.height / original.width)));
    } else {
      asset.settings.height = Math.floor(entered);
      if (asset.settings.keepAspectRatio) asset.settings.width = Math.max(1, Math.min(original.width, Math.round(asset.settings.height * original.width / original.height)));
    }
  }
  refreshTextureRow(row, asset);
}

function metadata(): ModelMetadata {
  return {
    name: byId<HTMLInputElement>('metaName').value,
    authors: byId<HTMLInputElement>('metaAuthors').value,
    copyrightInformation: byId<HTMLInputElement>('metaCopyright').value,
    contactInformation: byId<HTMLInputElement>('metaContact').value,
    references: byId<HTMLInputElement>('metaReferences').value,
    thirdPartyLicenses: byId<HTMLTextAreaElement>('metaThirdParty').value,
  };
}

function clonedFileWithPath(file: File, path: string): File {
  const clone = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(clone, 'webkitRelativePath', { configurable: true, value: path });
  return clone;
}

interface DropFileEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader: () => { readEntries: (success: (entries: DropFileEntry[]) => void, error?: (error: DOMException) => void) => void };
}

async function readDropEntry(entry: DropFileEntry, parentPath: string): Promise<File[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [clonedFileWithPath(file, path)];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const entries: DropFileEntry[] = [];
  while (true) {
    const batch = await new Promise<DropFileEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map((child) => readDropEntry(child, path)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  // DataTransfer's file items are only readable while the drop event is
  // active. Snapshot every entry before awaiting the recursive directory
  // reads; otherwise, when a file and a directory are dropped together, the
  // later item can disappear before it is inspected.
  const sources: Array<{ entry: DropFileEntry } | { file: File }> = [];
  for (const item of Array.from(dataTransfer.items)) {
    const candidate = item as unknown as { webkitGetAsEntry?: () => DropFileEntry | null };
    const entry = candidate.webkitGetAsEntry?.();
    if (entry) {
      sources.push({ entry });
    } else {
      const file = item.getAsFile();
      if (file) sources.push({ file });
    }
  }
  const batches = await Promise.all(sources.map((source) => (
    'entry' in source ? readDropEntry(source.entry, '') : Promise.resolve([source.file])
  )));
  return batches.flat();
}

async function loadFiles(files: File[]): Promise<void> {
  const serial = ++loadSerial;
  conversionController?.abort();
  const controller = new AbortController();
  conversionController = controller;
  vrmConversionCompleted = false;
  setBusy(true);
  setInputError();
  resetOutput();
  model = undefined;
  modelAsset = undefined;
  textureAssets = [];
  assetFiles = [];
  originalTextureSizes.clear();
  previewController?.clearMmd();
  previewController?.clearVrm();
  setPreviewStatus(mmdPreviewStatus, 'PMD / PMXを読み込むと表示します。');
  setPreviewStatus(vrmPreviewStatus, '変換後に表示します。');
  renderTextureList();
  try {
    const collected = await collectAssetFiles(files);
    if (controller.signal.aborted) return;
    if (serial !== loadSerial) return;
    assetFiles = collected;
    modelAsset = findMmdFile(collected);
    const isPmd = /\.pmd$/i.test(modelAsset.path);
    const formatLabel = isPmd ? 'PMD' : 'PMX';
    const modelBytes = await modelAsset.file.arrayBuffer();
    model = isPmd
      ? parsePmd(modelBytes, { signal: controller.signal })
      : parsePmx(modelBytes, { signal: controller.signal });
    textureAssets = makeTextureAssets(model, modelAsset.path, collected);
    for (let index = 0; index < textureAssets.length; index += 1) {
      const asset = textureAssets[index];
      const decoded = await decodeTexture(asset, controller.signal);
      originalTextureSizes.set(asset.sourcePath, { width: decoded.width, height: decoded.height });
      asset.settings.width = decoded.width;
      asset.settings.height = decoded.height;
      asset.thumbnailUrl = await makeThumbnail(asset, decoded);
    }
    if (controller.signal.aborted) return;
    if (serial !== loadSerial) return;
    renderTextureList();
    fileSummary.textContent = `${modelAsset.path} / ファイル×${collected.length} / 参照テクスチャ×${textureAssets.length}`;
    if (previewController && modelAsset) {
      setPreviewStatus(mmdPreviewStatus, 'MMDプレビューを読み込んでいます…');
      try {
        await previewController.loadMmd(modelAsset, collected);
        if (controller.signal.aborted || serial !== loadSerial) return;
        setPreviewStatus(mmdPreviewStatus, `${formatLabel}（物理なし）`, 'success');
      } catch (error) {
        if (controller.signal.aborted || serial !== loadSerial) return;
        setPreviewStatus(mmdPreviewStatus, `読み込み失敗: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
  } catch (error) {
    if (serial !== loadSerial) return;
    if (controller.signal.aborted) return;
    setInputError(error instanceof Error ? error.message : String(error));
    fileSummary.textContent = 'ファイルを読み込めませんでした。';
  } finally {
    if (serial === loadSerial && conversionController === controller) {
      if (controller.signal.aborted) {
        model = undefined;
        modelAsset = undefined;
        textureAssets = [];
        assetFiles = [];
        originalTextureSizes.clear();
        renderTextureList();
        fileSummary.textContent = '読み込みをキャンセルしました。';
        previewController?.clearMmd();
        previewController?.clearVrm();
        setPreviewStatus(mmdPreviewStatus, 'PMD / PMXを読み込むと表示します。');
        setPreviewStatus(vrmPreviewStatus, '変換後に表示します。');
      }
      conversionController = undefined;
      setBusy(false);
    }
  }
}

async function convert(): Promise<void> {
  if (!model || !modelAsset) return;
  conversionController?.abort();
  const controller = new AbortController();
  conversionController = controller;
  vrmConversionCompleted = false;
  setBusy(true);
  setInputError();
  resetOutput();
  previewController?.clearVrm();
  setPreviewStatus(vrmPreviewStatus, '変換後に表示します。');
  try {
    const result = await convertPmxToVrm({
      pmxPath: modelAsset.path,
      model,
      assets: assetFiles,
      textureAssets,
      metadata: metadata(),
      materialMode: 'mtoon',
      signal: controller.signal,
    });
    await validateVrm(result.bytes);
    if (controller.signal.aborted) return;
    if (previewController) {
      setPreviewStatus(vrmPreviewStatus, 'VRMプレビューを読み込んでいます…');
      try {
        await previewController.loadVrm(result.bytes);
        if (controller.signal.aborted) return;
        setPreviewStatus(vrmPreviewStatus, '');
      } catch (error) {
        setPreviewStatus(vrmPreviewStatus, `読み込み失敗: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
    vrmConversionCompleted = true;
    downloadUrl = URL.createObjectURL(new Blob([result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer], { type: 'model/gltf-binary' }));
    downloadButton.href = downloadUrl;
    downloadButton.download = result.filename;
    setDownloadLabel(formatDownloadSize(result.bytes.byteLength));
    downloadButton.classList.remove(...downloadDisabledClasses);
    downloadButton.classList.add(...downloadEnabledClasses);
    downloadButton.removeAttribute('aria-disabled');
    renderStats(result);
    renderWarnings(result.warnings);
  } catch (error) {
    if (!controller.signal.aborted) setInputError(error instanceof Error ? error.message : String(error));
  } finally {
    if (conversionController === controller) {
      conversionController = undefined;
      setBusy(false);
    }
  }
}

function setFilePickerOpen(open: boolean): void {
  filePickerMenu.hidden = !open;
  filePickerButton.setAttribute('aria-expanded', String(open));
}

filePickerButton.addEventListener('click', () => {
  setFilePickerOpen(filePickerMenu.hidden);
});
filePickerFilesButton.addEventListener('click', () => {
  setFilePickerOpen(false);
  fileInput.click();
});
filePickerFolderButton.addEventListener('click', () => {
  setFilePickerOpen(false);
  folderInput.click();
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Node) || !filePicker.contains(event.target)) setFilePickerOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setFilePickerOpen(false);
});

fileInput.addEventListener('change', () => void loadFiles(Array.from(fileInput.files ?? [])));
folderInput.addEventListener('change', () => void loadFiles(Array.from(folderInput.files ?? [])));
const setDropZoneDragging = (dragging: boolean): void => {
  if (dragging) dropZone.classList.add(...dropZoneDraggingClasses);
  else dropZone.classList.remove(...dropZoneDraggingClasses);
};
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  setDropZoneDragging(true);
});
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  setDropZoneDragging(true);
});
window.addEventListener('dragleave', (event) => {
  const relatedTarget = event.relatedTarget;
  if (!(relatedTarget instanceof Node) || !document.documentElement.contains(relatedTarget)) {
    setDropZoneDragging(false);
  }
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  setDropZoneDragging(false);
  if (event.dataTransfer) void filesFromDrop(event.dataTransfer).then((files) => loadFiles(files));
});
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') fileInput.click();
});
textureList.addEventListener('input', (event) => updateTextureSetting(event.target));
textureList.addEventListener('change', (event) => updateTextureSetting(event.target));
vrmPreviewMaterialInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    const mode = selectedVrmPreviewMaterialMode();
    const applied = previewController?.setVrmMaterialMode(mode) ?? false;
    setPreviewStatus(
      vrmPreviewStatus,
      applied ? '' : 'VRMプレビューに反映できません。',
      applied ? 'muted' : 'error',
    );
  });
});
convertButton.addEventListener('click', () => void convert());
cancelButton.addEventListener('click', () => conversionController?.abort());
downloadButton.addEventListener('click', (event) => {
  if (downloadButton.getAttribute('aria-disabled') === 'true') event.preventDefault();
});
clearButton.addEventListener('click', () => {
  loadSerial += 1;
  conversionController?.abort();
  model = undefined;
  modelAsset = undefined;
  textureAssets = [];
  assetFiles = [];
  originalTextureSizes.clear();
  vrmConversionCompleted = false;
  previewController?.clearMmd();
  previewController?.clearVrm();
  fileInput.value = '';
  folderInput.value = '';
  fileSummary.textContent = 'まだファイルが読み込まれていません。';
  setInputError();
  resetOutput();
  renderTextureList();
  setPreviewStatus(mmdPreviewStatus, 'PMD / PMXを読み込むと表示します。');
  setPreviewStatus(vrmPreviewStatus, '変換後に表示します。');
  setBusy(false);
});

let previousPreviewTime = performance.now();
const renderPreviews = (time: number): void => {
  const delta = Math.max(0, Math.min((time - previousPreviewTime) / 1000, 0.05));
  previousPreviewTime = time;
  previewController?.update(delta);
  window.requestAnimationFrame(renderPreviews);
};
window.requestAnimationFrame(renderPreviews);
