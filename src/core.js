export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
export const DEFAULT_LIGHTS = [{ id: 'key', azimuth: 45, elevation: 35, intensity: 5, color: '#fff1d6', type: 'gel' }];
export const DEFAULT_LAYOUT = { width: 1920, height: 1080, rows: 2, columns: 3, gapX: 40, gapY: 40, padding: 64, offsetX: 0, offsetY: 0, scale: 90, backgroundColor: '#d8d6cf', transparent: false };
export function normalizedLights(lights) {
  if (!Array.isArray(lights) || lights.length < 1 || lights.length > 4) throw new Error('請設定 1–4 盞燈。');
  return lights.map(l => ({ azimuth: ((Math.round(clamp(l.azimuth, -180, 360)) + 180) % 360) - 180, elevation: Math.round(clamp(l.elevation, -90, 90)), intensity: Math.round(clamp(l.intensity, 1, 10)), type: l.type === 'neutral' ? 'neutral' : 'gel', ...(l.type === 'neutral' ? {} : { color: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#ffffff' }) }));
}
export function lightPosition(light, radius = 3.2) {
  const az = light.azimuth * Math.PI / 180, el = light.elevation * Math.PI / 180;
  return [radius * Math.sin(az) * Math.cos(el), radius * Math.sin(el), radius * Math.cos(az) * Math.cos(el)];
}
export function fitRect(iw, ih, x, y, w, h, scale = 1) {
  const ratio = Math.min(w / iw, h / ih) * scale;
  return { x: x + (w - iw * ratio) / 2, y: y + (h - ih * ratio) / 2, width: iw * ratio, height: ih * ratio };
}
export function gridLayout(items, config) {
  const c = { ...DEFAULT_LAYOUT, ...config };
  const columns = Math.max(1, Math.floor(c.columns));
  const requestedRows = Math.max(1, Math.floor(c.rows));
  const rows = Math.max(requestedRows, Math.ceil(items.length / columns));
  const pad = clamp(c.padding, 0, Math.min(c.width, c.height) / 2 - 1);
  const gapX = clamp(c.gapX, 0, Math.max(0, (c.width - 2 * pad - columns) / Math.max(1, columns - 1)));
  const gapY = clamp(c.gapY, 0, Math.max(0, (c.height - 2 * pad - rows) / Math.max(1, rows - 1)));
  const cw = Math.max(1, (c.width - pad * 2 - gapX * (columns - 1)) / columns);
  const ch = Math.max(1, (c.height - pad * 2 - gapY * (rows - 1)) / rows);
  const slots = items.map((item, index) => {
    const x = pad + index % columns * (cw + gapX) + Number(c.offsetX);
    const y = pad + Math.floor(index / columns) * (ch + gapY) + Number(c.offsetY);
    const rect = fitRect(item.width || 1, item.height || 1, x, y, cw, ch, clamp(c.scale, 10, 100) / 100);
    return { id: item.id, cell: { x, y, width: cw, height: ch }, ...rect };
  });
  return { slots, rows, columns, gapX, gapY, expanded: rows > requestedRows };
}
export function shuffle(items, rng = Math.random) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; }
  return output;
}
export function snapshotRecipe(lights, resolution, folderReference) {
  return { lights: normalizedLights(lights), resolution, ...(folderReference ? { folderReference } : {}) };
}
export function safeFilename(name) { return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'image'; }
export function unwrapMcp(result) {
  if (result.isError) throw new Error(result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || 'Magnific 呼叫失敗');
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n');
  if (text) { try { return JSON.parse(text); } catch { throw new Error(text.slice(0, 600)); } }
  throw new Error('Magnific 未傳回可讀取的結果。');
}
export function creationId(data) {
  const id = data.creation?.identifier || data.creations?.[0]?.identifier || data.identifier || data.results?.[0]?.identifier;
  if (!id) throw new Error(data.partialFailure || 'Magnific 未傳回作品 ID；為避免重複扣點，請先檢查 Magnific 歷史紀錄。');
  return id;
}
