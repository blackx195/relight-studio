# Relight Studio

繁體中文的批量打光與圖片排版工作台，部署於 GitHub Pages。

網站：https://blackx195.github.io/relight-studio/

## 功能

- Three.js 3D 光向參考、拖曳調整、六個快捷方向；1–4 盞燈，各自設定 Rotate、Elevation、Intensity 與顏色。
- 批量上傳 PNG / JPG / WebP，最多 100 張、單張 25 MB、原圖合計 200 MB。
- Magnific MCP 管線：上傳原圖 → `images_relight` → `images_remove_background` → 下載透明圖。
- 登入後自動載入帳號的 Magnific 專案，支援 TOON 清單、完整分頁與手動重新整理；選取的專案會套用到後續批次的上傳、打光及去背。
- 整批固定使用啟動時的設定，併發 1–3 張或 MAX（全部）。單圖 ↻ 從原圖重產，沿用該圖的上次設定。再次按批量產圖則把目前設定套用到所有圖片。
- 儲存各步驟的工作 ID；中斷後可接續輪詢，不自動重送不確定是否已扣點的請求。
- 上傳共用底圖後自動符合尺寸與比例；列數、欄數、水平／垂直間距、X/Y 位移、留白、縮放、隨機排列。
- 超過格數時自動增加列數；圖片不變形；透明留白會自動裁至主體周圍再排版。
- 合成 PNG、完成的透明單圖 ZIP、完整 `.relight` 專案匯入匯出。
- IndexedDB 本機自動儲存，登入憑證只存此分頁 sessionStorage，不含在專案下載中。

## 目前驗證與登入狀態

本機的 21 項自動測試與正式建置通過。示範素材為使用者提供的六張 PNG：J、鮭魚、Q、飯糰、鯛魚燒與 WILD，保留原始檔案與順序，存放於 `public/demo/`；載入示範不會呼叫 Magnific 或消耗 credits。

已建立公開 OAuth 用戶端，正式網站登入、MCP 工具連線與額度查詢通過實測。登入採 authorization code + PKCE S256，並檢查 state、issuer、有效期限；只有公開 client ID 放入 `public/oauth-config.json`，沒有 API Key、client secret 或帳號 token。

Magnific 的圖片上傳端點未提供 GitHub origin 的 CORS，因此圖片經專用傳輸中介送往 Magnific。中介只接受指定網站 origin 與 Magnific 簽發的短效網址，限制目的地、路徑、有效時間、檔案格式及 25 MB 上限；不接收 OAuth 憑證，不記錄或持久保存圖片，不跟隨轉址。其 6 項測試通過。

傳輸中介：https://relight-studio-transfer-blackx195.blackx1955.chatgpt.site

**官網的 ∞ Unlimited 不適用於此網站。** Magnific 官方規定 API 與 MCP 產圖會消耗 credits，沒有可讓此整合切換為 Unlimited 的參數。若要使用官網 Unlimited，可先在官方網頁完成打光與去背，再把透明結果上傳此站做本機排版及匯出。

計費來源：[Magnific MCP](https://www.magnific.com/ai/docs/magnific-mcp)、[Magnific API](https://www.magnific.com/ai/docs/magnific-api)。

2026-10-29 已在正式網站實測一張素材：上傳 → Relight → 自動去背 → 下載 ZIP 全部成功，下載結果為 2048 × 2048 RGBA PNG，已確認具備透明像素。該次測試消耗 78 credits；這是實測差額，不代表所有設定或未來價格。多圖併發、失敗隔離與工作接續另有自動測試；六張示範素材的排版、底圖比例與專案匯入匯出已實跑。

3D 拖曳與輸入的角度送出時採整數，以符合 Magnific 參數要求。單圖重產保留上次打光設定；舊專案中的小數角度會在送出時取整數。

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
2. 左側預設用首張原圖作為 3D 場景中的圖片參考，可「帶入圖片」另選參考，或切換「石膏像」檢查立體光影。用預覽或數字設定打光，連接並授權自己的 Magnific 帳號。
3. 按「批量打光並去背」。每張產圖與去背會依 Magnific 的規則使用帳號額度。
4. 上傳底圖、設定格數與間距，必要時按隨機排列。X/Y 位移可能讓素材超出畫布並被裁切。
5. 滑鼠移到圖片上按 ↻ 可單張重產，不變動其他圖片；行動裝置直接顯示此按鈕。
6. 匯出合成 PNG 或透明圖 ZIP。尚未完成的圖片在預覽與合成匯出中會使用原圖，並顯示提醒。

中央畫布可切換「原圖／打光後」，比較實際產圖結果；打光後版本已去背。未完成的項目會顯示原圖並標示。比較切換只影響預覽，匯出仍使用打光後結果。原圖比較副本按批次張數限制解碼尺寸，原始檔保留在專案內。

右欄最上方為產圖設定。「同時處理」可選 1、2、3 張或 MAX（全部）；MAX 同時啟動本批所有項目，實際處理速度與排隊由 Magnific 決定。每張仍先打光再去背，單張失敗不會阻擋其他圖片，失敗可由「繼續未完成」處理。

排列方式的列數、欄數、水平／垂直間距與 X／Y 位移，可在數值框內按住滑鼠左鍵上下拖曳：向上增加、向下減少。保留直接輸入與鍵盤上下鍵，拖曳時按 Esc 可取消本次調整。

預設純色底圖為深灰色 `#333333`。既有專案保留原本的自訂色彩。首張素材參考不隨隨機排列改變；移除該素材時改用目前第一張。參考模式與自訂參考圖會保存在本機工作區及下載的專案內。

圖片先留在本機，只有開始產圖時才經傳輸中介上傳 Magnific；自訂底圖與另選的參考圖不傳給 Magnific。原圖會出現在 Magnific 個人或所選專案的作品庫。清理瀏覽器資料可能刪除本機專案，請保留下載備份。

## 預覽模型授權

石膏像採用 Rico Cilliers 製作、Poly Haven 發布的 [Marble Bust 01](https://polyhaven.com/a/marble_bust_01)，授權為 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。保留原模型幾何，去除大理石貼圖，換成霧面石膏材質並包裝為 GLB（約 418 KB）。來源與授權記錄位於 `public/models/LICENSE.txt`。

圖片模式以會受光的平面呈現原圖，保留圖片比例，即時反映燈光方向、顏色、強度與多燈疊加。近距離點光源會讓圖片各處出現不同明暗，背光時正面變暗。這是本機平面光影模擬，不會推算圖片中物件的立體結構，也不會自動送出 AI 產圖或消耗額度。

## 官方參考

- [Magnific Relight 使用說明](https://www.magnific.com/ai/docs/relight)
- [Magnific MCP：OAuth 與工具](https://docs.magnific.com/modelcontextprotocol)
- [REST Relight 與 lightmap](https://docs.magnific.com/api-reference/image-relight/image-relight)

REST Relight 與 MCP 的逐燈角度介面不同；此網站採 MCP，未用提示詞假裝精確角度控制。3D 畫面只供光向參考，生成結果仍由 Magnific 模型決定。
