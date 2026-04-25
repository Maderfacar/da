# Dockerfile 配置

本專案的實際 `Dockerfile` 位於根目錄，使用 Node 24.11 Alpine 多階段建構。

## 現行 Dockerfile（簡化示意）

```dockerfile
# ===================================================================
# Stage 1: Builder
# ===================================================================
FROM node:24.11-alpine AS builder
WORKDIR /app
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN npm cache clean --force
RUN npm i
RUN npm run build

# 驗證建構產物
RUN test -f .output/server/index.mjs

# ===================================================================
# Stage 2: Production Runner
# ===================================================================
FROM node:24.11-alpine AS runner
COPY --from=builder /app/.output .output
COPY --from=builder /app/version.ts version.ts

ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000

EXPOSE 3000
CMD ["node", "/.output/server/index.mjs"]
```

> 專案 `package.json` 指定 `"node": ">= 24.13.0"`。實際 Dockerfile 使用 `node:24.11-alpine` 為最接近的 Alpine tag；升級基底鏡像時請保持 `>= 24.11` 且能相容 `engines.node`。

## 建構優化建議（可選）

若將來需要更好的 Docker layer 快取，可改為：

```dockerfile
FROM node:24.11-alpine AS builder
WORKDIR /app

# 先複製 package.json，利用 layer 快取
COPY package*.json ./
RUN npm ci

# 再複製其他檔案
COPY . .
RUN npm run build
```

## 啟用後端後的補充

> [!NOTE]
> 下列步驟**僅在專案加入 Prisma / 其他需要 build-time 生成的套件時**才需補回。目前樣板為純前端，**不需要** `npx prisma generate`。

```dockerfile
# 啟用 Prisma 後才需要
COPY prisma ./prisma
RUN npx prisma generate   # 必須在 npm run build 之前

# 運行階段需一併複製（若執行期需要 schema.prisma / migrations）
COPY --from=builder /app/prisma ./prisma
```

若加入其他需要 build-time 的生成指令，亦應補進 Stage 1 並同步 `.dockerignore`。

## 本地測試

```bash
# 建構映像
docker build -t nuxt4-base .

# 運行容器
docker run -p 3000:3000 --env-file .env nuxt4-base
```

## 常見問題

| 症狀 | 檢查點 |
|------|--------|
| `Cannot find module '.output/server/index.mjs'` | 建構階段失敗；確認 `npm run build` 成功 |
| 記憶體不足 | 調整 `NODE_OPTIONS` 或 Railway 資源配額 |
| 映像過大 | 利用 `.dockerignore` 排除 `node_modules`、`.git`、`.nuxt` 等 |
