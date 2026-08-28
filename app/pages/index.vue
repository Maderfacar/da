<script setup lang="ts">
// PageIndex — 行銷 Landing（W1 AEO，2026-06-25）
//
// 為什麼這頁需要 SSR + 完整內容？
//   前身：layout:false / ssr:false / 空白 .PageIndex —— AI 爬蟲拿到 0 字內容。
//   現況：改用 marketing layout（不依賴 authResolved）+ 預設 SSR + 完整 hero/coverage/features/CTA。
//   未登入訪客：SSR 渲染完整行銷頁面（爬蟲與真實用戶皆可讀）。
//   已登入訪客：hydrate 後 watch 觸發 client-side redirect 至對應角色 home（hero 閃過一瞬）。
//
// Auth 安全性：
//   - middleware/role.ts:34 `if (!authResolved) return` —— SSR 時 plugin auth.client.ts 不跑、
//     authResolved=false → role middleware SSR 早退，不會 server-side redirect。
//   - middleware/auth.ts:22 isPublicRoute('/')=true → skip。
//   - components/common/CommonBootGate.vue:23 公開路由 skip await → 不卡 12s splash。
//   - 本頁 watch handler 第一行 `if (!authStore.authResolved || !authStore.isSignIn) return`
//     —— SSR 與未登入用戶都直接 early return，navigateTo 永不在不該跑的場景觸發。
//
// 詳見 W0 偵察結論（commit message 與 PR description）。

import { resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';
import { readEntryIntent, rememberEntryIntent } from '~shared/auth/entry-intent';
import { MakeRouteExists } from '~/utils/route-exists';

definePageMeta({ layout: 'marketing', middleware: ['role'] });

const { t } = useI18n();
const authStore = StoreAuth();
const route = useRoute();
const _routeExists = MakeRouteExists(useRouter());

// ── SEO/AEO meta（W1）─────────────────────────────────────
// 三語對齊 i18n.locale；useSeoMeta 自動補 og:title/og:description fallback。
useSeoMeta({
  title: () => t('landing.meta.title'),
  description: () => t('landing.meta.description'),
  ogType: 'website',
  ogTitle: () => t('landing.meta.title'),
  ogDescription: () => t('landing.meta.description'),
  ogImageAlt: () => t('landing.meta.ogImageAlt'),
  twitterCard: 'summary_large_image',
});

// ── Schema.org JSON-LD（W3，SSR fix 2026-06-25）─────────
// 三個 schema 並排：Organization（公司基本資訊）+ LocalBusiness（地理 NAP）+
// TransportationService（服務型別）。給 AI Overview / Perplexity / ChatGPT
// 等 answer engine 結構化解析，提升被引用機率。
//
// SSR fix：原本用 `script: () => [...]` 函式形式 + `children` 欄位，view-source
// 抓不到 <script type="application/ld+json">。改用同步陣列 + `innerHTML` 欄位，
// 對齊 Nuxt 官方 JSON-LD 範例（Unhead v1+ 兩種欄位都支援，innerHTML 較保險）。
// Trade-off：locale 切換時 JSON-LD 不會 reactive 更新；但 SSR 各 locale URL（/en/, /ja/）
// setup 時 t() 已綁定當下 locale，crawler 看的 initial render 仍是正確語系。
const _siteConfig = useRuntimeConfig();
const _siteUrl = (_siteConfig.public.siteUrl as string) || 'https://da-line-liff-app.vercel.app';
const _orgLd = JSON.stringify(buildOrganizationLd(_siteUrl, t));
const _localBizLd = JSON.stringify(buildLocalBusinessLd(_siteUrl, t));
const _transServiceLd = JSON.stringify(buildTransportationServiceLd(_siteUrl, t));
useHead({
  script: [
    { type: 'application/ld+json', innerHTML: _orgLd },
    { type: 'application/ld+json', innerHTML: _localBizLd },
    { type: 'application/ld+json', innerHTML: _transServiceLd },
  ],
});

// ── 已登入者 client-side redirect（既有行為，未動）──────────
// 為何 page 內仍保留 watch？
//   race：URL=/ 進站，plugin/auth.client 的 InitAuthFlow 跑完前 middleware 先跑、
//   此時 authResolved=false → middleware early return；之後 authResolved 變 true 時
//   router 沒有 navigation event → middleware 不會重跑 → user 卡在本頁。
//   解法：watch authResolved + isSignIn，用 utils 算同個 target 兜底（同 SSOT 不分歧）。
watch(
  () => [authStore.authResolved, authStore.isSignIn, authStore.roles.join(','), authStore.approved],
  () => {
    if (!authStore.authResolved || !authStore.isSignIn) return;
    // 優先序 1：LIFF OAuth callback 目標
    // 2026-08-17：URL 被 stripDeepLinkParams 剝掉後改讀 entry-intent，
    // 否則此兜底 watch 會在 LIFF init 完成後把正確目標蓋成角色預設
    const liffTarget = resolveLiffTarget({
      query: route.query as Record<string, string | string[] | null | undefined>,
      pathname: typeof window === 'undefined' ? undefined : window.location.pathname,
    });
    // 2026-08-29：與 middleware/role 同一道防護 —— 深連結目標若沒有對應頁面就不採用。
    // 這個 watch 是 middleware 的兜底，兩邊都得擋，否則死路由會從這裡漏過去。
    if (liffTarget) rememberEntryIntent(liffTarget, Date.now(), _routeExists);
    const intent = readEntryIntent(Date.now(), _routeExists);
    const liveLiffTarget = liffTarget && _routeExists(liffTarget) ? liffTarget : '';
    const effectiveTarget = liveLiffTarget || intent?.target || '';
    if (effectiveTarget && effectiveTarget !== route.path) {
      navigateTo(effectiveTarget, { replace: true });
      return;
    }
    // 優先序 2：依角色算目標（與 middleware/role.ts 共用 utils）
    const target = resolveAuthTarget({
      entryPath: route.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
      entryEnd: intent?.end,
    });
    if (target && target !== route.path) {
      navigateTo(target, { replace: true });
    }
  },
  { immediate: true },
);

const AIRPORT_CODES = ['tpe', 'tsa', 'rmq', 'khh'] as const;
const FEATURE_IDS = ['flight', 'transparent', 'service', 'professional'] as const;

// 提案首頁規則二：訂車卡壓在 hero 下緣 —— 品牌看完，手指剛好落在「要去哪裡」上。
// 服務類型在這裡先選好，帶 ?type= 進 /booking 直接預選第一步。
const BOOK_TYPES = ['airport-pickup', 'airport-dropoff', 'charter'] as const;
const bookType = ref<(typeof BOOK_TYPES)[number]>('airport-pickup');
const TRUST_KEYS = ['hours', 'airports', 'insurance'] as const;

const ClickBook = () => navigateTo(`/booking?type=${bookType.value}`);
const ClickFare = () => navigateTo('/fare');
</script>

<template lang="pug">
.PageLanding
  //- ── HERO ─────────────────────────────────────────────────────
  section.PageLanding__hero
    .PageLanding__hero-bg
    .PageLanding__hero-runway

    .PageLanding__hero-inner
      p.PageLanding__hero-tag {{ $t('landing.hero.tag') }}
      h1.PageLanding__hero-title
        span.PageLanding__hero-title-display
          | {{ $t('landing.hero.titleA') }}
          br
          | {{ $t('landing.hero.titleB') }}
        span.PageLanding__hero-title-sub {{ $t('landing.hero.subtitle') }}

  //- ── 訂車卡：疊在 hero 下緣，全頁唯一有陰影的東西（提案規則二）────
  //- 它在說「從這裡開始」。地點與時間在 /booking 填，這裡只先決定服務類型。
  .PageLanding__booklane
    .PageLanding__bookcard
      .PageLanding__booktypes(role="tablist")
        button.PageLanding__booktype(
          v-for="t in BOOK_TYPES"
          :key="t"
          type="button"
          role="tab"
          :aria-selected="bookType === t"
          :class="{ 'is-active': bookType === t }"
          @click="bookType = t"
        ) {{ $t(`landing.book.types.${t}`) }}

      .PageLanding__bookfields
        .PageLanding__bookfield
          span.PageLanding__bookfield-label {{ $t('landing.book.from') }}
          span.PageLanding__bookfield-value {{ $t(`landing.book.fromHint.${bookType}`) }}
        .PageLanding__bookfield
          span.PageLanding__bookfield-label {{ $t('landing.book.to') }}
          span.PageLanding__bookfield-value.is-placeholder {{ $t('landing.book.toHint') }}
        .PageLanding__bookfield
          span.PageLanding__bookfield-label {{ $t('landing.book.when') }}
          span.PageLanding__bookfield-value.is-placeholder {{ $t('landing.book.whenHint') }}

      button.PageLanding__bookcta(type="button" @click="ClickBook")
        | {{ $t('landing.book.cta') }}
        span.PageLanding__bookcta-arrow →
      p.PageLanding__bookhint {{ $t('landing.book.hint') }}

    //- 信任條：三格，用細線切不用卡片（提案規則三：行銷降成資訊層）
    .PageLanding__trust
      .PageLanding__trust-cell(v-for="k in TRUST_KEYS" :key="k")
        span.PageLanding__trust-value {{ $t(`landing.trust.${k}.value`) }}
        span.PageLanding__trust-label {{ $t(`landing.trust.${k}.label`) }}

  //- ── 斜紋分隔（黃黑跑道意象，與 /home /faq 風格一致）─────────────
  .PageLanding__stripe

  //- ── SERVICE OVERVIEW ────────────────────────────────────────
  section.PageLanding__section.is-overview
    .PageLanding__section-head
      .PageLanding__section-label {{ $t('landing.overview.label') }}
      h2.PageLanding__section-title {{ $t('landing.overview.heading') }}
    .PageLanding__overview-body
      p {{ $t('landing.overview.p1') }}
      p {{ $t('landing.overview.p2') }}

  //- ── COVERAGE：4 airports ───────────────────────────────────
  section.PageLanding__section.is-coverage
    .PageLanding__section-head
      .PageLanding__section-label {{ $t('landing.coverage.label') }}
      h2.PageLanding__section-title {{ $t('landing.coverage.title') }}
    p.PageLanding__section-desc {{ $t('landing.coverage.desc') }}
    //- 提案規則三：行銷內容從「章節」降成「列」—— 內容全保留，只是不再做成卡片方塊。
    .PageLanding__airports
      article.PageLanding__airport(v-for="code in AIRPORT_CODES" :key="code")
        .PageLanding__airport-code {{ $t(`landing.coverage.airports.${code}.code`) }}
        .PageLanding__airport-text
          h3.PageLanding__airport-name {{ $t(`landing.coverage.airports.${code}.name`) }}
          p.PageLanding__airport-desc {{ $t(`landing.coverage.airports.${code}.desc`) }}

  .PageLanding__stripe

  //- ── FEATURES：4 cards ─────────────────────────────────────
  section.PageLanding__section.is-features
    .PageLanding__section-head
      .PageLanding__section-label {{ $t('landing.features.label') }}
      h2.PageLanding__section-title {{ $t('landing.features.title') }}
    //- 同上：理由也降成列，編號 + 細線，安靜到底。
    .PageLanding__features
      article.PageLanding__feature(v-for="(id, i) in FEATURE_IDS" :key="id")
        span.PageLanding__feature-no {{ String(i + 1).padStart(2, '0') }}
        .PageLanding__feature-text
          h3.PageLanding__feature-title {{ $t(`landing.features.items.${id}.title`) }}
          p.PageLanding__feature-body {{ $t(`landing.features.items.${id}.body`) }}

  //- ── FINAL CTA ──────────────────────────────────────────────
  section.PageLanding__cta-section
    .PageLanding__cta-card
      .PageLanding__cta-label {{ $t('landing.cta.label') }}
      h2.PageLanding__cta-title {{ $t('landing.cta.title') }}
      p.PageLanding__cta-desc {{ $t('landing.cta.desc') }}
      button.PageLanding__cta-btn(type="button" @click="ClickBook")
        | {{ $t('landing.cta.btn') }}
        span.PageLanding__cta-btn-arrow →
</template>

<style lang="scss" scoped>

.PageLanding {
  background: var(--da-off-white);
  color: var(--da-dark);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

// ── HERO ────────────────────────────────────────────────────
/* 提案規則一：hero 只佔四成 —— 品牌需要一個安靜的開場，但它不該吃掉整個第一屏，
   剩下的留給要動手的東西（訂車卡）。原本是 100svh，整屏都是品牌。
   下界 320px 是為了小螢幕上 tag + 標題 + 副標不被壓爛；上界避免大桌機拉太空。 */
.PageLanding__hero {
  position: relative;
  min-height: clamp(320px, 44svh, 560px);
  padding-top: 56px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding-bottom: var(--space-xl);
  overflow: hidden;
}

.PageLanding__hero-bg {
  position: absolute;
  inset: 0;
  // 季節主題：有 hero 主圖時鋪圖（--da-hero-bg=url(...)），否則維持純色 cream（default 主題現況）
  background-color: var(--da-cream);
  background-image: var(--da-hero-bg, none);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
}

.PageLanding__hero-runway {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  /* ⚠ 這道斜紋是靠 hero 底部對齊的。hero 從 100svh 收成四成之後，
     原本的 220px 幾乎填滿整個 hero，斜紋直接壓到標題與副標上（桌機基線一眼看到）。
     收成 72px 才回到「底部一道帶」的原意。改 hero 高度時要一起看這個值。 */
  height: 72px;
  // 斜紋亮色綁季節主題 hero 變數（缺省回退現行黃）
  background: repeating-linear-gradient(
    -45deg,
    var(--da-hero-stripe-yellow) 0px, var(--da-hero-stripe-yellow) 20px,
    transparent 20px, transparent 40px
  );
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
}

.PageLanding__hero-inner {
  position: relative;
  z-index: var(--z-base);
  padding: 0 var(--gutter);
  max-width: var(--shell);
  margin: 0 auto;
  width: 100%;
}

.PageLanding__hero-tag {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  // 季節主題 hero tag 強調色（缺省回退 amber）
  color: var(--da-hero-tag, var(--accent-text));
  margin: 0 0 18px;
}

.PageLanding__hero-title {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* hero 收成四成之後，原本 clamp(64px, 13vw, 168px) 的兩行標題自己就吃掉整段高度。
   收到 9vw 一階 —— 仍是全站最大的展示字，但讓得出空間給訂車卡。 */
.PageLanding__hero-title-display {
  font-family: var(--ff-display);
  font-size: clamp(40px, 9vw, 104px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-tight);
  color: var(--da-dark);
}

.PageLanding__hero-title-sub {
  font-family: var(--ff-ui);
  font-size: clamp(14px, 3.4vw, 17px);
  font-weight: 300;
  line-height: var(--lh-relaxed);
  color: var(--da-gray);
  /* hero-inner 放寬到 --shell 之後，副標若不另外收行長會拉成一行很長的字 */
  max-width: var(--measure);
}

/* ── 訂車卡（提案規則二）─────────────────────────────────────
   −34px 疊在 hero 下緣，是全頁唯一有陰影的東西。 */
.PageLanding__booklane {
  position: relative;
  z-index: var(--z-sticky);
  margin: -34px auto 0;
  padding: 0 var(--gutter);
  max-width: var(--shell);
  width: 100%;

  /* 桌機：訂車卡 520px 靠左的話右邊會空一整片（與 /home 快速操作同一種病）。
     信任條改排到卡片右側、底端對齊，兩者讀成同一條帶。 */
  @media (min-width: 900px) {
    display: flex;
    align-items: flex-end;
    gap: var(--space-lg);
  }
}

.PageLanding__bookcard {
  background: var(--da-off-white);
  border: 1px solid var(--ink-a06);
  border-radius: var(--r-lg);
  padding: 16px;
  display: grid;
  gap: 12px;
  box-shadow: var(--shadow-pop);
  max-width: 520px;

  @media (min-width: 900px) {
    flex: none;
    width: 460px;
  }
}

.PageLanding__booktypes {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-sm);
  background: var(--da-gray-pale);
}

.PageLanding__booktype {
  flex: 1;
  /* 提案「不隨配色改變的規則」第二條：按鈕、分頁、輸入框、表格列最小高度一律 --tap。
     第一版寫 34px —— 分段控制也是分頁，同樣受這條約束。 */
  min-height: var(--tap);
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  color: var(--da-gray);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &.is-active {
    background: var(--da-off-white);
    color: var(--da-dark);
  }
}

.PageLanding__bookfield {
  min-height: var(--tap);
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 2px;
  border-bottom: 1px solid var(--ink-a06);

  &:last-child { border-bottom: 0; }
}

.PageLanding__bookfield-label {
  flex: none;
  width: 34px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageLanding__bookfield-value {
  flex: 1;
  min-width: 0;
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--da-dark);

  &.is-placeholder {
    font-weight: 300;
    color: var(--da-gray-light);
  }
}

/* 主動作：縞黑實心、金只作箭頭（提案「不隨配色改變的規則」與首頁規則二） */
.PageLanding__bookcta {
  min-height: var(--tap);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid var(--da-dark);
  border-radius: var(--r-sm);
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.88; }
  &:active { transform: scale(0.98); }
}

.PageLanding__bookcta-arrow { color: var(--da-amber-light); }

.PageLanding__bookhint {
  margin: 0;
  text-align: center;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

/* 信任條：三格，用細線切不用卡片 */
.PageLanding__trust {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: var(--space-md);
  max-width: 520px;
  border-top: 1px solid var(--ink-a06);
  border-bottom: 1px solid var(--ink-a06);

  @media (min-width: 900px) {
    flex: 1;
    min-width: 0;
    max-width: none;
    margin-top: 0;
    margin-bottom: var(--space-sm);
  }
}

.PageLanding__trust-cell {
  padding: 14px 4px;
  text-align: center;
  border-left: 1px solid var(--ink-a06);

  &:first-child { border-left: 0; }
}

.PageLanding__trust-value {
  display: block;
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h3);
  color: var(--da-dark);
}

.PageLanding__trust-label {
  display: block;
  margin-top: 4px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageLanding__cta-primary,
.PageLanding__cta-secondary {
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  padding: 14px 26px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);

  &:active { transform: scale(0.97); }
}

.PageLanding__cta-primary {
  background: var(--da-dark);
  color: var(--da-cream);
  border: 1px solid var(--da-dark);
  &:hover { opacity: 0.88; }
}

.PageLanding__cta-secondary {
  background: transparent;
  color: var(--da-dark);
  border: 1px solid var(--ink-a12);
  &:hover {
    background: var(--ink-a06);
    border-color: var(--ink-a20);
  }
}

// ── 斜紋分隔 ────────────────────────────────────────────────
.PageLanding__stripe {
  height: 12px;
  // 季節主題斜紋分隔（hero 專屬變數；缺省回退現行黃 / 深）
  background: repeating-linear-gradient(
    -45deg,
    var(--da-hero-stripe-yellow) 0px, var(--da-hero-stripe-yellow) 12px,
    var(--da-hero-stripe-dark) 12px, var(--da-hero-stripe-dark) 24px
  );
  opacity: 0.85;
}

// ── 共用 section ──────────────────────────────────────────────
/* 區塊骨架 —— 手機是單欄；≥1024px 起改 12 欄，標籤與標題落在左側 4 欄的「側欄」上，
   內文與網格落在右側 8 欄。這是雜誌版面最基本的一招：把導讀與正文分成兩個縱列，
   讀者一眼就知道「這一段在講什麼」與「內容在哪」是兩件事。 */
/* ⚠ 這裡不能用 max-width + margin auto 置中 —— .PageLanding__section 同時是
   交錯底色的載體（is-overview 骨白 / is-coverage 瓷白 / is-features 骨白），
   給它 max-width 會讓整片底色縮成中間一條，兩側露出頁面底。
   改用「內距吃掉多餘寬度」：背景仍然滿版，內容照樣置中在 --shell 內。 */
.PageLanding__section {
  padding-block: var(--space-section);
  padding-inline: max(var(--gutter), calc((100% - var(--shell)) / 2));
}

@media (min-width: 1024px) {
  .PageLanding__section {
    display: grid;
    grid-template-columns: 4fr 8fr;
    column-gap: var(--space-xl);
    align-items: start;
  }

  /* ⚠ 右欄元素只指定 grid-column，**不要**指定 grid-row。
     第一版寫成 `grid-row: 1 / span 3`，結果 is-coverage 有兩個右欄元素
     （section-desc 與 airports），兩個都被放進同一批格子 —— 直接疊在一起。
     只給 column、讓自動排列決定 row，兩者就會依 DOM 順序往下堆。 */
  /* ⚠ 必須 grid-row: 1 / -1（跨滿所有列）。只寫 grid-column 的話 head 會落在第 1 列，
     而 is-coverage 的右欄有兩個元素（desc 在第 1 列、airports 在第 2 列）——
     第 1 列的高度被 head 那四行大標題撐開，desc 與 airports 之間就多出一段空隙，
     而 is-features（右欄只有一個元素）沒有這個問題，兩區看起來不一致。
     跨滿所有列之後，列高只由右欄內容決定，head 靠 align-self 貼齊頂端。

     ⚠ 這裡**不能寫 grid-row: 1 / -1**。`-1` 指的是「**顯式**格線的最後一條」，
        而這個 grid 沒有 grid-template-rows，列全是隱式的 —— `-1` 於是解析成第 1 條線，
        `1 / -1` 塌成 `1 / 2`，head 又只佔第 1 列，空隙原封不動。
        第一次修就是這樣寫的，改完看起來像修好了（CSS 有進產物、33 張基線全綠），
        但截圖上的空隙一點沒變 —— 是**逐張看圖**才發現沒生效的。
        用 span 才會延伸到隱式列。多出來的空列高度為 0，不影響版面。 */
  .PageLanding__section-head { grid-column: 1; grid-row: 1 / span 20; align-self: start; }
  .PageLanding__section-desc,
  .PageLanding__overview-body,
  .PageLanding__airports,
  .PageLanding__features { grid-column: 2; }
}

.PageLanding__section-head { margin-bottom: var(--space-lg); }

@media (min-width: 1024px) {
  .PageLanding__section-head { margin-bottom: 0; }
}

/* 換氣點：進入「涵蓋範圍」之前給一次大留白，讓前面的主張收乾淨。
   均勻的 72px 讀起來像清單，節奏差才讀得出章節。 */
.PageLanding__section.is-coverage { padding-block: var(--space-major); }

.PageLanding__section.is-overview  { background: var(--da-cream); }
.PageLanding__section.is-coverage  { background: var(--da-off-white); }
.PageLanding__section.is-features  { background: var(--da-cream); }

.PageLanding__section-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageLanding__section-title {
  font-family: var(--ff-display);
  /* 上限從 56px 拉到 88px：760px 的內容欄裡 56px 已經是上限，
     但版面放寬到 --shell 之後，56px 的標題會被右側 8 欄的內文壓過去。
     尺度對比是精品調的第一件事，不是裝飾。 */
  font-size: clamp(42px, 6vw, 88px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-tight);
  color: var(--da-dark);
  margin: 0 0 var(--space-md);
  text-wrap: balance;
}

.PageLanding__section-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin: 0 0 var(--space-lg);
  max-width: var(--measure);
}

// ── SERVICE OVERVIEW body ────────────────────────────────────
.PageLanding__overview-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;

  p {
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    font-weight: 300;
    color: var(--da-gray);
    line-height: var(--lh-relaxed);
    margin: 0;
  }
}

// ── COVERAGE airports grid ───────────────────────────────────
/* 機場：四張卡不再是 2×2 的均勻方陣。桌機改 6 欄，首張（主要機場）橫跨 4 欄、
   其餘各佔 2 欄 —— 版面自己說出「這四個不等重」，不必加 badge。 */
/* 提案規則三：機場從「卡片方塊」降成「列」—— 代碼在左，細線分隔，不做卡片。 */
.PageLanding__airports {
  display: block;
}

.PageLanding__airport {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: var(--tap);
  padding: 13px 2px;
  border-bottom: 1px solid var(--ink-a06);

  &:last-child { border-bottom: 0; }
}

.PageLanding__airport-code {
  flex: none;
  width: 72px;
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h3);
  letter-spacing: var(--ls-caps);
  color: var(--da-amber);
  line-height: var(--lh-flat);
}

.PageLanding__airport-text {
  flex: 1;
  min-width: 0;
}

.PageLanding__airport-name {
  font-family: var(--ff-display);
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--da-dark);
  margin: 0;
  letter-spacing: var(--ls-snug);
}

.PageLanding__airport-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin: 0;
}

// ── FEATURES grid ───────────────────────────────────────────
/* 特色：桌機兩欄但第二欄整體下沉一段，形成錯落而不是對齊的方塊。
   偏移量刻意用 --space-xl 而不是隨手一個 40px —— 錯落也要在節奏上。 */
/* 提案規則三：理由同樣降成列 —— 編號 + 細線，安靜到底。 */
.PageLanding__features {
  display: block;
}

.PageLanding__feature {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 14px;
  padding: 15px 2px;
  border-bottom: 1px solid var(--ink-a06);

  &:last-child { border-bottom: 0; }
}

.PageLanding__feature-no {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--accent-text);
  margin-top: 4px;
}

.PageLanding__feature-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h4);
  font-weight: 700;
  letter-spacing: var(--ls-snug);
  color: var(--da-dark);
  margin: 0 0 4px;
}

.PageLanding__feature-body {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin: 0;
}

// ── CTA section ─────────────────────────────────────────────
.PageLanding__cta-section {
  padding: 64px 24px;
  background: var(--da-off-white);
}

.PageLanding__cta-card {
  background: var(--da-dark);
  color: var(--da-cream);
  border-radius: var(--r-xl);
  padding: 44px 32px;
  text-align: center;
  max-width: 640px;
  margin: 0 auto;
  box-shadow: var(--shadow-pop);
}

.PageLanding__cta-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 12px;
}

.PageLanding__cta-title {
  font-family: var(--ff-display);
  font-size: clamp(36px, 9vw, 48px);
  letter-spacing: var(--ls-snug);
  color: var(--da-cream);
  margin: 0 0 12px;
}

.PageLanding__cta-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--surface-a72);
  line-height: var(--lh-relaxed);
  margin: 0 0 28px;
}

/* 主動作不用金色實心 —— 介面方向提案的規則二：「金色實心大按鈕會廉價，
   精品的主動作是黑底白字，金只作箭頭」（模擬檔 .btn.primary / .btn.primary svg）。
   這顆按鈕坐在縞黑卡片上，黑底黑字不成立，故取其反相：瓷白底 + 縞黑字，
   金留給箭頭。金屬色全站省著用才貴。 */
.PageLanding__cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 32px;
  background: var(--da-off-white);
  color: var(--da-dark);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  border: none;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.97); }
}

.PageLanding__cta-btn-arrow {
  font-size: var(--fs-body-lg);
  /* 唯一保留金屬色的地方（古銅於瓷白 5.07:1，過 AA） */
  color: var(--da-amber);
}
</style>
