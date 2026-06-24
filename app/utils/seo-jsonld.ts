// W3 AEO — Schema.org JSON-LD builder
//
// 統一產出 schema.org JSON-LD 物件，給各頁面透過 useHead({ script: ... }) 注入 <head>。
// 目的：讓 AI Overview / Perplexity / ChatGPT search 等 answer engine 能結構化解析內容，
// 提升被引用機率。
//
// 設計原則：
//   - 純函式：吃 i18n t 或 raw 字串，吐 plain object，無副作用
//   - 三語：透過 i18n 取字，自動跟 locale 同步
//   - schema.org 規範：所有 @type / @context / @id 嚴格遵循官方詞彙表
//
// 用法（per-page）：
//   const { t } = useI18n();
//   const ld = computed(() => buildFaqPageLd(t));
//   useHead({ script: [{ type: 'application/ld+json', children: () => JSON.stringify(ld.value) }] });

import { FAQ_CATEGORIES } from '~/utils/faq-items';

type Translator = (key: string, ...args: unknown[]) => string;

const SCHEMA_CONTEXT = 'https://schema.org' as const;

// ─────────────────────────────────────────────────────────────────────
// Organization（公司基本資訊）— 用於 /
// ─────────────────────────────────────────────────────────────────────
export function buildOrganizationLd(siteUrl: string, _t: Translator): Record<string, unknown> {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    '@id': `${siteUrl}#organization`,
    name: 'DEST · ANYWHERE',
    alternateName: ['Destination Anywhere', 'DA'],
    url: siteUrl,
    logo: `${siteUrl}/favicons/passenger.svg`,
    description: 'DEST · ANYWHERE 提供桃園、松山、台中、高雄四大機場接送與全台長途包車服務。透明計價、真實航班追蹤、24 小時服務，職業駕駛全程保障。',
    foundingLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressCountry: 'TW' },
    },
    areaServed: { '@type': 'Country', name: 'Taiwan' },
    inLanguage: ['zh-Hant-TW', 'en', 'ja'],
  };
}

// ─────────────────────────────────────────────────────────────────────
// LocalBusiness（地理 + 營業時間）— 用於 /
// 補 NAP（Name / Address / Phone）與 OpeningHoursSpecification，
// 給 Google 在地搜尋 / Apple Maps / Bing Local 等本地索引引用
// ─────────────────────────────────────────────────────────────────────
export function buildLocalBusinessLd(siteUrl: string, _t: Translator): Record<string, unknown> {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': ['LocalBusiness', 'TaxiService'],
    '@id': `${siteUrl}#localbusiness`,
    name: 'DEST · ANYWHERE',
    image: `${siteUrl}/favicons/passenger.svg`,
    url: siteUrl,
    priceRange: 'NT$$$',
    description: 'DEST · ANYWHERE — 桃園 / 松山 / 台中 / 高雄四大機場接送與全台長途包車。',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'TW',
      addressRegion: '台灣',
    },
    areaServed: [
      { '@type': 'AdministrativeArea', name: '桃園市' },
      { '@type': 'AdministrativeArea', name: '台北市' },
      { '@type': 'AdministrativeArea', name: '新北市' },
      { '@type': 'AdministrativeArea', name: '台中市' },
      { '@type': 'AdministrativeArea', name: '高雄市' },
      { '@type': 'Country', name: 'Taiwan' },
    ],
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '00:00',
      closes: '23:59',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      areaServed: 'TW',
      availableLanguage: ['Chinese', 'English', 'Japanese'],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// TransportationService（服務型別）— 用於 /
// schema.org 沒專屬「機場接送」type，用 Service 並指 serviceType 為「Airport Transfer」
// ─────────────────────────────────────────────────────────────────────
export function buildTransportationServiceLd(siteUrl: string, _t: Translator): Record<string, unknown> {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Service',
    '@id': `${siteUrl}#service`,
    serviceType: 'Airport Transfer',
    name: '桃園機場接送・全台機場接送與長途包車',
    description: 'DEST · ANYWHERE 機場接送服務：桃園 TPE / 松山 TSA / 台中 RMQ / 高雄 KHH 四大國際機場，含跨縣市長途包車。專人專車、真實航班追蹤、24 小時服務、職業駕駛保障。',
    provider: { '@id': `${siteUrl}#organization` },
    areaServed: { '@type': 'Country', name: 'Taiwan' },
    audience: { '@type': 'Audience', audienceType: '旅客 / 商務人士 / 觀光客' },
    category: ['Airport Transfer', 'Private Charter', 'Ground Transportation'],
    serviceOutput: '安全準時的機場接送與包車服務',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: '車型與服務',
      itemListElement: [
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '桃園國際機場接送（TPE）' } },
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '松山機場接送（TSA）' } },
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '台中國際機場接送（RMQ）' } },
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '高雄國際機場接送（KHH）' } },
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '全台跨縣市長途包車' } },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// FAQPage — 用於 /faq
// 17 題全套塞 mainEntity，answer 取 i18n faq.items.<key>.q/.a
// ─────────────────────────────────────────────────────────────────────
export function buildFaqPageLd(t: Translator): Record<string, unknown> {
  const allItemKeys = FAQ_CATEGORIES.flatMap((cat) => cat.itemKeys);
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'FAQPage',
    mainEntity: allItemKeys.map((key) => ({
      '@type': 'Question',
      name: t(`faq.items.${key}.q`),
      acceptedAnswer: {
        '@type': 'Answer',
        text: t(`faq.items.${key}.a`),
      },
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Service + PriceSpecification — 用於 /fare
// 描述計價結構，給 AI 解析「起跳價 + 里程價」費率
// ─────────────────────────────────────────────────────────────────────
export function buildFareServiceLd(siteUrl: string, _t: Translator): Record<string, unknown> {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Service',
    '@id': `${siteUrl}/fare#service`,
    name: '車資結構與計價方式',
    description: 'DEST · ANYWHERE 透明計價：基本起跳費 + 里程費 + 山區加成 + 跨縣市補貼 + 國道通行費，預訂時即顯示預估金額，無隱藏費用，無條件進位至 50 元。',
    provider: { '@id': `${siteUrl}#organization` },
    serviceType: 'Airport Transfer Pricing',
    areaServed: { '@type': 'Country', name: 'Taiwan' },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'TWD',
      lowPrice: '550',
      highPrice: '6000',
      offerCount: 6,
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'TWD',
        description: '基本起跳費 NT$550 起 + 每公里 NT$42 起；實際車資依車型、路線、加成項目浮動，建單時即時顯示預估金額。',
      },
    },
  };
}
