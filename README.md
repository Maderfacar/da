# Nuxt 4 Base

企業級 Nuxt 4 前端框架樣板，使用 Vue 3 Composition API + TypeScript + Element Plus + Pinia。

專案規範詳見 [`CLAUDE.md`](./CLAUDE.md) 與 [`.claude/knowledge/`](./.claude/knowledge/)。

## 開發

```bash
npm install   # 安裝依賴（會自動複製 TinyMCE 靜態資源至 public/tinymce/）
npm run dev   # 開發伺服器（port 3000）
npm run build # 生產構建
npm run preview
npm run lint
```

Node.js 版本需求：`>= 24.13.0`。

## Third-party Licenses

本專案使用下列第三方套件，請遵守其授權條款：

| 套件 | 版本 | 授權 | 備註 |
|------|------|------|------|
| [TinyMCE](https://github.com/tinymce/tinymce) | ^8.x | GPLv2 | Self-hosted，隨 `npm install` 自動複製至 `public/tinymce/`，完整授權條款見 `public/tinymce/license.md` |
| [@tinymce/tinymce-vue](https://github.com/tinymce/tinymce-vue) | ^6.x | Apache-2.0 | 官方 Vue 3 wrapper |

> **GPLv2 說明**：TinyMCE 採 GPLv2 授權，若專案需對外分發（distribute binary/source），可能觸發 copyleft 要求。本樣板預設用於內部系統或 SaaS 情境；若業務情境涉及外部分發，請評估授權合規或改用商業版 TinyMCE。
