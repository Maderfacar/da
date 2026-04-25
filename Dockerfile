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

# 驗證構建產物
RUN test -f .output/server/index.mjs

# ===================================================================
# Stage 2: Production Runner
# ===================================================================
FROM node:24.11-alpine AS runner
COPY --from=builder /app/.output .output
COPY --from=builder /app/version.ts version.ts

# 環境變數
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000

EXPOSE 3000

# 啟動應用
CMD ["node", "/.output/server/index.mjs"]
