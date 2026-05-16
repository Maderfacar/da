import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// 單元測試設定。只涵蓋 shared/ 與 server/ 下的純函式（pricing、fare-calculator、geo utils）。
// E2E（tests/e2e/）由 Playwright 跑，明確排除避免 vitest 誤收。
export default defineConfig({
  resolve: {
    alias: {
      '~shared': resolve(__dirname, './shared'),
      '@@': resolve(__dirname, './server'),
    },
  },
  // 專案 tsconfig.json extends ./.nuxt/tsconfig.json，該檔僅在 nuxt prepare/build 後存在。
  // 單元測試不需 Nuxt 型別環境，給 esbuild inline tsconfig 跳過檔案探索。
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        useDefineForClassFields: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.spec.ts', 'server/**/*.spec.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.nuxt/**', '.output/**'],
  },
});
