import './style.css';
import { createIcons, Zap, ArrowUpRight, CircleHelp, Sun, Plus, Minus, CircleDot, CircleDashed, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Move, Info, ImagePlus, Shuffle, Scan, Layers2, MousePointer2, Play, Upload, X, RotateCcw, Scissors, Check, Sparkles, Save, FolderOpen, Archive, Download, RefreshCw, LayoutGrid } from 'lucide';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { DEFAULT_LIGHTS, DEFAULT_LAYOUT, clamp, gridLayout, shuffle, snapshotRecipe, safeFilename } from './core.js';
import { loadProject, saveProject } from './storage.js';
import { MagnificClient } from './magnific.js';
import { LightScene, createDemoAssets } from './scene.js';
import { processItem, runPool } from './pipeline.js';

const iconSet = { Zap, ArrowUpRight, CircleHelp, Sun, Plus, Minus, CircleDot, CircleDashed, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Move, Info, ImagePlus, Shuffle, Scan, Layers2, MousePointer2, Play, Upload, X, RotateCcw, Scissors, Check, Sparkles, Save, FolderOpen, Archive, Download, RefreshCw, LayoutGrid };
const icons = () => createIcons({ icons: iconSet });
const $ = id => document.getElementById(id);
const client = new MagnificClient();
const state = { lights: structuredClone(DEFAULT_LIGHTS), layout: { ...DEFAULT_LAYOUT }, selectedLight: 0, items: [], background: null, resolution: '2k', concurrency: 2, folder: '', guides: true };
let scene, busy = false, stopRequested = false, saveTimer, toastTimer, saveWarningShown = false, frame, projectsLoading = false;
const statuses = { ready: '等待打光', demo: '示範素材', done: '已打光・已去背', failed: '處理失敗', interrupted: '可繼續處理', queued: '排隊中', processing: '處理中' };
function toast(message, error = false) { const box = $('toast'); box.textContent = message; box.classList.toggle('error', error); box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, error ? 12000 : 5000); }
function on(id, event, action) { $(id).addEventListener(event, async e => { try { await action(e); } catch (error) { toast(error.message || String(error), true); } }); }
function icon(name) { const el = document.createElement('i'); el.dataset.lucide = name; return el; }
function button(title, className, iconName, action) { const el = document.createElement('button'); el.className = className; el.title = title; el.setAttribute('aria-label', title); el.append(icon(iconName)); el.addEventListener('click', async e => { e.stopPropagation(); try { await action(); } catch (error) { toast(error.message, true); } }); return el; }
function snapshot() {
  return { version: 1, lights: state.lights, layout: state.layout, resolution: state.resolution, concurrency: state.concurrency, folder: state.folder, background: state.background ? { file: state.background.file, name: state.background.name } : null,
    items: state.items.map(({ id, name, original, output, sourceId, relightId, cutoutId, recipe, status, error, uncertain }) => ({ id, name, original, output, sourceId, relightId, cutoutId, recipe, status, error, uncertain })) };
}
async function persist() { clearTimeout(saveTimer); try { await saveProject(snapshot()); $('save-status').textContent = '已自動儲存'; } catch (error) { $('save-status').textContent = '本機儲存失敗'; if (!saveWarningShown) toast('瀏覽器儲存空間不足或無法存取；請下載專案備份。', true); saveWarningShown = true; throw error; } }
function scheduleSave() { $('save-status').textContent = '儲存中…'; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist().catch(() => {}), 500); }
function requestDraw() { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }

async function prepareBlob(blob, crop = false) {
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 40e6 || bitmap.width > 16384 || bitmap.height > 16384) { bitmap.close(); throw new Error('圖片尺寸過大，請使用 40 MP 以下的圖片。'); }
  let bounds = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  if (crop) {
    const factor = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * factor)), Math.max(1, Math.round(bitmap.height * factor)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] > 3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 >= 0) { const x = Math.max(0, (x0 - 1) / factor), y = Math.max(0, (y0 - 1) / factor); bounds = { x, y, width: Math.min(bitmap.width - x, (x1 - x0 + 3) / factor), height: Math.min(bitmap.height - y, (y1 - y0 + 3) / factor) }; }
  }
  return { bitmap, bounds, url: URL.createObjectURL(blob), width: bounds.width, height: bounds.height };
}
function release(item) { item.bitmap?.close(); if (item.url) URL.revokeObjectURL(item.url); }
async function updateImage(item) { const prepared = await prepareBlob(item.output || item.original, !!item.output || item.status === 'demo'); release(item); Object.assign(item, prepared); }
async function addFiles(files, demo = false) {
  if (busy) throw new Error('請等目前批次完成，再加入圖片。');
  const inputs = [...files];
  if (state.items.length + inputs.length > 100) throw new Error('每個專案最多 100 張圖片。');
  if (inputs.reduce((sum, f) => sum + f.size, 0) + state.items.reduce((sum, i) => sum + i.original.size, 0) > 200 * 1024 * 1024) throw new Error('原始素材合計上限為 200 MB，請分批處理。');
  const errors = [];
  for (const file of inputs) {
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('僅支援 PNG、JPG、WebP');
      if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25 MB');
      const item = { id: crypto.randomUUID(), name: file.name, original: file, status: demo ? 'demo' : 'ready', output: null };
      await updateImage(item); state.items.push(item);
    } catch (e) { errors.push(`${file.name}: ${e.message}`); }
  }
  renderAssets(); requestDraw(); scheduleSave();
  if (errors.length) toast(errors.join('；'), true);
}

function renderLights() {
  const light = state.lights[state.selectedLight];
  $('light-tabs').replaceChildren(...state.lights.map((l, index) => { const tab = document.createElement('button'); tab.className = 'light-tab' + (index === state.selectedLight ? ' selected' : ''); tab.textContent = index + 1; tab.setAttribute('aria-label', `選擇燈光 ${index + 1}`); tab.setAttribute('aria-pressed', index === state.selectedLight); tab.onclick = () => { state.selectedLight = index; renderLights(); }; return tab; }));
  for (const key of ['azimuth', 'elevation', 'intensity']) { $(key).value = Math.round(light[key]); $(key + '-number').value = Math.round(light[key]); }
  $('light-color').value = light.color;
  $('add-light').disabled = state.lights.length >= 4; $('remove-light').disabled = state.lights.length <= 1;
  scene?.update(state.lights, state.selectedLight);
}
function renderLayout() {
  for (const key of Object.keys(DEFAULT_LAYOUT)) if ($(key) && typeof state.layout[key] === 'number') $(key).value = state.layout[key];
  $('bg-color').value = state.layout.backgroundColor;
  $('transparent').checked = state.layout.transparent;
  $('padding-value').textContent = `${state.layout.padding} px`; $('scale-value').textContent = `${state.layout.scale}%`;
  $('resolution').value = state.resolution; $('concurrency').value = state.concurrency;
  $('canvas-size').textContent = `${state.layout.width} × ${state.layout.height}`;
  $('bg-name').textContent = state.background?.name || (state.layout.transparent ? '透明背景' : '純色底圖');
  $('bg-description').textContent = state.background ? `${state.background.bitmap.width} × ${state.background.bitmap.height} · 自動符合比例` : '可上傳圖片，自動符合比例';
  $('bg-swatch').style.backgroundColor = state.layout.backgroundColor;
  $('bg-swatch').style.backgroundImage = state.background ? `url("${state.background.url}")` : '';
  $('clear-background').hidden = !state.background;
  $('bg-color').hidden = !!state.background;
  $('transparent').disabled = !!state.background;
  document.querySelectorAll('[data-ratio]').forEach(button => { const [w, h] = button.dataset.ratio.split(':').map(Number); button.classList.toggle('active', Math.abs(state.layout.width / state.layout.height - w / h) < 0.005); button.disabled = !!state.background; });
  requestDraw();
}
function renderAssets() {
  const list = $('asset-list'); list.replaceChildren();
  for (const item of state.items) {
    const card = document.createElement('div'); card.className = 'asset-card ' + item.status; card.title = item.error || item.name;
    const img = document.createElement('img'); img.src = item.url; img.alt = item.name;
    const name = document.createElement('div'); name.className = 'asset-name'; name.textContent = item.name;
    const status = document.createElement('div'); status.className = 'asset-state'; status.textContent = item.progress || statuses[item.status];
    const remove = button(`移除 ${item.name}`, 'remove-asset', 'x', () => { if (busy) return; release(item); state.items = state.items.filter(i => i.id !== item.id); renderAssets(); requestDraw(); scheduleSave(); }); remove.disabled = busy;
    card.append(img, remove, name, status); list.append(card);
  }
  const upload = button('加入圖片', 'asset-upload', 'upload', () => $('image-input').click()); upload.disabled = busy;
  if (!state.items.length) { const text = document.createElement('span'); text.append(document.createTextNode('拖放圖片到這裡'), document.createElement('br')); const small = document.createElement('small'); small.textContent = '或點擊選取多張圖片'; text.append(small); upload.append(text); } else { upload.style.flex = '0 0 65px'; upload.style.minWidth = '65px'; }
  list.append(upload);
  $('asset-count').textContent = state.items.length;
  const done = state.items.filter(i => i.status === 'done').length, failed = state.items.filter(i => i.status === 'failed').length;
  $('batch-status').textContent = state.items.length ? `${done} 已完成${failed ? ` · ${failed} 失敗` : ''} / ${state.items.length} 張` : 'PNG / JPG / WEBP · 每張最高 25 MB';
  $('resume').hidden = busy || !state.items.some(i => ['failed', 'interrupted'].includes(i.status));
  $('generate').disabled = busy || !state.items.length;
  $('generate').hidden = busy; $('stop').hidden = !busy;
  $('add-images').disabled = busy;
  $('open-project').disabled = busy;
  $('export-assets').disabled = !state.items.some(i => i.output);
  $('export-png').disabled = !state.items.length;
  $('empty-state').hidden = !!state.items.length;
  $('canvas-description').textContent = state.items.some(i => i.status === 'demo') ? '示範素材 · 尚未經過 AI 重打光' : state.items.length ? `${state.items.length} 張素材，共用一組光線。` : '同一盞光，讓整個系列更一致。';
  icons();
}

function paint(canvas, guides = false) {
  const { width, height } = state.layout;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
  if (state.background) ctx.drawImage(state.background.bitmap, 0, 0, width, height);
  else if (!state.layout.transparent) { ctx.fillStyle = state.layout.backgroundColor; ctx.fillRect(0, 0, width, height); }
  const grid = gridLayout(state.items, state.layout);
  for (let index = 0; index < state.items.length; index++) {
    const item = state.items[index], rect = grid.slots[index], b = item.bounds;
    if (item.bitmap && b) ctx.drawImage(item.bitmap, b.x, b.y, b.width, b.height, rect.x, rect.y, rect.width, rect.height);
  }
  return grid;
}
function draw() {
  const board = $('board'), { width, height } = state.layout;
  board.style.aspectRatio = `${width} / ${height}`;
  // Limit tall boards while preserving the exact uploaded background ratio.
  if (window.innerWidth > 950) {
    const area = $('canvas-area'), css = getComputedStyle(area);
    const availableHeight = Math.max(120, area.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - 65);
    board.style.maxWidth = `${availableHeight * width / height}px`;
  } else board.style.maxWidth = height > width ? `${Math.max(220, 470 * width / height)}px` : '100%';
  const grid = paint($('composition'));
  $('layout-notice').textContent = `${grid.columns} 欄 × ${grid.rows} 列${grid.expanded ? '（自動增加列數）' : ''}`;
  const overlays = $('overlays'); overlays.replaceChildren();
  const setPosition = (el, rect) => Object.assign(el.style, { left: `${rect.x / width * 100}%`, top: `${rect.y / height * 100}%`, width: `${rect.width / width * 100}%`, height: `${rect.height / height * 100}%` });
  for (const rect of grid.slots) {
    const item = state.items.find(i => i.id === rect.id);
    if (state.guides) { const guide = document.createElement('div'); guide.className = 'guide-cell'; setPosition(guide, rect.cell); overlays.append(guide); }
    const overlay = document.createElement('div'); overlay.className = 'item-overlay'; setPosition(overlay, rect);
    const refresh = button(`重產 ${item.name}（沿用上次打光設定）`, 'refresh-button', 'refresh-cw', () => regenerate(item)); refresh.disabled = busy;
    const label = document.createElement('span'); label.className = 'item-label'; label.textContent = item.progress || `${item.name} · ${statuses[item.status]}`;
    overlay.append(refresh, label); overlays.append(overlay);
  }
  icons();
}

async function loadBackground(file, restoring = false) {
  if (file.size > 25 * 1024 * 1024) throw new Error('底圖大小上限為 25 MB');
  const prepared = await prepareBlob(file);
  if (state.background) release(state.background);
  state.background = { ...prepared, file, name: file.name || 'background.png' };
  if (!restoring) {
    const factor = Math.min(1, 8192 / Math.max(prepared.width, prepared.height), Math.sqrt(32e6 / (prepared.width * prepared.height)));
    state.layout.width = Math.round(prepared.width * factor); state.layout.height = Math.round(prepared.height * factor); state.layout.transparent = false;
  }
  renderLayout(); scheduleSave();
}

async function restore(data) {
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 100) throw new Error('不支援的專案格式');
  if (data.layout.width < 64 || data.layout.height < 64 || data.layout.width > 8192 || data.layout.height > 8192 || data.layout.width * data.layout.height > 32e6) throw new Error('專案畫布尺寸超出範圍');
  snapshotRecipe(data.lights, data.resolution, data.folder);
  const preparedItems = [];
  try {
    for (const raw of data.items) { const item = { ...raw, status: ['processing', 'queued'].includes(raw.status) ? 'interrupted' : raw.status }; await updateImage(item); preparedItems.push(item); }
  } catch (e) { preparedItems.forEach(release); throw e; }
  state.items.forEach(release); if (state.background) release(state.background);
  Object.assign(state, { lights: data.lights, layout: { ...DEFAULT_LAYOUT, ...data.layout }, resolution: data.resolution || '2k', concurrency: clamp(data.concurrency || 2, 1, 3), folder: data.folder || '', items: preparedItems, background: null, selectedLight: 0 });
  if (data.background?.file) await loadBackground(data.background.file, true);
  renderLights(); renderLayout(); renderAssets(); requestDraw();
}

async function connect() {
  if (busy) throw new Error('請等待目前批次完成。');
  if (client.connected) { client.logout(); $('connection-label').textContent = '連接 Magnific'; $('connect').querySelector('.status-dot').classList.add('offline'); $('credits-note').textContent = '產圖使用 Magnific credits · 官網 Unlimited 不適用'; $('folder').replaceChildren(new Option('Personal（預設）', '')); $('projects-status').textContent = '連接帳號後自動載入專案'; state.folder = ''; scheduleSave(); toast('已中斷此分頁的 Magnific 連線'); return; }
  await persist(); await client.login();
}
async function refreshAccount() {
  await client.initialize();
  const balance = await client.call('account_balance');
  $('connection-label').textContent = `已連接 · ${balance.credits?.available ?? '—'} credits`;
  $('connect').querySelector('.status-dot').classList.remove('offline');
  $('connect').title = '點擊中斷連線';
  $('credits-note').textContent = '可用 ' + (balance.credits?.available ?? '—') + ' credits · 此網站產圖會扣點，官網 Unlimited 不適用';
  await refreshProjects();
}

async function refreshProjects() {
  if (projectsLoading) return;
  if (!client.connected) { $('projects-status').textContent = '請先連接 Magnific 帳號'; return; }
  projectsLoading = true; $('refresh-projects').disabled = true; $('projects-status').textContent = '正在讀取帳號專案…';
  try {
    const projects = await client.listProjects();
    if (!client.connected) return;
    const select = $('folder'), defaultProject = projects.find(project => project.type === 'project_default');
    const options = projects.map(project => {
      const option = new Option((project.name || project.reference) + (project.type === 'project_default' ? '（預設）' : '') + (project.disabled ? '（無法使用）' : ''), project.reference);
      option.disabled = !!project.disabled; return option;
    });
    if (!defaultProject) options.unshift(new Option('Personal（預設）', ''));
    if (state.folder && !options.some(option => option.value === state.folder)) {
      const missing = new Option('已儲存專案（目前無法存取）', state.folder); missing.disabled = true; options.push(missing);
    }
    select.replaceChildren(...options); select.value = state.folder || defaultProject?.reference || '';
    $('projects-status').textContent = `已載入 ${projects.length} 個專案`;
  } catch (error) {
    $('projects-status').textContent = '專案讀取失敗，請重新整理';
    toast('Magnific 專案：' + error.message, true);
  } finally { projectsLoading = false; $('refresh-projects').disabled = false; }
}

async function executeBatch(items, recipe) {
  if (busy) return;
  if (!client.connected) { toast('先點右上角「連接 Magnific」，登入後即可產圖。', true); return; }
  if ([...$('folder').selectedOptions].some(option => option.disabled)) throw new Error('請先選擇目前帳號可使用的 Magnific 專案。');
  if (!items.length) { toast('沒有待處理的圖片。'); return; }
  if (items.some(i => i.uncertain)) throw new Error('有工作在送出後中斷，是否已扣點尚不確定。請先到 Magnific 歷史確認；要明確重產可使用圖片上的 ↻。');
  busy = true; stopRequested = false;
  $('stop').disabled = false; $('stop').textContent = '完成目前項目後停止';
  let completed = 0;
  const progress = document.querySelector('.batch-progress'); progress.hidden = false; $('batch-progress-fill').style.width = '0%';
  items.forEach(i => { i.status = 'queued'; i.error = null; }); renderAssets(); requestDraw();
  try {
    await client.initialize();
    const balance = await client.call('account_balance');
    if (!(balance.credits?.available > 0)) throw new Error('Magnific credits 額度不足。官網 Unlimited 不適用於此網站的 MCP 產圖。');
    await persist();
    await runPool(items, state.concurrency, async item => {
      item.status = 'processing'; item.error = null;
      try {
        await processItem(item, recipe, client, persist, text => { item.progress = text; $('bottom-status').textContent = `${item.name} · ${text}`; renderAssets(); requestDraw(); });
        await updateImage(item); item.status = 'done'; item.error = null; item.progress = null;
      } catch (error) {
        if (error.terminalTask === item.relightId) { item.relightId = null; item.cutoutId = null; }
        else if (error.terminalTask === item.cutoutId) item.cutoutId = null;
        item.status = 'failed'; item.error = error.message; item.progress = null;
        toast(`${item.name}：${error.message}`, true);
      } finally {
        completed++; $('batch-progress-fill').style.width = `${completed / items.length * 100}%`;
        renderAssets(); requestDraw(); await persist();
      }
    }, () => stopRequested);
  } finally {
    busy = false;
    items.forEach(i => { if (i.status === 'queued') i.status = 'interrupted'; });
    $('bottom-status').textContent = stopRequested ? '已停止加入新工作；目前處理的圖片已結束' : `${items.filter(i => i.status === 'done').length} 張完成 · ${items.filter(i => i.status === 'failed').length} 張失敗`;
    renderAssets(); requestDraw(); await persist();
    refreshAccount().catch(() => {});
  }
}
async function regenerate(item) {
  if (busy) return;
  if (!client.connected) { toast('請先連接 Magnific，即可單張重產。', true); return; }
  item.recipe ||= snapshotRecipe(state.lights, state.resolution, state.folder);
  item.relightId = null; item.cutoutId = null; item.uncertain = null;
  await executeBatch([item], item.recipe);
}

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
async function exportPng() {
  if (!state.items.length) return;
  const canvas = document.createElement('canvas'); paint(canvas);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 匯出失敗，請降低畫布尺寸。');
  download(blob, 'relight-composition.png');
  if (state.items.some(i => !i.output)) toast('已匯出目前畫布；尚未完成產圖的圖片使用原圖。'); else toast('已匯出合成 PNG');
}
async function exportAssets() {
  const items = state.items.filter(i => i.output); if (!items.length) throw new Error('請先完成至少一張圖片的打光與去背。');
  const files = {};
  for (const [index, item] of items.entries()) files[`${String(index + 1).padStart(3, '0')}-${safeFilename(item.name)}.${item.output.type === 'image/webp' ? 'webp' : 'png'}`] = new Uint8Array(await item.output.arrayBuffer());
  download(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'relight-cutouts.zip');
}
async function exportProject() {
  const manifest = snapshot(), files = {};
  for (const [index, item] of manifest.items.entries()) {
    const source = `originals/${index}`, output = `outputs/${index}`;
    files[source] = new Uint8Array(await item.original.arrayBuffer());
    const sourceType = item.original.type;
    if (item.output) files[output] = new Uint8Array(await item.output.arrayBuffer());
    item.output = item.output ? { path: output, type: item.output.type } : null;
    item.original = { path: source, type: sourceType };
  }
  if (manifest.background) { files.background = new Uint8Array(await manifest.background.file.arrayBuffer()); manifest.background.type = manifest.background.file.type; delete manifest.background.file; }
  files['project.json'] = strToU8(JSON.stringify(manifest));
  download(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'untitled-studio.relight');
  toast('專案已下載，包含原圖、結果與設定。');
}
async function importProject(file) {
  if (file.size > 500 * 1024 * 1024) throw new Error('專案檔案超過 500 MB');
  let size = 0, count = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) { size += entry.originalSize; count++; if (size > 600 * 1024 * 1024 || count > 203) throw new Error('專案解壓縮大小或檔案數量超過上限'); return true; } });
  if (!files['project.json']) throw new Error('找不到 project.json');
  const manifest = JSON.parse(strFromU8(files['project.json']));
  for (const item of manifest.items) {
    if (!files[item.original.path]) throw new Error('專案遺失原圖');
    item.original = new File([files[item.original.path]], item.name, { type: item.original.type });
    if (item.output) { if (!files[item.output.path]) throw new Error('專案遺失產圖結果'); item.output = new Blob([files[item.output.path]], { type: item.output.type }); }
  }
  if (manifest.background) manifest.background.file = new File([files.background], manifest.background.name, { type: manifest.background.type });
  await restore(manifest); await persist(); toast('專案已開啟');
}

// Bind controls once; item-specific buttons are built with DOM APIs so filenames
// and upstream error messages can never become HTML.
for (const id of ['empty-upload', 'add-images']) on(id, 'click', () => $('image-input').click());
on('image-input', 'change', async e => { await addFiles(e.target.files); e.target.value = ''; });
on('background-upload', 'click', () => $('background-input').click());
on('background-input', 'change', async e => { if (e.target.files[0]) await loadBackground(e.target.files[0]); e.target.value = ''; });
on('clear-background', 'click', () => { if (state.background) release(state.background); state.background = null; renderLayout(); scheduleSave(); });
on('load-demo', 'click', async () => { $('load-demo').disabled = true; try { await addFiles(await createDemoAssets(), true); toast('示範素材已加入，可以試用排版與匯出。'); } finally { $('load-demo').disabled = false; } });
on('connect', 'click', connect);
on('help', 'click', () => $('help-dialog').showModal());
document.querySelector('.dialog-close').onclick = () => $('help-dialog').close();
on('add-light', 'click', () => { if (state.lights.length >= 4) return; state.lights.push({ id: crypto.randomUUID(), azimuth: 270, elevation: 20, intensity: 3, color: '#a3c7ff', type: 'gel' }); state.selectedLight = state.lights.length - 1; renderLights(); scheduleSave(); });
on('remove-light', 'click', () => { if (state.lights.length <= 1) return; state.lights.splice(state.selectedLight, 1); state.selectedLight = Math.min(state.selectedLight, state.lights.length - 1); renderLights(); scheduleSave(); });
for (const key of ['azimuth', 'elevation', 'intensity']) for (const suffix of ['', '-number']) on(key + suffix, 'input', e => { const el = e.target; state.lights[state.selectedLight][key] = Math.round(clamp(el.value, Number(el.min), Number(el.max))); renderLights(); scheduleSave(); });
const presets = { front: [0, 0], back: [180, 0], left: [270, 0], right: [90, 0], top: [0, 90], bottom: [0, -90] };
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const [azimuth, elevation] = presets[b.dataset.preset]; Object.assign(state.lights[state.selectedLight], { azimuth, elevation }); renderLights(); scheduleSave(); });
document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { Object.assign(state.lights[state.selectedLight], { color: b.dataset.color, type: b.dataset.color === '#ffffff' ? 'neutral' : 'gel' }); renderLights(); scheduleSave(); });
on('light-color', 'input', e => { Object.assign(state.lights[state.selectedLight], { color: e.target.value, type: 'gel' }); renderLights(); scheduleSave(); });
// Keep numeric edits in the project immediately, even before focus leaves the
// field. Do not rewrite the active text field while the user is typing.
for (const key of Object.keys(DEFAULT_LAYOUT).filter(key => typeof DEFAULT_LAYOUT[key] === 'number' && $(key).type === 'number')) on(key, 'input', e => {
  const input = e.target, value = Number(input.value);
  if (!input.value || !Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) return;
  const next = { ...state.layout, [key]: Math.round(value) };
  if (state.background && ['width', 'height'].includes(key)) {
    const aspect = state.background.bitmap.width / state.background.bitmap.height;
    if (key === 'width') next.height = Math.round(value / aspect); else next.width = Math.round(value * aspect);
  }
  if (next.width > 8192 || next.height > 8192 || next.width * next.height > 32e6) return;
  state.layout = next;
  if (state.background && key === 'width') $('height').value = next.height;
  if (state.background && key === 'height') $('width').value = next.width;
  $('canvas-size').textContent = `${next.width} × ${next.height}`;
  requestDraw(); scheduleSave();
});
for (const key of Object.keys(DEFAULT_LAYOUT).filter(key => typeof DEFAULT_LAYOUT[key] === 'number')) on(key, $(key).type === 'range' ? 'input' : 'change', e => {
  const value = clamp(e.target.value, Number(e.target.min), Number(e.target.max)); state.layout[key] = Math.round(value);
  if (state.background && ['width', 'height'].includes(key)) { const aspect = state.background.bitmap.width / state.background.bitmap.height; if (key === 'width') state.layout.height = Math.round(value / aspect); else state.layout.width = Math.round(value * aspect); }
  const factor = Math.min(1, 8192 / Math.max(state.layout.width, state.layout.height), Math.sqrt(32e6 / (state.layout.width * state.layout.height)));
  state.layout.width = Math.max(64, Math.round(state.layout.width * factor)); state.layout.height = Math.max(64, Math.round(state.layout.height * factor));
  renderLayout(); scheduleSave();
});
document.querySelectorAll('[data-ratio]').forEach(b => b.onclick = () => { if (state.background) return; const [w, h] = b.dataset.ratio.split(':').map(Number); state.layout.width = w >= h ? 1920 : Math.round(1920 * w / h); state.layout.height = h >= w ? 1920 : Math.round(1920 * h / w); renderLayout(); scheduleSave(); });
on('bg-color', 'input', e => { state.layout.backgroundColor = e.target.value; renderLayout(); scheduleSave(); });
on('transparent', 'change', e => { state.layout.transparent = e.target.checked; renderLayout(); scheduleSave(); });
on('shuffle', 'click', () => { state.items = shuffle(state.items); renderAssets(); requestDraw(); scheduleSave(); });
on('toggle-guides', 'click', () => { state.guides = !state.guides; $('toggle-guides').classList.toggle('active', state.guides); requestDraw(); });
on('reset-layout', 'click', () => { const { width, height, backgroundColor, transparent } = state.layout; state.layout = { ...DEFAULT_LAYOUT, width, height, backgroundColor, transparent }; renderLayout(); scheduleSave(); });
on('resolution', 'change', e => { state.resolution = e.target.value; scheduleSave(); });
on('concurrency', 'change', e => { state.concurrency = Number(e.target.value); scheduleSave(); });
on('folder', 'change', e => { state.folder = e.target.value; scheduleSave(); });
on('refresh-projects', 'click', refreshProjects);
on('generate', 'click', () => {
  if (!client.connected) { toast('先點右上角「連接 Magnific」，登入後即可產圖。', true); return; }
  const recipe = snapshotRecipe(state.lights, state.resolution, state.folder);
  for (const item of state.items) { item.recipe = structuredClone(recipe); item.relightId = null; item.cutoutId = null; item.uncertain = null; }
  return executeBatch([...state.items], recipe);
});
on('resume', 'click', () => executeBatch(state.items.filter(i => ['failed', 'interrupted'].includes(i.status)), snapshotRecipe(state.lights, state.resolution, state.folder)));
on('stop', 'click', () => { stopRequested = true; $('stop').disabled = true; $('stop').textContent = '等待目前圖片完成…'; });
on('export-png', 'click', exportPng); on('export-assets', 'click', exportAssets); on('save-project', 'click', exportProject);
on('open-project', 'click', () => $('project-input').click());
on('project-input', 'change', async e => { if (e.target.files[0]) await importProject(e.target.files[0]); e.target.value = ''; });
let dragDepth = 0;
document.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('drag-over'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', async e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag-over'); try { await addFiles(e.dataTransfer.files); } catch (error) { toast(error.message, true); } });
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });

async function boot() {
  icons();
  new ResizeObserver(requestDraw).observe($('canvas-area'));
  try { scene = new LightScene($('light-scene'), values => { Object.assign(state.lights[state.selectedLight], values); renderLights(); scheduleSave(); }); } catch { $('light-scene').textContent = '此裝置無法啟用 WebGL，仍可使用數值控制打光。'; }
  try { const saved = await loadProject(); if (saved) await restore(saved); } catch (error) { toast('無法還原上次工作區：' + error.message, true); }
  renderLights(); renderLayout(); renderAssets();
  try { await client.callback(); if (client.connected) await refreshAccount(); } catch (error) { toast('Magnific 連線：' + error.message, true); }
  if (!client.connected) try { const config = await (await fetch('./oauth-config.json', { cache: 'no-store' })).json(); if (!config.client_id) { $('connection-label').textContent = 'Magnific 待設定'; $('credits-note').textContent = '登入整合待設定 · 排版與匯出可先使用'; } } catch { /* login reports the actionable configuration error */ }
}
boot();
