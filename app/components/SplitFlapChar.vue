<script setup lang="ts">
/**
 * SplitFlapChar — 機場告示牌單字元
 * 結構：靜態上半 / 靜態下半 / 翻轉上半（prev 往下拍）/ 翻轉下半（next 往上揭）
 */
const props = defineProps<{
  char: string
  delay?: number   // ms，序列動畫起始延遲
  cycles?: number  // 落地前隨機翻滾幾個字元，預設 8
}>();

const CHARS   = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+%★/,.';
const FLIP_MS = 130;   // 單次翻轉動畫時長 ms（需與 SCSS $flip-ms 一致）
const GAP_MS  = 28;    // 兩次翻轉之間的靜止間隔 ms

const prevChar    = ref(props.char);
const currentChar = ref(props.char);
const isFlipping  = ref(false);

let queue: string[]                            = [];
let timer: ReturnType<typeof setTimeout> | null = null;

watch(() => props.char, (next, prev) => {
  if (next === prev) return;

  const numCycles = props.cycles ?? 8;
  const newQueue: string[] = [];
  for (let i = 0; i < numCycles; i++) {
    newQueue.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
  }
  newQueue.push(next);

  queue = newQueue;
  if (timer) clearTimeout(timer);
  timer = setTimeout(runQueue, props.delay ?? 0);
});

function runQueue() {
  if (!queue.length) return;
  const next = queue.shift()!;

  prevChar.value    = currentChar.value;
  currentChar.value = next;
  isFlipping.value  = true;

  timer = setTimeout(() => {
    isFlipping.value = false;
    if (queue.length) {
      timer = setTimeout(runQueue, GAP_MS);
    }
  }, FLIP_MS);
}

onUnmounted(() => { if (timer) clearTimeout(timer); });
</script>

<template lang="pug">
.SplitFlapChar
  //- 靜態上半：立即顯示新字元上半
  .SFC__half.SFC__half--top
    .SFC__text {{ currentChar }}

  //- 靜態下半：翻轉中顯示舊字元，結束後顯示新字元
  .SFC__half.SFC__half--bottom
    .SFC__text {{ isFlipping ? prevChar : currentChar }}

  //- 翻轉層 — v-if 保證每次重新掛載，CSS animation 自動重觸發
  template(v-if="isFlipping")
    .SFC__flap.SFC__flap--upper
      .SFC__text {{ prevChar }}
    .SFC__flap.SFC__flap--lower
      .SFC__text {{ currentChar }}

  //- 中央機械縫隙線
  .SFC__gap
</template>

<style lang="scss" scoped>
// ── Token（需與 JS FLIP_MS 同步）─────────────────────────────────────────────
$flip-ms: 130;
$w:       22px;
$h:       36px;
$r:       4px;
$fs:      28px;

.SplitFlapChar {
  position:    relative;
  width:       $w;
  height:      $h;
  display:     inline-block;
  perspective: 260px;
  flex-shrink: 0;
}

// ── 靜態 / 動態共用底色 ──────────────────────────────────────────────────────
.SFC__half,
.SFC__flap {
  position:   absolute;
  width:      100%;
  height:     50%;
  overflow:   hidden;
  background: var(--da-dark, #1a1814);
}

// ── 文字：height 200% = 覆蓋整張卡高，使上下半都能正確裁切 ─────────────────
.SFC__text {
  position:        absolute;
  width:           100%;
  height:          200%;
  display:         flex;
  align-items:     center;
  justify-content: center;
  font-family:     'Bebas Neue', sans-serif;
  font-size:       $fs;
  color:           var(--da-amber-light, #fbbf24);
  letter-spacing:  0.04em;
  line-height:     1;
  user-select:     none;
  white-space:     nowrap;
}

// ── 靜態上半：top=0，顯示文字上半 ──────────────────────────────────────────
.SFC__half--top {
  top:           0;
  border-radius: $r $r 0 0;

  .SFC__text { top: 0; }
}

// ── 靜態下半：bottom=0，text top=-100% 讓文字下半落入視口 ──────────────────
.SFC__half--bottom {
  bottom:        0;
  border-radius: 0 0 $r $r;

  .SFC__text { top: -100%; }
}

// ── 翻轉層 ─────────────────────────────────────────────────────────────────
.SFC__flap {
  z-index:                     5;
  backface-visibility:         hidden;
  -webkit-backface-visibility: hidden;
  transform-style:             preserve-3d;
}

// 舊字元上半往下拍：0° → -90°
.SFC__flap--upper {
  top:              0;
  border-radius:    $r $r 0 0;
  transform-origin: bottom center;
  animation:        sfcFlapDown #{$flip-ms}ms ease-in forwards;

  .SFC__text { top: 0; }
}

// 新字元下半往上揭：90° → 0°（延遲半個翻轉時長，接替上翻的消失）
.SFC__flap--lower {
  bottom:           0;
  border-radius:    0 0 $r $r;
  transform-origin: top center;
  animation:        sfcFlapUp #{$flip-ms}ms ease-out #{$flip-ms * 0.5}ms forwards;

  .SFC__text { top: -100%; }
}

// ── 中央機械縫隙 ───────────────────────────────────────────────────────────
.SFC__gap {
  position:       absolute;
  top:            50%;
  left:           0;
  right:          0;
  height:         1.5px;
  background:     rgba(0, 0, 0, 0.9);
  transform:      translateY(-50%);
  z-index:        10;
  pointer-events: none;
}

// ── Keyframes ──────────────────────────────────────────────────────────────
@keyframes sfcFlapDown {
  0%   { transform: rotateX(0deg);   box-shadow: none; }
  40%  { transform: rotateX(-55deg); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.55); }
  100% { transform: rotateX(-90deg); box-shadow: none; }
}

@keyframes sfcFlapUp {
  0%   { transform: rotateX(90deg); box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.5); }
  100% { transform: rotateX(0deg);  box-shadow: none; }
}
</style>
