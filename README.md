# Relight Studio

繁體中文的批量打光與圖片排版工作台，部署於 GitHub Pages。

網站：https://blackx195.github.io/relight-studio/

## 功能

- Three.js 3D 光向參考、拖曳調整、六個快捷方向；1–4 盞燈，各自設定 Rotate、Elevation、Intensity 與顏色。
- 批量上傳 PNG / JPG / WebP，最多 100 張、單張 25 MB、原圖合計 200 MB。
- Magnific MCP 管線：上傳原圖 → `images_relight` → `images_remove_background` → 下載透明圖。
- 整批固定使用啟動時的設定，併發 1–3 張。單圖 ↻ 從原圖重產，沿用該圖的上次設定。再次按批量產圖則把目前設定套用到所有圖片。
- 儲存各步驟的工作 ID；中斷後可接續輪詢，不自動重送不確定是否已扣點的請求。
- 上傳共用底圖後自動符合尺寸與比例；列數、欄數、水平／垂直間距、X/Y 位移、留白、縮放、隨機排列。
- 超過格數時自動增加列數；圖片不變形；透明留白會自動裁至主體周圍再排版。
- 合成 PNG、完成的透明單圖 ZIP、完整 `.relight` 專案匯入匯出。
- IndexedDB 本機自動儲存，登入憑證只存此分頁 sessionStorage，不含在專案下載中。

## 目前驗證與登入狀態

本機的 15 項自動測試與正式建置通過。示範素材為本機 Three.js 渲染，**不是 Magnific 產圖**。

**Magnific OAuth 尚未完成實際連通與付費產圖驗證。** 網站以「Magnific 待設定」明確顯示。首次瀏覽器 OAuth 嘗試在 callback 後收到 HTTP 403；之後為正式網站註冊公開 OAuth 用戶端的動作被自動核准審查拒絕，尚待網站擁有者明確授權。未將任何 API Key、client secret 或帳號 token 放入程式碼。

待擁有者授權後，註冊 `token_endpoint_auth_method: none` 的公開 OAuth 用戶端，限定本網站的回呼網址，把回傳的**公開 client_id** 填入 `public/oauth-config.json`，並確認 token endpoint 的 CORS 允許網站 origin。不能把 confidential client 的 secret 放到此靜態網站。登入採 authorization code + PKCE S256，並檢查 state、issuer、有效期限。

若供應商不允許瀏覽器直接 OAuth/MCP，需加上獨立後端中介；GitHub Pages 本身不執行伺服器程式。不可將「聊天中的 Magnific 連接」視為網站的登入憑證。

## 開發

需求：Node.js 24。

```sh
npm ci
npm test
npm run dev
```

正式建置：`npm run build`，輸出 `dist/`。`base: './'` 支援 GitHub Pages 的儲存庫子路徑。

## 部署

儲存庫 Settings → Pages → Source 設定 **GitHub Actions**。推送 main 後，`.github/workflows/pages.yml` 執行測試、建置與 Pages 部署。

## 使用

1. 先試用示範素材，或上傳多張原圖。
2. 用 3D 預覽或數字設定打光，完成網站登入設定後連接 Magnific。
3. 按「批量打光並去背」。每張產圖與去背會依 Magnific 的規則使用帳號額度。
4. 上傳底圖、設定格數與間距，必要時按隨機排列。X/Y 位移可能讓素材超出畫布並被裁切。
5. 滑鼠移到圖片上按 ↻ 可單張重產，不變動其他圖片；行動裝置直接顯示此按鈕。
6. 匯出合成 PNG 或透明圖 ZIP。尚未完成的圖片在預覽與合成匯出中會使用原圖，並顯示提醒。

圖片留在本機，只有開始產圖時才上傳 Magnific；自訂底圖不傳給 Magnific。原圖會出現在 Magnific 個人或所選專案的作品庫。清理瀏覽器資料可能刪除本機專案，請保留下載備份。

## 官方參考

- [Magnific Relight 使用說明](https://www.magnific.com/ai/docs/relight)
- [Magnific MCP：OAuth 與工具](https://docs.magnific.com/modelcontextprotocol)
- [REST Relight 與 lightmap](https://docs.magnific.com/api-reference/image-relight/image-relight)

REST Relight 與 MCP 的逐燈角度介面不同；此網站採 MCP，未用提示詞假裝精確角度控制。3D 畫面只供光向參考，生成結果仍由 Magnific 模型決定。
