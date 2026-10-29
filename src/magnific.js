import { unwrapMcp, creationId } from './core.js';

const SERVER = 'https://mcp.magnific.com';
const PREFIX = 'relight.oauth.';
const read = key => { try { return JSON.parse(sessionStorage.getItem(PREFIX + key)); } catch { return null; } };
const write = (key, data) => sessionStorage.setItem(PREFIX + key, JSON.stringify(data));
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const redirectUri = () => new URL('./', location.href).href;
async function jsonResponse(response, stage = '連線') {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${stage}：${data.error_description || data.error?.message || data.message || `HTTP ${response.status}`}`);
  return data;
}
export function parseRpcText(text, id) {
  try { return JSON.parse(text); } catch { /* Streamable HTTP can use SSE. */ }
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try { const parsed = JSON.parse(data); if (parsed.id === id) return parsed; } catch { /* next event */ }
  }
  throw new Error('Magnific 回應格式無法辨識。');
}

export class MagnificClient {
  constructor() { this.seq = 0; this.ready = null; this.refreshing = null; }
  get connected() { return !!read('tokens')?.access_token; }
  async configuration() {
    return this.config ||= await jsonResponse(await fetch(new URL('./oauth-config.json', location.href), { cache: 'no-store' }), '讀取網站設定');
  }
  async metadata() {
    return this.meta ||= await jsonResponse(await fetch(SERVER + '/.well-known/oauth-authorization-server', { credentials: 'omit' }), '讀取 OAuth 設定');
  }
  async login() {
    const metadata = await this.metadata();
    let client = read('client');
    if (!client || client.redirectUri !== redirectUri()) {
      const config = await this.configuration();
      if (!config.client_id) throw new Error('此網站的 Magnific 登入設定尚未完成。完成 OAuth 用戶端設定後即可產圖；目前可使用排版與匯出。');
      if (!config.redirect_uris?.includes(redirectUri())) throw new Error('此網站網址不在 OAuth 回呼清單內，請使用正式網站。');
      client = { client_id: config.client_id, redirectUri: redirectUri() };
      write('client', client);
    }
    const verifier = random(), state = random();
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    write('flow', { verifier, state, at: Date.now(), redirectUri: redirectUri() });
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid profile mcp:custom-audience', state, code_challenge: challenge, code_challenge_method: 'S256', resource: SERVER });
    location.assign(url.href);
  }
  async callback() {
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('error')) return false;
    const flow = read('flow');
    history.replaceState(null, '', location.pathname);
    sessionStorage.removeItem(PREFIX + 'flow');
    if (!flow || params.get('state') !== flow.state || Date.now() - flow.at > 15 * 60 * 1000) throw new Error('登入驗證已過期或不符，請重新連線。');
    if (params.has('error')) throw new Error(params.get('error_description') || '登入已取消');
    const metadata = await this.metadata();
    if (params.get('iss') && params.get('iss') !== metadata.issuer) throw new Error('OAuth issuer 不符');
    await this.exchange({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: flow.redirectUri, code_verifier: flow.verifier });
    return true;
  }
  async exchange(parameters) {
    const metadata = await this.metadata(), client = read('client');
    if (!client?.client_id) throw new Error('請重新登入 Magnific');
    const tokens = await jsonResponse(await fetch(metadata.token_endpoint, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, ...parameters }) }), '交換登入憑證');
    write('tokens', { ...read('tokens'), ...tokens, expires_at: Date.now() + (tokens.expires_in || 300) * 1000 });
    return tokens.access_token;
  }
  async token() {
    const tokens = read('tokens');
    if (!tokens?.access_token) throw new Error('請先連接 Magnific 帳號。');
    if (tokens.expires_at > Date.now() + 30000) return tokens.access_token;
    if (!tokens.refresh_token) throw new Error('登入已過期，請重新連線。');
    if (!this.refreshing) this.refreshing = this.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  logout() { for (const key of ['tokens', 'flow', 'client']) sessionStorage.removeItem(PREFIX + key); this.ready = null; this.sessionId = null; }
  async rpc(method, params, notification = false) {
    const id = ++this.seq;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + await this.token() };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    // The server's published browser CORS policy permits Authorization/Content-Type,
    // not MCP-Protocol-Version. Negotiate the legacy default in initialize instead.
    const response = await fetch(SERVER, { method: 'POST', credentials: 'omit', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(180000) });
    if (response.status === 401) throw new Error('Magnific 登入已失效，請斷線後重新連接。');
    if (!response.ok) throw new Error(`Magnific ${response.status}：${(await response.text()).slice(0, 400)}`);
    this.sessionId ||= response.headers.get('mcp-session-id');
    if (notification || response.status === 202 || response.status === 204) return {};
    const result = parseRpcText(await response.text(), id);
    if (result.error) throw new Error(result.error.message || 'MCP 請求失敗');
    if (result.id !== id) throw new Error('MCP 回應 ID 不符');
    return result.result;
  }
  async initialize() {
    if (!this.ready) this.ready = (async () => {
      await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'relight-studio', version: '1.0.0' } });
      await this.rpc('notifications/initialized', {}, true);
      let cursor; this.tools = [];
      do { const page = await this.rpc('tools/list', cursor ? { cursor } : {}); this.tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
      for (const name of ['images_relight', 'images_remove_background', 'creations_request_upload', 'creations_finalize_upload', 'creation_status']) this.resolveTool(name);
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  resolveTool(name) {
    const tool = this.tools?.find(t => t.name === name || t.name === 'magnific_' + name);
    if (!tool) throw new Error(`此 Magnific 帳號未提供 ${name} 工具。`);
    return tool.name;
  }
  async call(name, args = {}) {
    await this.initialize();
    return unwrapMcp(await this.rpc('tools/call', { name: this.resolveTool(name), arguments: args }));
  }
  async upload(file, folderReference) {
    const upload = await this.call('creations_request_upload', { mimeType: file.type });
    const item = upload.uploads?.[0] || upload;
    const url = item.proxyUploadUrl || item.uploadUrl || item.url;
    if (!url || !item.path) throw new Error('Magnific 未傳回上傳網址或暫存路徑');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('拒絕非 HTTPS 上傳網址');
    const config = await this.configuration();
    if (!config.upload_relay) throw new Error('圖片傳輸服務尚未設定。');
    let response;
    try {
      response = await fetch(config.upload_relay, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': file.type, Authorization: 'MagnificUpload ' + url }, body: file, signal: AbortSignal.timeout(180000) });
    } catch { throw new Error('無法連接圖片傳輸服務。請稍後按「繼續未完成」重試。'); }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`上傳失敗 (${response.status})：${error.message || '圖片傳輸服務未就緒'}`);
    }
    return creationId(await this.call('creations_finalize_upload', { path: item.path, fileName: file.name || 'image.png', visible: true, ...(folderReference ? { folderReference } : {}) }));
  }
  async waitFor(id, onStatus = () => {}) {
    const start = Date.now();
    while (Date.now() - start < 20 * 60 * 1000) {
      const info = await this.call('creation_status', { creationIdentifier: id });
      const status = String(info.status).toLowerCase();
      if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(status)) { const error = new Error(info.failureReason || 'Magnific 產圖失敗'); error.terminalTask = id; throw error; }
      if (['completed', 'complete', 'done', 'success', 'succeeded', 'ready', 'finished'].includes(status)) {
        const url = info.results?.downloadUrl || info.results?.url;
        if (url) return url;
        const details = await this.call('creations_get', { creationIdentifier: id });
        const asset = details.creation || details;
        const resultUrl = asset.url || asset.downloadUrl || asset.results?.url;
        if (resultUrl) return resultUrl;
        throw new Error('作品已完成，但未取得原尺寸圖片網址。');
      }
      onStatus(info);
      await new Promise(resolve => setTimeout(resolve, Math.max(2, Math.min(15, info.poll_after_seconds || 4)) * 1000));
    }
    throw new Error('等待逾時。工作 ID 已保存，點「繼續未完成」可繼續取得結果，不會重送已建立的產圖工作。');
  }
  async download(url) {
    if (new URL(url).protocol !== 'https:') throw new Error('圖片網址必須使用 HTTPS');
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`下載圖片失敗 (${response.status})`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('下載內容不是圖片');
    return blob;
  }
}
