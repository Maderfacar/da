# 專案目錄結構 (Folder Structure)

> ⚠️ **適配說明**：原始規格為 Nuxt 3（根目錄 pages/components/stores）。Nuxt 4 使用 `app/` 目錄架構，已全面適配。

## 完整目錄結構

```
cc_da/                                 # 專案根目錄
├── .env.dev                           # 開發環境變數（禁止 commit）
├── .gitignore
├── CLAUDE.md                          # Claude Code 規則（最高優先）
├── nuxt.config.ts
├── tsconfig.json
├── package.json
├── version.ts
│
├── docs/                              # 業務規格文件（專案大腦）
│   ├── prd.md                         # 專案需求
│   ├── tech-stack.md                  # 技術棧
│   ├── style-guide.md                 # 設計規範
│   ├── folder-structure.md            # 本文件
│   ├── roadmap.md                     # 開發階段
│   ├── tasks.md                       # 任務清單
│   ├── decision-log.md                # 技術決策記錄
│   ├── git-workflow.md                # Git 規範
│   ├── naming-conventions.md          # 命名規範
│   ├── api-contracts.md               # API 型別定義
│   └── testing-strategy.md            # 測試策略
│
├── app/                               # Nuxt 4 應用程式核心
│   ├── assets/
│   │   ├── icons/                     # 自訂 SVG icon（@my-icon 前綴）
│   │   └── styles/
│   │       ├── css-class/             # 全局 CSS
│   │       └── scss-tool/             # SCSS 工具（config/colors/mixin 等）
│   │
│   ├── components/
│   │   ├── ui/                        # 原子元件（UiButton、UiCard 等）- 純 UI + Tailwind
│   │   ├── passenger/                 # 乘客端專用（PassengerXXX）
│   │   ├── driver/                    # 司機端專用（DriverXXX）
│   │   ├── admin/                     # 管理者端專用（AdminXXX）
│   │   ├── common/                    # 共用業務元件（CommonXXX）
│   │   ├── el/                        # Element Plus 擴展元件
│   │   ├── open/                      # 彈窗元件（OpenDialogXXX）
│   │   ├── loading/                   # 加載元件
│   │   └── demo/                      # 開發展示用
│   │
│   ├── composables/
│   │   ├── app/                       # 業務 composable
│   │   ├── system/                    # 系統 composable
│   │   └── tool/                      # 工具 composable
│   │
│   ├── layouts/                       # Nuxt 佈局（乘客/司機/管理者三端）
│   ├── middleware/                    # 路由守衛（auth、role）
│   ├── pages/
│   │   ├── index.vue                  # 首頁跳轉邏輯
│   │   ├── home/index.vue             # 乘客首頁
│   │   ├── booking/index.vue          # 叫車預訂
│   │   ├── orders/index.vue           # 訂單列表
│   │   ├── profile/index.vue          # 個人資料
│   │   ├── driver/
│   │   │   ├── auth/index.vue         # 司機登入驗證
│   │   │   ├── pending/index.vue      # 司機待命
│   │   │   ├── dashboard/index.vue    # 司機儀表板
│   │   │   └── trip/index.vue         # 行程執行中
│   │   ├── admin/
│   │   │   ├── war-room/index.vue     # 管理員作戰室
│   │   │   ├── orders/index.vue       # 後台訂單管理
│   │   │   └── notifications/index.vue
│   │   └── demo/                      # 開發展示（不上生產）
│   │
│   ├── plugins/
│   │   └── auth.client.ts             # Firebase Auth 初始化（client-only）
│   │
│   ├── protocol/fetch-api/            # API 定義層（$api 工具）
│   ├── stores/
│   │   ├── 0.store-env.ts             # StoreEnv
│   │   ├── 1.store-tool.ts            # StoreTool
│   │   ├── 2.store-theme.ts           # StoreTheme
│   │   ├── 3.store-self.ts            # StoreSelf
│   │   ├── 4.store-open.ts            # StoreOpen
│   │   ├── 5.store-auth.ts            # StoreAuth（Firebase + LIFF）
│   │   ├── 6.store-trip.ts            # StoreTrip（司機狀態機）
│   │   └── 7.store-order.ts           # StoreOrder（乘客訂單）
│   │
│   └── utils/                         # 全局工具（$api/$dayjs/$tool 等）
│
├── server/
│   ├── api/                           # BFF 端點（外部 API 代理）
│   │   ├── maps/distance.get.ts       # Google Maps 車程代理
│   │   ├── flight/status.get.ts       # 航班狀態代理
│   │   └── trip/sync.post.ts          # 司機 GPS 離線同步
│   └── routes/nuxt-api/               # 內部業務 API 路由
│       └── tinymce/upload.post.ts
│
├── i18n/locales/                      # 多語系（zh.js / en.js / ja.js）
├── types/                             # 全局 TypeScript 型別定義
├── shared/                            # 前後端共享程式碼（~shared 別名）
└── public/                            # 靜態資源
```

## 命名規則

- **目錄**：小寫 + 連字符（`war-room`、`fetch-api`）
- **Vue 元件**：PascalCase（`UiButton.vue`、`PassengerOrderForm.vue`）
- **TypeScript 檔案**：camelCase（`useOrder.ts`、`orderUtils.ts`）
- **Store 檔案**：數字前綴 + store 後綴（`5.store-auth.ts`）

## 禁止事項

- 禁止擅自在 `app/components/` 建立三層以上的嵌套
- 禁止把後端邏輯寫在 `pages/` 或 `components/`
- 任何目錄結構變更必須先更新本文件並記錄在 `decision-log.md`

---

**版本紀錄**
- 版本：v1.2（完全適配 Nuxt 4 app/ 架構，反映 Stage 1 實際結構）
- 更新日期：2026/04/26
