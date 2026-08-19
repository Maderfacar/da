// server 端的 configStr 入口。實作在 shared/config-str.ts —— client 端（app/stores）
// 也要讀同一批純數字設定，不能只放在 server/。此處只轉出，勿在這裡另寫一份。
export { configStr } from '~shared/config-str';
