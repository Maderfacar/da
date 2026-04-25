// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs';
export default withNuxt([
  {
    ignores: ['.vscode/**']
  },
  {
    rules: {
      'dot-notation': 'off', // 不強制使用 "."
      'no-console': 'off', // 可以使用 console
      quotes: ['error', 'single'], // 使用引號 double single
      'semi-style': ['error', 'last'], // 强制分号出现在句子末尾。
      'no-extra-semi': 'error', // 禁用不必要的分号。
      semi: ['error', 'always'], // 強制使用分號
      'no-empty-function': 'error', // 禁止空 function
      'no-unused-labels': 'error', // 禁止未使用的標籤
      'no-alert': 'off', // alert、confirm 和 prompt 禁止使用
      'arrow-parens': ['error', 'always'], // ()=>箭頭
      curly: 'off', // 可用 return 簡寫
      '@typescript-eslint/no-unused-vars': 'off', // 不檢查未使用變數
      '@typescript-eslint/no-explicit-any': 'off', // 不檢查 any
      '@typescript-eslint/ban-ts-comment': 'off',
      
      // 不強制自閉合風格（無論是 HTML 或 Vue 自訂元件），避免團隊風格差異帶來噪音
      'vue/html-self-closing': ['error', {
        html: {
          void: 'any',
          normal: 'any',
          component: 'any'
        },
        svg: 'any',
        math: 'any'
      }],
    }
  }
]);


