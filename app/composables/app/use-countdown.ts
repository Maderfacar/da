/**
 * useCountdown — Wave 2B+2C
 *
 * 給定目標 ISO 時間字串（reactive），每秒回傳一個 reactive {
 *   remainingSeconds: 還剩多少秒（≥0；過了顯 0），
 *   isExpired: 是否已到期（remainingSeconds === 0），
 *   text: 格式化文字（M:SS 或 H:MM:SS）
 * }
 *
 * 使用情境：司機端訂單卡顯示「倒數 X 後將開放給更多司機」。
 *  - target=null（舊單 / 終態 currentLevel='0'）→ remainingSeconds=null + isExpired=false
 *  - 過了 0 → UI 顯示「即將降級」並等下次 GET 觸發 lazy
 *
 * 注意：unmount 時自動清 interval；setup 在 SSR 環境也 safe（只在 onMounted 啟 interval）。
 */

import type { Ref } from 'vue';

export interface CountdownResult {
  remainingSeconds: Ref<number | null>;
  isExpired: Ref<boolean>;
  text: Ref<string>;
}

const _pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

const _format = (secs: number): string => {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${_pad2(m)}:${_pad2(s)}`;
  return `${m}:${_pad2(s)}`;
};

export function useCountdown(targetIso: Ref<string | null>): CountdownResult {
  const remainingSeconds = ref<number | null>(null);
  const isExpired = ref(false);
  const text = ref('');

  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    const iso = targetIso.value;
    if (!iso) {
      remainingSeconds.value = null;
      isExpired.value = false;
      text.value = '';
      return;
    }
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) {
      remainingSeconds.value = null;
      isExpired.value = false;
      text.value = '';
      return;
    }
    const diff = Math.max(0, Math.floor((t - Date.now()) / 1000));
    remainingSeconds.value = diff;
    isExpired.value = diff === 0;
    text.value = _format(diff);
  };

  const start = () => {
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1000);
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  onMounted(start);
  onBeforeUnmount(stop);

  // target 變動時重新對齊
  watch(targetIso, () => {
    tick();
  });

  return { remainingSeconds, isExpired, text };
}
