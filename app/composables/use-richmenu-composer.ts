/**
 * P44b：richmenu 圖層合成器 composable
 *
 * 封裝：
 *   - Layer CRUD（add / remove / duplicate / moveUp / moveDown / patch）
 *   - Canvas render（preview 同步 / hidden full-size export）
 *   - composeBlob：合成 PNG 或 JPEG（≤ 1MB LINE 限制）
 *   - 簡化版 pointer 拖移（不做 resize handle / multi-select；交給 area editor）
 *
 * Canvas 策略：
 *   - preview canvas（admin 看的）：480 width，比例縮放
 *   - export canvas（hidden）：底圖 px 全尺寸（2500×1686 / 2500×843），合成完 toBlob
 *
 * Font preload：composeBlob 內 await document.fonts.ready，避免 fallback 字型
 */
import type { Ref } from 'vue';
import type {
  RichmenuArea,
  RichmenuLayer,
  RichmenuSize,
} from '@/protocol/fetch-api/api/admin/line-richmenu';

export interface UseRichmenuComposerParams {
  layers: Ref<RichmenuLayer[]>;
  imageSize: Ref<RichmenuSize | null>;
  /** preview 縮放上限寬（預設 480） */
  previewMaxWidth?: number;
  /** 1MB byte 上限（LINE 規格） */
  maxOutputBytes?: number;
}

const DEFAULT_PREVIEW_MAX_WIDTH = 480;
const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

let _idCounter = 0;
function nid(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// 圖片 cache（同 url 重複用同一 HTMLImageElement）
const imageCache = new Map<string, HTMLImageElement>();

/**
 * 直連 Firebase Storage URL → 同源 proxy URL（P44b-FU3）
 *
 * 舊資料（P44b-FU2 之前）layer.imageUrl 是 firebasestorage.googleapis.com download URL，
 * 載入到 canvas 會 tainted 導致 toBlob 失敗。
 * 偵測到此 pattern 時改走同源 `/nuxt-api/admin/storage-proxy/{path}`，舊資料免重新上傳。
 *
 * 白名單前綴必須與 server/routes/nuxt-api/admin/storage-proxy/[...path].get.ts 對齊。
 */
const REWRITE_PREFIXES = ['line-richmenus/', 'notification-templates/'];

function rewriteToProxyUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  if (url.startsWith('/nuxt-api/admin/storage-proxy/')) return url;
  const match = url.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/);
  if (!match || !match[1]) return url;
  try {
    const objectPath = decodeURIComponent(match[1]);
    if (REWRITE_PREFIXES.some((p) => objectPath.startsWith(p))) {
      return `/nuxt-api/admin/storage-proxy/${objectPath}`;
    }
  } catch {
    // decode 失敗 → 維持原 URL
  }
  return url;
}

/**
 * 載入圖片（兩階段 fallback）：
 *
 * 0. 先把直連 firebasestorage URL rewrite 成同源 proxy URL（舊資料自動 migrate）
 * 1. 試 `crossOrigin='anonymous'` — 同源 proxy / 有 CORS 設定的 URL 走這條，canvas 不 tainted
 * 2. CORS 失敗時 fallback 不帶 crossOrigin — preview 可顯示，但 canvas tainted（toBlob 會 fail）
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  const finalUrl = rewriteToProxyUrl(url);
  const cached = imageCache.get(finalUrl);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const tryLoad = (withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.set(finalUrl, img);
        resolve(img);
      };
      img.onerror = () => {
        if (withCors) {
          // CORS 失敗 → fallback 不帶 crossOrigin（preview 可顯示，但 canvas 會 tainted）
          tryLoad(false);
        } else {
          reject(new Error(`failed to load image: ${finalUrl}`));
        }
      };
      img.src = finalUrl;
    };
    tryLoad(true);
  });
}

export function useRichmenuComposer(params: UseRichmenuComposerParams) {
  const {
    layers,
    imageSize,
    previewMaxWidth = DEFAULT_PREVIEW_MAX_WIDTH,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = params;

  const previewCanvasRef = ref<HTMLCanvasElement | null>(null);
  const selectedLayerId = ref<string | null>(null);

  const primaryLayer = computed<RichmenuLayer | null>(() => {
    if (!selectedLayerId.value) return null;
    return layers.value.find((l) => l.id === selectedLayerId.value) ?? null;
  });

  const previewScale = computed(() => {
    if (!imageSize.value) return 1;
    return previewMaxWidth / imageSize.value.width;
  });

  const previewWidth = computed(() => {
    if (!imageSize.value) return 0;
    return Math.round(imageSize.value.width * previewScale.value);
  });

  const previewHeight = computed(() => {
    if (!imageSize.value) return 0;
    return Math.round(imageSize.value.height * previewScale.value);
  });

  // ── 渲染 ─────────────────────────────────────────────────────
  /**
   * 把 layers 渲染到指定 canvas（target 寬高為底圖 px 或 preview px）
   *
   * scale 參數：layer 內座標 / scale → target canvas 上的座標
   * （preview 渲染傳 1 / previewScale；export 渲染傳 1）
   */
  async function renderToCanvas(canvas: HTMLCanvasElement, scale: number) {
    if (!imageSize.value) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 預先處理：分離出 image layers 並先載入完成
    const imageUrls = layers.value
      .filter((l) => l.type === 'image' && typeof l.imageUrl === 'string' && l.imageUrl.length > 0)
      .map((l) => l.imageUrl as string);
    await Promise.allSettled(imageUrls.map((u) => loadImage(u)));

    // 清畫布 + 預設白底（避免 transparent 在 LINE 上顯示異常）
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const layer of layers.value) {
      ctx.save();
      ctx.globalAlpha = layer.opacity ?? 1;
      const x = layer.x * scale;
      const y = layer.y * scale;
      const w = layer.width * scale;
      const h = layer.height * scale;

      if (layer.type === 'rectangle') {
        if (layer.fillColor) {
          ctx.fillStyle = layer.fillColor;
          if (layer.radius && layer.radius > 0) {
            roundedRect(ctx, x, y, w, h, layer.radius * scale);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, w, h);
          }
        }
        if (layer.borderColor && layer.borderWidth && layer.borderWidth > 0) {
          ctx.strokeStyle = layer.borderColor;
          ctx.lineWidth = layer.borderWidth * scale;
          if (layer.radius && layer.radius > 0) {
            roundedRect(ctx, x, y, w, h, layer.radius * scale);
            ctx.stroke();
          } else {
            ctx.strokeRect(x, y, w, h);
          }
        }
      }

      if (layer.type === 'text' && layer.text) {
        const fontSize = (layer.fontSize ?? 48) * scale;
        const weight = layer.fontWeight ?? 600;
        const family = layer.fontFamily ?? 'system-ui, sans-serif';
        ctx.font = `${weight} ${fontSize}px ${family}`;
        ctx.fillStyle = layer.color ?? '#000000';
        ctx.textAlign = layer.align ?? 'left';
        ctx.textBaseline = layer.vAlign === 'middle' ? 'middle' : layer.vAlign === 'bottom' ? 'bottom' : 'top';

        let tx: number;
        if (layer.align === 'center') tx = x + w / 2;
        else if (layer.align === 'right') tx = x + w;
        else tx = x;

        let ty: number;
        if (layer.vAlign === 'middle') ty = y + h / 2;
        else if (layer.vAlign === 'bottom') ty = y + h;
        else ty = y;

        // 簡易單行 render（不做 wrap；admin 文字過長就裁切）— LINE menu 標籤通常短
        ctx.fillText(layer.text, tx, ty);
      }

      if (layer.type === 'image' && layer.imageUrl) {
        // cache key 必須走 rewriteToProxyUrl 才會和 loadImage 寫入時的 key 一致
        const cached = imageCache.get(rewriteToProxyUrl(layer.imageUrl));
        if (cached && cached.complete && cached.naturalWidth > 0) {
          drawImageWithFit(ctx, cached, x, y, w, h, layer.imageFit ?? 'cover');
        }
      }

      ctx.restore();
    }
  }

  function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function drawImageWithFit(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
    fit: 'contain' | 'cover' | 'fill',
  ) {
    if (fit === 'fill') {
      ctx.drawImage(img, x, y, w, h);
      return;
    }
    const ar = img.naturalWidth / img.naturalHeight;
    const targetAr = w / h;
    let dx = x;
    let dy = y;
    let dw = w;
    let dh = h;
    if (fit === 'contain') {
      if (ar > targetAr) {
        dh = w / ar;
        dy = y + (h - dh) / 2;
      } else {
        dw = h * ar;
        dx = x + (w - dw) / 2;
      }
    } else if (fit === 'cover') {
      // 取交集 — 用 source crop
      if (ar > targetAr) {
        const sw = img.naturalHeight * targetAr;
        const sx = (img.naturalWidth - sw) / 2;
        ctx.drawImage(img, sx, 0, sw, img.naturalHeight, x, y, w, h);
        return;
      } else {
        const sh = img.naturalWidth / targetAr;
        const sy = (img.naturalHeight - sh) / 2;
        ctx.drawImage(img, 0, sy, img.naturalWidth, sh, x, y, w, h);
        return;
      }
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // ── Preview 自動 redraw ─────────────────────────────────────
  let redrawPending = false;
  function redrawPreview() {
    if (redrawPending) return;
    redrawPending = true;
    requestAnimationFrame(async () => {
      redrawPending = false;
      const canvas = previewCanvasRef.value;
      if (!canvas || !imageSize.value) return;
      canvas.width = previewWidth.value;
      canvas.height = previewHeight.value;
      await renderToCanvas(canvas, previewScale.value);
    });
  }

  // layers / imageSize 變動 → 自動 redraw
  watch(
    () => [layers.value.length, imageSize.value?.width, imageSize.value?.height],
    () => redrawPreview(),
    { immediate: true },
  );
  watch(
    () => layers.value.map((l) => JSON.stringify(l)).join('|'),
    () => redrawPreview(),
  );

  // ── 公開：Layer CRUD ────────────────────────────────────────
  function addLayer(partial: Partial<RichmenuLayer> & { type: RichmenuLayer['type'] }) {
    if (!imageSize.value) return null;
    const W = imageSize.value.width;
    const H = imageSize.value.height;
    const newLayer: RichmenuLayer = {
      id: nid(partial.type),
      type: partial.type,
      x: partial.x ?? Math.round(W / 4),
      y: partial.y ?? Math.round(H / 4),
      width: partial.width ?? Math.round(W / 2),
      height: partial.height ?? Math.round(H / 2),
      opacity: partial.opacity,
      imageUrl: partial.imageUrl,
      imageFit: partial.imageFit,
      text: partial.text ?? (partial.type === 'text' ? '文字' : undefined),
      fontSize: partial.fontSize ?? (partial.type === 'text' ? 120 : undefined),
      fontWeight: partial.fontWeight,
      fontFamily: partial.fontFamily ?? (partial.type === 'text' ? 'system-ui, "Noto Sans TC", sans-serif' : undefined),
      color: partial.color ?? (partial.type === 'text' ? '#1f2937' : undefined),
      align: partial.align ?? (partial.type === 'text' ? 'center' : undefined),
      vAlign: partial.vAlign ?? (partial.type === 'text' ? 'middle' : undefined),
      fillColor: partial.fillColor ?? (partial.type === 'rectangle' ? '#d4860a' : undefined),
      borderColor: partial.borderColor,
      borderWidth: partial.borderWidth,
      radius: partial.radius,
    };
    layers.value = [...layers.value, newLayer];
    selectedLayerId.value = newLayer.id;
    return newLayer;
  }

  function removeLayer(id: string) {
    layers.value = layers.value.filter((l) => l.id !== id);
    if (selectedLayerId.value === id) selectedLayerId.value = null;
  }

  function duplicateLayer(id: string) {
    const src = layers.value.find((l) => l.id === id);
    if (!src) return null;
    const offset = 60;
    const W = imageSize.value?.width ?? 2500;
    const H = imageSize.value?.height ?? 1686;
    const copy: RichmenuLayer = {
      ...src,
      id: nid(src.type),
      x: Math.min(W - src.width, src.x + offset),
      y: Math.min(H - src.height, src.y + offset),
    };
    const idx = layers.value.findIndex((l) => l.id === id);
    const next = [...layers.value];
    next.splice(idx + 1, 0, copy);
    layers.value = next;
    selectedLayerId.value = copy.id;
    return copy;
  }

  function moveLayerUp(id: string) {
    const idx = layers.value.findIndex((l) => l.id === id);
    if (idx <= 0) return;
    const next = [...layers.value];
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
    layers.value = next;
  }

  function moveLayerDown(id: string) {
    const idx = layers.value.findIndex((l) => l.id === id);
    if (idx < 0 || idx >= layers.value.length - 1) return;
    const next = [...layers.value];
    [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
    layers.value = next;
  }

  function patchLayer(id: string, patch: Partial<RichmenuLayer>) {
    const idx = layers.value.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const next = [...layers.value];
    next[idx] = { ...next[idx]!, ...patch };
    layers.value = next;
  }

  function selectLayer(id: string | null) {
    selectedLayerId.value = id;
  }

  // ── 拖移（preview canvas 內）─────────────────────────────
  interface DragCtx {
    layerId: string;
    startX: number;
    startY: number;
    snapshot: { x: number; y: number };
    pointerId: number;
  }
  let drag: DragCtx | null = null;

  function eventToImagePx(e: PointerEvent): { x: number; y: number } | null {
    const canvas = previewCanvasRef.value;
    if (!canvas || !imageSize.value) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return {
      x: Math.round(px / previewScale.value),
      y: Math.round(py / previewScale.value),
    };
  }

  /** 從上到下 hit-test：第一個包含 (px, py) 的 layer */
  function hitTest(px: number, py: number): RichmenuLayer | null {
    for (let i = layers.value.length - 1; i >= 0; i -= 1) {
      const l = layers.value[i]!;
      if (px >= l.x && px <= l.x + l.width && py >= l.y && py <= l.y + l.height) {
        return l;
      }
    }
    return null;
  }

  function onPointerDownPreview(e: PointerEvent) {
    if (e.button !== 0) return;
    const pos = eventToImagePx(e);
    if (!pos) return;
    const hit = hitTest(pos.x, pos.y);
    if (!hit) {
      selectedLayerId.value = null;
      return;
    }
    e.preventDefault();
    previewCanvasRef.value?.setPointerCapture?.(e.pointerId);
    selectedLayerId.value = hit.id;
    drag = {
      layerId: hit.id,
      startX: pos.x,
      startY: pos.y,
      snapshot: { x: hit.x, y: hit.y },
      pointerId: e.pointerId,
    };
  }

  function onPointerMovePreview(e: PointerEvent) {
    if (!drag || !imageSize.value) return;
    const pos = eventToImagePx(e);
    if (!pos) return;
    const dx = pos.x - drag.startX;
    const dy = pos.y - drag.startY;
    const idx = layers.value.findIndex((l) => l.id === drag!.layerId);
    if (idx < 0) return;
    const W = imageSize.value.width;
    const H = imageSize.value.height;
    const layer = layers.value[idx]!;
    const newX = Math.max(0, Math.min(W - layer.width, drag.snapshot.x + dx));
    const newY = Math.max(0, Math.min(H - layer.height, drag.snapshot.y + dy));
    patchLayer(drag.layerId, { x: newX, y: newY });
  }

  function onPointerUpPreview(e: PointerEvent) {
    if (!drag) return;
    previewCanvasRef.value?.releasePointerCapture?.(drag.pointerId);
    drag = null;
  }

  // ── 套範本 ───────────────────────────────────────────────
  function applyTemplate(templateLayers: RichmenuLayer[]) {
    layers.value = templateLayers.map((l) => ({ ...l }));
    selectedLayerId.value = null;
  }

  // ── 合成 Blob ───────────────────────────────────────────
  /**
   * 把 layers 渲染到 hidden full-size canvas → toBlob
   *
   * @param mime image/png 或 image/jpeg；JPEG 通常更小，PNG 才是 LINE 推薦
   * @param quality JPEG only，0-1（PNG 此參數忽略）
   */
  async function composeBlob(
    mime: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92,
  ): Promise<{ blob: Blob; mime: 'image/png' | 'image/jpeg'; sizeBytes: number; oversize: boolean }> {
    if (!imageSize.value) {
      throw new Error('imageSize 未設定，無法合成');
    }

    // 確保字型載入完畢（避免 fallback）
    if (typeof document !== 'undefined' && 'fonts' in document) {
      try {
        await document.fonts.ready;
      } catch {
        // 不阻擋
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageSize.value.width;
    canvas.height = imageSize.value.height;
    await renderToCanvas(canvas, 1);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('toBlob 失敗（可能 canvas 為空或瀏覽器不支援）'));
            return;
          }
          resolve({
            blob,
            mime,
            sizeBytes: blob.size,
            oversize: blob.size > maxOutputBytes,
          });
        },
        mime,
        mime === 'image/jpeg' ? quality : undefined,
      );
    });
  }

  return {
    previewCanvasRef,
    previewWidth,
    previewHeight,
    previewScale,
    selectedLayerId,
    primaryLayer,
    addLayer,
    removeLayer,
    duplicateLayer,
    moveLayerUp,
    moveLayerDown,
    patchLayer,
    selectLayer,
    applyTemplate,
    redrawPreview,
    composeBlob,
    onPointerDownPreview,
    onPointerMovePreview,
    onPointerUpPreview,
  };
}
