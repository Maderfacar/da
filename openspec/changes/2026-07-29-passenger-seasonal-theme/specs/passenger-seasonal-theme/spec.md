## ADDED Requirements

### Requirement: 主題預設包資料模型
系統 SHALL 以 Firestore collection `site_themes/{themeId}` 儲存每一套主題包，每筆包含 `name`（三語）、`tokens`（`--da-*` hex 覆寫，`Partial`）、`hero`（背景圖/斜紋色/tag 色）、`enabled`、`sortOrder`、`isDefault`。系統 SHALL 另存單一 config doc `site_config/theme = { activeThemeId }` 作為手動切換指標。

可被覆寫的 token 限定於 `DA_THEME_TOKEN_KEYS` 白名單（對齊 `_theme-colors.css` 的 `--da-*`）；未列於白名單的變數不可由主題覆寫。

#### Scenario: 首次讀取自動 seed
- **WHEN** `site_themes` 為空或 `site_config/theme` 缺失
- **THEN** 系統寫入 `DEFAULT_SITE_THEMES`（含 `default` + 節日包）與 `{ activeThemeId: 'default' }`
- **AND** `default` 主題 `isDefault=true` 且色值等於現行 `_theme-colors.css` 的 `--da-*`

#### Scenario: hex 色值驗證
- **WHEN** 任一 theme 的 `tokens` 值不符 `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`
- **THEN** 該值視為無效，不得寫入 / 不得注入

### Requirement: 生效主題解析
系統 SHALL 提供 `resolveActiveTheme(db)`，回傳合併後的 `ResolvedTheme`：以 `default` 主題 tokens 為底、疊上 active 主題 tokens（保證每個白名單 key 都有值）。

#### Scenario: active 主題停用時 fallback
- **WHEN** `activeThemeId` 指向不存在或 `enabled=false` 的主題
- **THEN** 回傳 `isDefault` 主題的解析結果

#### Scenario: 缺項 fallback default
- **WHEN** active 主題只覆寫部分 token
- **THEN** 未覆寫的 token 取 `default` 主題值，`ResolvedTheme.tokens` 為完整 record

### Requirement: 公開讀取端點
系統 SHALL 提供公開 `GET /nuxt-api/config/theme`，回傳當前 `ResolvedTheme`，供乘客端 SSR 與 client 讀取，並套用短 TTL 快取。

#### Scenario: 回傳生效主題
- **WHEN** 乘客端請求 `/nuxt-api/config/theme`
- **THEN** 回 200 + `successResponse(ResolvedTheme)`（含 tokens 完整 record 與 hero）

### Requirement: FOUC-free SSR 注入且只作用乘客端
系統 SHALL 於乘客 layout（`front-desk` / `marketing`）在 SSR 階段將生效主題以 scoped `<style>` 注入，選擇器為 `[data-da-theme]`（非 `:root`）。司機 layout 與 admin（back-desk）layout MUST NOT 掛 `data-da-theme`，因此不受換季影響。

#### Scenario: 首頁 SSR 無閃色
- **WHEN** 未登入訪客首次載入乘客首頁
- **THEN** SSR 回應的 HTML 已含 `<style id="da-theme-vars">` 與正確 token 值
- **AND** client hydration 讀 payload、不重新請求、不發生 FOUC

#### Scenario: admin/driver 端不被染色
- **WHEN** 生效主題為任一節日包
- **THEN** admin 端與司機端頁面的 `--da-*` 仍取 `:root` 預設值，外觀不變

### Requirement: 後端手動切換
系統 SHALL 提供 admin 端點切換生效主題與啟用/停用主題，限 super 權限，切換須寫 audit log。首發**不提供**日期自動排程與自由色票編輯。

#### Scenario: 切換生效主題
- **WHEN** super 呼叫 `PUT /nuxt-api/admin/config/theme/active { activeThemeId }` 指向一個 enabled 主題
- **THEN** 更新 `site_config/theme.activeThemeId` + 寫 audit `site_theme.switch`
- **AND** 乘客端於快取 TTL 內換色

#### Scenario: 不可切到停用主題
- **WHEN** 目標主題 `enabled=false`
- **THEN** 回 400，不更新指標

### Requirement: Hero 主視覺隨主題切換（L2）
系統 SHALL 讓乘客首頁 Hero 的背景圖、斜紋色、tag 強調色綁定生效主題的 `hero.*`（透過注入的 `--da-hero-*` 變數），缺省時 fallback 至現行寫死值。

#### Scenario: default 主題維持現況
- **WHEN** 生效主題為 `default`（`hero.bgImage` 留空）
- **THEN** 首頁 Hero 呈現現行純色背景與現行斜紋色，與導入本系統前一致

#### Scenario: 節日主題換 Hero 主圖
- **WHEN** 生效主題提供 `hero.bgImage`
- **THEN** 首頁 Hero 以該圖為背景，斜紋/tag 色套該主題設定
