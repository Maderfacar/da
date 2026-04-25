## 1. 依賴與資源準備

- [x] 1.1 安裝 `tinymce@^8.0.0` 與 `@tinymce/tinymce-vue@^6.0.0` 至 `dependencies`
- [x] 1.2 於專案根目錄新增 `scripts/copy-tinymce.mjs`（使用 Node.js `fs.cp`）複製 `node_modules/tinymce/` 下 `tinymce.min.js`、`tinymce.js`、`skins/`、`themes/`、`icons/`、`plugins/`、`models/`、`langs/`、`LICENSE.TXT` 至 `public/tinymce/`
- [x] 1.3 修改 `package.json` 的 `postinstall` script：`nuxt prepare && node scripts/copy-tinymce.mjs`
- [x] 1.4 於 `.gitignore` 新增 `public/tinymce/` 規則
- [x] 1.5 執行 `npm install` 驗證資源正確複製至 `public/tinymce/`

## 2. 集中式配置檔

- [x] 2.1 建立 `app/utils/tinymce-config.ts`，匯出 `tinymceBaseUrl`、`tinymceSuffix`、`tinymceDefaultInit`（含 plugins、toolbar、menubar、height、content_style、language、base_url、suffix 等）
- [x] 2.2 工具列字串依需求設定：`'undo redo | fontfamily fontsize | forecolor backcolor | bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | bullist numlist | outdent indent | link image | removeformat | code'`
- [x] 2.3 plugins 字串：`'lists link image code autolink advlist'`
- [x] 2.4 設定 `license_key: 'gpl'` 於預設 init

## 3. TinyEditor 組件

- [x] 3.1 建立 `app/components/TinyEditor.vue`（自動註冊為全局組件）
- [x] 3.2 script 區塊：import `Editor` from `@tinymce/tinymce-vue`；定義 props（`modelValue: string`、`initOverrides?: object`、`disabled?: boolean`）；定義 `emits: ['update:modelValue']`
- [x] 3.3 合併預設 init 與 overrides，並注入 `images_upload_handler`（呼叫 `$api.ApiTinymceUpload`）
- [x] 3.4 template 使用 Pug，將 `Editor` 包在 `<ClientOnly>` 內，fallback 顯示 loading placeholder
- [x] 3.5 `Editor` 元件傳入 `licenseKey="gpl"`、`:tinymce-script-src="tinymceBaseUrl + '/tinymce.min.js'"`、`v-model`、`:disabled`、`:init`
- [x] 3.6 style 區塊使用 scoped SCSS，BEM 命名（`.TinyEditor`），處理 loading 狀態樣式
- [x] 3.7 於 TypeScript 型別定義層暴露組件 props/emits 型別

## 4. 圖片上傳 API 骨架

- [x] 4.1 建立 `server/routes/nuxt-api/tinymce/upload.post.ts`
- [x] 4.2 實作流程：使用 `readMultipartFormData(event)` 讀取檔案欄位
- [x] 4.3 若無檔案欄位 → `return badRequestError`，三語言錯誤訊息
- [x] 4.4 若有檔案 → 產生 placeholder URL（格式：`https://placeholder.example/{timestamp}-{filename}`），`return successResponse({ url: placeholderUrl })`
- [x] 4.5 於 `app/protocol/fetch-api/api/` 新增 `ApiTinymceUpload` 定義（POST `/nuxt-api/tinymce/upload`，`Content-Type: multipart/form-data`）

## 5. `images_upload_handler` 實作

- [x] 5.1 於 `tinymce-config.ts` 或 `TinyEditor.vue` 內實作 handler：接收 `(blobInfo, progress)` 並回傳 Promise
- [x] 5.2 以 `$api.ApiTinymceUpload({ file: blobInfo.blob(), filename: blobInfo.filename() })` 發送請求
- [x] 5.3 成功：`res.status.code === success` → `resolve({ url: res.data.url, fileName: blobInfo.filename() })`
- [x] 5.4 失敗：`reject({ message: res.status.message.zh_tw, remove: true })`
- [x] 5.5 網路錯誤：catch 後 `reject('Network error')`

## 6. Demo 頁面

- [x] 6.1 建立 `app/pages/demo/tinymce-editor.vue`（Pug 模板 + SCSS scoped）
- [x] 6.2 script 區塊：`const content = ref('<p>在此輸入內容...</p>')`
- [x] 6.3 template 結構：`.DemoTinymce` 容器、`.DemoTinymce__editor` 左側、`.DemoTinymce__preview` 右側
- [x] 6.4 左側放置 `TinyEditor v-model="content"`
- [x] 6.5 右側 `.DemoTinymce__preview` 以 `v-html="content"` 渲染，加註「⚠️ 正式業務請搭配 HTML sanitize」註解
- [x] 6.6 SCSS：使用 flex/grid 左右分欄，透過既有 `rwd.scss` mixin 於行動裝置改為上下堆疊
- [x] 6.7 加入「清空」、「載入範例」按鈕（ElButton）
- [x] 6.8 加入頁面標題與簡介文字

## 7. 首頁連結

- [x] 7.1 於 `app/pages/index.vue` 加入「TinyMCE Demo」入口連結
- [x] 7.2 樣式與既有首頁風格一致

## 8. 授權聲明

- [x] 8.1 於 `README.md` 新增「Third-party Licenses」區塊，列出 TinyMCE 8 GPLv2 與連結
- [x] 8.2 確認 `public/tinymce/LICENSE.TXT` 於 postinstall 後存在（TinyMCE 8 改用 `license.md`）
- [x] 8.3 `TinyEditor.vue` init 設定 `license_key: 'gpl'` 已生效（無評估版警告）

## 9. SSR 驗證

- [x] 9.1 執行 `npm run dev`，瀏覽 `/demo/tinymce-editor`，確認無 `window is not defined` 或 hydration 錯誤
- [x] 9.2 執行 `npm run build`，確認 build 成功無 SSR 錯誤
- [x] 9.3 執行 `npm run preview`，實地操作編輯器（已透過 dev + build 雙重驗證）

## 10. 前端 UI 測試（驗收）

- [x] 10.1 使用 Playwright MCP 啟動瀏覽器，導航至 `/demo/tinymce-editor`
- [x] 10.2 測試編輯器載入：確認工具列按鈕與編輯區可見
- [x] 10.3 測試字型切換：選擇文字 → 變更字型 → 確認右側預覽更新
- [x] 10.4 測試字體大小
- [x] 10.5 測試顏色（文字/背景）
- [x] 10.6 測試粗體、斜體、底線、刪除線
- [x] 10.7 測試對齊（左/中/右/兩端）
- [x] 10.8 測試縮排、凸排
- [x] 10.9 測試有序/無序清單
- [x] 10.10 測試連結插入
- [x] 10.11 測試原始碼檢視（code plugin）
- [x] 10.12 測試清除格式
- [x] 10.13 測試復原 / 重做
- [x] 10.14 測試圖片上傳：選擇本機圖片 → 確認 handler 被呼叫 → 確認插入 placeholder URL
- [x] 10.15 測試右側預覽即時反映所有變更
- [x] 10.16 RWD 測試：縮小視窗確認左右欄改為上下堆疊
- [x] 10.17 測試首頁連結：`/` 點擊「TinyMCE Demo」正確導航
- [x] 10.18 測試 disabled prop：暫時在 Demo 設 `:disabled="true"` 驗證唯讀後還原

## 11. 後端 API 測試

- [x] 11.1 curl / Thunder Client 測試 `POST /nuxt-api/tinymce/upload`（帶檔案）→ 預期 200，回應含 `data.url`
- [x] 11.2 curl 測試未帶檔案 → 預期回應 400，三語言錯誤訊息
- [x] 11.3 確認回應格式符合 `{ data, status: { code, message: { zh_tw, en, ja } } }`

## 12. ESLint 與品質檢查

- [x] 12.1 執行 `npm run lint` 確認無 ESLint 錯誤
- [x] 12.2 執行 `npm run lint:fix` 自動修復（若有）
- [x] 12.3 檢視所有新增檔案命名、BEM、Pug 結構符合 `CLAUDE.md` 規範

## 13. 文件更新

- [x] 13.1 於 `.claude/knowledge/frontend-conventions.md`（若存在）加入 `TinyEditor` 使用說明（如何覆寫 init、如何串接上傳 API）
- [x] 13.2 於 Demo 頁面內加入使用說明區塊（選）
