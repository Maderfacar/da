<script setup lang="ts">
// OpenDialogImageSelect // 圖片選擇與編輯 
// -- 引入 --------------------------------------------------------------------------------------------
const $option = UseOpenComOption();

// -- 資料 --------------------------------------------------------------------------------------------
type ImageEditParams = {
  aspectW?: number; // 裁切寬比，預設 3
  aspectH?: number; // 裁切高比，預設 4
  preferJPEG?: boolean; // 匯出預設使用 JPEG
  cropMinW?: number; // 最小寬（0..1，依輸出寬比）
  cropMaxW?: number; // 最大寬（0..1）
  snapPx?: number; // 貼齊邊界像素閾值（預設 8px）
  lineColor?: string; // 裁切框線顏色
  lineWidth?: number; // 裁切框線寬（裝置像素，會等比縮放），預設 4
  dash?: [number, number]; // 虛線（裝置像素，會等比縮放）
  handleColor?: string; // 控制點顏色
  handleSize?: number; // 控制點尺寸（裝置像素，會等比縮放）
  title?: string; // 對話框標題
};
type Props = {
  resolve: (image: File) => void; // 回傳已編輯的圖片檔案
  params?: ImageEditParams;
}
const props = defineProps<Props>();

const cfg = computed(() => ({
  aspectW: props.params?.aspectW ?? 3,
  aspectH: props.params?.aspectH ?? 4,
  preferJPEG: props.params?.preferJPEG ?? true,
  cropMinW: props.params?.cropMinW ?? 0.1,
  cropMaxW: props.params?.cropMaxW ?? 1,
  snapPx: props.params?.snapPx ?? 8,
  lineColor: props.params?.lineColor ?? 'white',
  lineWidth: props.params?.lineWidth ?? 4,
  dash: props.params?.dash ?? [8, 6] as [number, number],
  handleColor: props.params?.handleColor ?? '#63c6ff',
  handleSize: props.params?.handleSize ?? 16,
  title: props.params?.title ?? '選擇上傳圖片'
}));

// 預覽與狀態
const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// 來源檔與位元圖
const srcFile = ref<File | null>(null);
const imgBitmap = shallowRef<ImageBitmap | HTMLImageElement | null>(null);
const natural = reactive({ w: 0, h: 0, type: '' });

const hasImage = computed(() => Boolean(imgBitmap.value && natural.w && natural.h));

// 變換狀態
const transform = reactive({ angle: 0, flipX: false, flipY: false }); // angle 單位: 度，限於 90 的倍數

// 裁切狀態（預設開啟）
const cropEnabled = ref(true);
const cropAspect = computed(() => {
  const w = Math.max(1, cfg.value.aspectW);
  const h = Math.max(1, cfg.value.aspectH);
  return w / h;
});

// 裁切矩形（以旋轉後輸出空間 out.w/out.h 的座標系，使用歸一化 0..1）
const cropRect = reactive({ x: 0, y: 0, w: 1, h: 1 });

// 畫面暫存（用於事件座標轉換）
const lastDraw = reactive({ scale: 1, angle: 0, sx: 1, sy: 1, cx: 0, cy: 0, outW: 0, outH: 0 });

// 初始化裁切矩形
const InitCropRect = () => {
  if (!natural.w || !natural.h) return;
  const out = GetTransformedSize(natural.w, natural.h, transform.angle);
  // 以像素空間最大置中矩形（遵循比例）
  const asp = cropAspect.value; // w/h
  // 先以高度為基準算出可容納的寬度，取不超出 out 的最大值
  const maxWByH = Math.floor(out.h * asp);
  const cw = Math.min(out.w, maxWByH);
  const ch = Math.floor(cw / asp);
  cropRect.w = cw / out.w;
  cropRect.h = ch / out.h;
  cropRect.x = (out.w - cw) / 2 / out.w;
  cropRect.y = (out.h - ch) / 2 / out.h;
};

// 畫面尺寸（避免 SSR 直接取用 window）
const dpr = ref(1);
let ro: ResizeObserver | null = null;

const getDevicePixelRatio = () => dpr.value || 1;

// 監聽容器縮放，重新繪製預覽
onMounted(() => {
  // 初始化 DPR
  dpr.value = Math.min((window as any).devicePixelRatio || 1, 2);
  if (containerRef.value) {
    ro = new ResizeObserver(() => DrawPreview());
    ro.observe(containerRef.value);
  }
  nextTick(() => {
    OnPreviewClick();
  });
});

onBeforeUnmount(() => {
  if (ro && containerRef.value) ro.unobserve(containerRef.value);
  ro = null;
});

// 監看裁切開關與比例，開啟或比例變動時重新置中
watch([cropEnabled, () => cfg.value.aspectW, () => cfg.value.aspectH], () => {
  if (cropEnabled.value) {
    InitCropRect();
    nextTick(() => DrawPreview());
  }
});

// 工具：計算旋轉後輸出尺寸
const GetTransformedSize = (w: number, h: number, angle: number) => {
  const a = ((angle % 360) + 360) % 360;
  if (a === 90 || a === 270) return { w: h, h: w };
  return { w, h };
};

// 工具：將角度歸正為 0/90/180/270
const NormalizeAngle = (a: number) => {
  const m = ((a % 360) + 360) % 360;
  if (m % 90 !== 0) return Math.round(m / 90) * 90 % 360;
  return m;
};

// 工具：依旋轉角度換算實際鏡像軸向（確保旋轉 90/270 度後仍維持水平/垂直的視覺語意）
const GetEffectiveFlipScale = (angle: number, flipX: boolean, flipY: boolean) => {
  const swapAxis = NormalizeAngle(angle) % 180 !== 0;
  const [targetX, targetY] = swapAxis ? [flipY, flipX] : [flipX, flipY];
  return {
    sx: targetX ? -1 : 1,
    sy: targetY ? -1 : 1,
  };
};

const ApplyImageTransform = (ctx: CanvasRenderingContext2D, angle: number, flipX: boolean, flipY: boolean) => {
  const flip = GetEffectiveFlipScale(angle, flipX, flipY);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(flip.sx, flip.sy);
  return flip;
};

// 載入圖片
const OnPickFile = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const f = input.files && input.files[0];
  if (!f) return;
  if (!f.type.startsWith('image/')) {
    ElMessage.error('請選擇圖片檔案');
    return;
  }
  srcFile.value = f;
  natural.type = f.type || 'image/png';
  try {
    if ('createImageBitmap' in window) {
      imgBitmap.value = await createImageBitmap(f);
      natural.w = (imgBitmap.value as ImageBitmap).width;
      natural.h = (imgBitmap.value as ImageBitmap).height;
    } else {
      imgBitmap.value = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // 釋放暫時的 object URL
          if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
          resolve(img);
        };
        img.onerror = (ev) => {
          try { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); } catch(err) {console.log(err);}
          reject(ev);
        };
        img.src = URL.createObjectURL(f);
      });
      natural.w = (imgBitmap.value as HTMLImageElement).naturalWidth;
      natural.h = (imgBitmap.value as HTMLImageElement).naturalHeight;
    }
    ResetTransform();
    InitCropRect();
    await nextTick();
    DrawPreview();
  } catch (err) {
    console.error(err);
    ElMessage.error('圖片載入失敗');
  }
};

const TriggerPick = () => {
  if (fileInputRef.value) fileInputRef.value.value = '';
  fileInputRef.value?.click();
};

// 操作：旋轉/鏡像/重置
const Rotate = (delta: number) => {
  transform.angle = NormalizeAngle(transform.angle + delta);
  InitCropRect();
  DrawPreview();
};

const ToggleFlipX = () => {
  transform.flipX = !transform.flipX;
  InitCropRect();
  DrawPreview();
};

const ToggleFlipY = () => {
  transform.flipY = !transform.flipY;
  InitCropRect();
  DrawPreview();
};

const ResetTransform = () => {
  transform.angle = 0;
  transform.flipX = false;
  transform.flipY = false;
  InitCropRect();
  DrawPreview();
};

const ClearImage = () => {
  srcFile.value = null;
  imgBitmap.value = null;
  natural.w = 0;
  natural.h = 0;
  DrawPreview();
  // 清掉後立刻開啟選擇
  nextTick(() => TriggerPick());
};

// 繪製預覽：自適應容器（RWD），不壓縮原圖，只做顯示用縮放
const DrawPreview = () => {
  const cvs = canvasRef.value;
  const box = containerRef.value;
  if (!cvs || !box) return;

  const boxW = Math.max(1, box.clientWidth);
  const boxH = Math.max(1, box.clientHeight);

  // canvas 真實像素，確保在高 DPR 下依然清晰
  const ratio = getDevicePixelRatio();
  cvs.width = Math.floor(boxW * ratio);
  cvs.height = Math.floor(boxH * ratio);
  cvs.style.width = boxW + 'px';
  cvs.style.height = boxH + 'px';

  const ctx = cvs.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  // 若尚未載入圖片，清空後直接返回（確保重新選擇時畫面立即被清除）
  if (!hasImage.value) {
    ctx.restore();
    return;
  }

  const img = imgBitmap.value as any;
  // 旋轉後的內容尺寸（以原圖尺寸計算）
  const out = GetTransformedSize(natural.w, natural.h, transform.angle);

  // 將內容置中，fit-contain 縮放（略微縮小避免四捨五入造成 1px 溢出）
  const scale = Math.min(cvs.width / out.w, cvs.height / out.h) * 0.999;
  const cx = cvs.width / 2;
  const cy = cvs.height / 2;

  // 當前角度（供後續使用）
  const a = NormalizeAngle(transform.angle);

  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // 套用旋轉與鏡像（先旋轉，再鏡像，避免鏡像時左右旋轉方向顛倒）
  const flip = ApplyImageTransform(ctx, transform.angle, transform.flipX, transform.flipY);

  // 將圖像中心對齊到原點並繪製（依 fit-contain 縮放，避免裁切）
  const drawW = natural.w;
  const drawH = natural.h;
  ctx.drawImage(img as any, -drawW / 2, -drawH / 2, drawW, drawH);

  ctx.restore();

  // 繪製裁切框（以畫面座標繪製，保持觀看者看到的長寬比不因旋轉而改變）
  if (cropEnabled.value) {
    const contentW = out.w * scale;
    const contentH = out.h * scale;
    const contentX = cx - contentW / 2;
    const contentY = cy - contentH / 2;

    // 將歸一化裁切轉為畫面座標
    const rx = contentX + cropRect.x * contentW;
    const ry = contentY + cropRect.y * contentH;
    const rw = cropRect.w * contentW;
    const rh = cropRect.h * contentH;
    ctx.save();
    ctx.strokeStyle = cfg.value.lineColor;
    ctx.lineWidth = (cfg.value.lineWidth || 2); // 畫面座標，無須再被 scale 除
    const dash = cfg.value.dash;
    ctx.setLineDash([dash[0], dash[1]]);
    ctx.strokeRect(rx, ry, rw, rh);

    // 暗角（僅限於內容區域內）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.rect(contentX, contentY, contentW, contentH);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill('evenodd');

    // 控制點（角與邊）
    const handleSizePx = (cfg.value.handleSize || 16);
    ctx.setLineDash([]);
    ctx.fillStyle = cfg.value.handleColor;
    const corners = [
      { x: rx,        y: ry },        // nw
      { x: rx + rw,   y: ry },        // ne
      { x: rx,        y: ry + rh },   // sw
      { x: rx + rw,   y: ry + rh },   // se
    ];
    for (const c of corners) ctx.fillRect(c.x - handleSizePx / 2, c.y - handleSizePx / 2, handleSizePx, handleSizePx);
    const edges = [
      { x: rx + rw/2, y: ry },        // n
      { x: rx + rw,   y: ry + rh/2 }, // e
      { x: rx + rw/2, y: ry + rh },   // s
      { x: rx,        y: ry + rh/2 }, // w
    ];
    for (const c of edges) ctx.fillRect(c.x - handleSizePx / 2, c.y - handleSizePx / 2, handleSizePx, handleSizePx);
    ctx.restore();
  }

  // 存下這次繪製狀態供事件換算
  lastDraw.scale = scale;
  lastDraw.angle = a;
  lastDraw.sx = flip.sx;
  lastDraw.sy = flip.sy;
  lastDraw.cx = cx;
  lastDraw.cy = cy;
  lastDraw.outW = out.w;
  lastDraw.outH = out.h;
};

// ==== 裁切互動：將指標位置映射到 out 空間（旋轉後的寬高座標系） ====
const CanvasPointToOut = (e: PointerEvent) => {
  // 以畫面座標將滑鼠位置映射為 out 空間（未旋轉的內容邊界）中的像素位置
  const cvs = canvasRef.value;
  if (!cvs) return { x: 0, y: 0 };
  const rect = cvs.getBoundingClientRect();
  const ratio = getDevicePixelRatio();
  // 轉為畫布裝置像素
  const pxDev = (e.clientX - rect.left) * ratio;
  const pyDev = (e.clientY - rect.top) * ratio;
  // 內容在畫面上的方框（裝置像素）
  const contentW = lastDraw.outW * lastDraw.scale;
  const contentH = lastDraw.outH * lastDraw.scale;
  const contentX = lastDraw.cx - contentW / 2;
  const contentY = lastDraw.cy - contentH / 2;
  // 轉為 out 空間像素
  const relX = pxDev - contentX;
  const relY = pyDev - contentY;
  const outX = Math.max(0, Math.min(lastDraw.outW, (relX / contentW) * lastDraw.outW));
  const outY = Math.max(0, Math.min(lastDraw.outH, (relY / contentH) * lastDraw.outH));
  return { x: outX, y: outY };
};

const OutToCanvasPoint = (x: number, y: number) => {
  // 以畫面座標將 out 空間像素轉為畫布像素（不考慮旋轉，對齊內容方框）
  const contentW = lastDraw.outW * lastDraw.scale;
  const contentH = lastDraw.outH * lastDraw.scale;
  const contentX = lastDraw.cx - contentW / 2;
  const contentY = lastDraw.cy - contentH / 2;
  const px = contentX + (x / lastDraw.outW) * contentW;
  const py = contentY + (y / lastDraw.outH) * contentH;
  return { x: px, y: py };
};

// 拖曳狀態
type DragMode = 'none' | 'move' | 'resize';
type DragHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w' | null;
const drag = reactive({ mode: 'none' as DragMode, handle: null as DragHandle, start: { x: 0, y: 0 }, init: { x: 0, y: 0, w: 0, h: 0 } });

type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

const isCornerHandle = (handle: DragHandle): handle is CornerHandle => Boolean(handle && ['nw', 'ne', 'sw', 'se'].includes(handle));

const getCornerDirection = (handle: CornerHandle) => {
  switch (handle) {
    case 'ne': return { sx: 1, sy: -1 } as const;
    case 'se': return { sx: 1, sy: 1 } as const;
    case 'sw': return { sx: -1, sy: 1 } as const;
    case 'nw':
    default: return { sx: -1, sy: -1 } as const;
  }
};

const getCornerAnchor = (handle: CornerHandle, rect: { x: number; y: number; w: number; h: number }) => {
  switch (handle) {
    case 'ne':
      return { x: rect.x, y: rect.y + rect.h };
    case 'se':
      return { x: rect.x, y: rect.y };
    case 'sw':
      return { x: rect.x + rect.w, y: rect.y };
    case 'nw':
    default:
      return { x: rect.x + rect.w, y: rect.y + rect.h };
  }
};

const computeCornerResize = (params: {
  handle: CornerHandle;
  pointerPx: { x: number; y: number };
  initRect: { x: number; y: number; w: number; h: number };
  outSize: { w: number; h: number };
  aspect: number;
  config: typeof cfg.value;
}) => {
  const { handle, pointerPx, initRect, outSize, aspect, config } = params;
  if (!outSize.w || !outSize.h) return null;
  const anchorNorm = getCornerAnchor(handle, initRect);
  const dir = getCornerDirection(handle);
  const anchorPx = { x: anchorNorm.x * outSize.w, y: anchorNorm.y * outSize.h };

  const deltaX = pointerPx.x - anchorPx.x;
  const deltaY = pointerPx.y - anchorPx.y;
  const effDeltaX = dir.sx * deltaX < 0 ? 0 : Math.abs(deltaX);
  const effDeltaY = dir.sy * deltaY < 0 ? 0 : Math.abs(deltaY);

  const minWidthPx = config.cropMinW * outSize.w;
  const maxWidthByConfigPx = config.cropMaxW * outSize.w;
  const horizontalLimitNorm = dir.sx > 0 ? (1 - anchorNorm.x) : anchorNorm.x;
  const horizontalLimitPx = horizontalLimitNorm * outSize.w;
  const verticalLimitNorm = dir.sy > 0 ? (1 - anchorNorm.y) : anchorNorm.y;
  const verticalLimitPx = verticalLimitNorm * outSize.h;
  const maxWidthByHorizontalPx = horizontalLimitPx;
  const maxWidthByVerticalPx = verticalLimitPx * aspect;
  const rawMaxWidthPx = Math.min(maxWidthByConfigPx, maxWidthByHorizontalPx, maxWidthByVerticalPx);
  const maxWidthPx = Math.max(minWidthPx, rawMaxWidthPx);
  if (maxWidthPx <= 0) return null;

  const clampWidthPx = (val: number) => Math.min(Math.max(val, minWidthPx), maxWidthPx);

  const buildCandidate = (widthPxRaw: number) => {
    const widthPx = clampWidthPx(widthPxRaw);
    const heightPx = widthPx / aspect;
    const cornerPx = {
      x: anchorPx.x + dir.sx * widthPx,
      y: anchorPx.y + dir.sy * heightPx,
    };
    return { widthPx, heightPx, cornerPx };
  };

  const candidateByWidth = buildCandidate(effDeltaX);
  const candidateByHeight = buildCandidate(effDeltaY * aspect);
  const errorWidth = Math.hypot(pointerPx.x - candidateByWidth.cornerPx.x, pointerPx.y - candidateByWidth.cornerPx.y);
  const errorHeight = Math.hypot(pointerPx.x - candidateByHeight.cornerPx.x, pointerPx.y - candidateByHeight.cornerPx.y);
  const chosen = errorHeight < errorWidth ? candidateByHeight : candidateByWidth;

  const newW = chosen.widthPx / outSize.w;
  const newH = chosen.heightPx / outSize.h;
  let newX = dir.sx > 0 ? anchorNorm.x : anchorNorm.x - newW;
  let newY = dir.sy > 0 ? anchorNorm.y : anchorNorm.y - newH;

  newX = Math.min(Math.max(0, newX), 1 - newW);
  newY = Math.min(Math.max(0, newY), 1 - newH);

  return { x: newX, y: newY, w: newW, h: newH };
};

const HitTestHandle = (e: PointerEvent): DragHandle => {
  const out = { w: lastDraw.outW, h: lastDraw.outH };
  if (!out.w || !out.h) return null;
  const cvs = canvasRef.value;
  if (!cvs) return null;
  const boxRect = cvs.getBoundingClientRect();
  const ratio = getDevicePixelRatio();
  const ex = (e.clientX - boxRect.left) * ratio;
  const ey = (e.clientY - boxRect.top) * ratio;
  const contentW = out.w * lastDraw.scale;
  const contentH = out.h * lastDraw.scale;
  const contentX = lastDraw.cx - contentW / 2;
  const contentY = lastDraw.cy - contentH / 2;
  const rx = contentX + cropRect.x * contentW;
  const ry = contentY + cropRect.y * contentH;
  const rw = cropRect.w * contentW;
  const rh = cropRect.h * contentH;
  const handles: { id: DragHandle, x: number, y: number }[] = [
    { id: 'nw', x: rx,       y: ry },
    { id: 'ne', x: rx + rw,  y: ry },
    { id: 'sw', x: rx,       y: ry + rh },
    { id: 'se', x: rx + rw,  y: ry + rh },
    { id: 'n',  x: rx + rw/2,y: ry },
    { id: 'e',  x: rx + rw,  y: ry + rh/2 },
    { id: 's',  x: rx + rw/2,y: ry + rh },
    { id: 'w',  x: rx,       y: ry + rh/2 },
  ];
  const thresholdPx = Math.max(12, (cfg.value.handleSize || 16));
  for (const h of handles) {
    const d = Math.hypot(ex - h.x, ey - h.y);
    if (d <= thresholdPx) return h.id;
  }
  return null;
};

const OnPreviewClick = () => {
  // 僅在尚未選擇圖片時才開啟檔案選擇
  if (!imgBitmap.value) TriggerPick();
};

const OnPointerDown = (e: PointerEvent) => {
  if (!cropEnabled.value) return;
  e.preventDefault();
  const handle = HitTestHandle(e);
  const outW = lastDraw.outW, outH = lastDraw.outH;
  if (!outW || !outH) return;
  const p = CanvasPointToOut(e);
  drag.start = p;
  drag.init = { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h };
  if (handle) {
    drag.mode = 'resize';
    drag.handle = handle;
  } else {
    // 點在框內才移動
    const rx = cropRect.x * outW, ry = cropRect.y * outH, rw = cropRect.w * outW, rh = cropRect.h * outH;
    if (p.x >= rx && p.x <= rx + rw && p.y >= ry && p.y <= ry + rh) {
      drag.mode = 'move';
      drag.handle = null;
    } else {
      drag.mode = 'none';
    }
  }
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
};

const OnPointerMove = (e: PointerEvent) => {
  if (drag.mode === 'none') return;
  e.preventDefault();
  const outW = lastDraw.outW, outH = lastDraw.outH;
  if (!outW || !outH) return;
  const p = CanvasPointToOut(e);
  const dx = (p.x - drag.start.x) / outW;
  const dy = (p.y - drag.start.y) / outH;
  if (drag.mode === 'move') {
    let nx = drag.init.x + dx;
    let ny = drag.init.y + dy;
    // 邊界限制
    nx = Math.min(Math.max(0, nx), 1 - cropRect.w);
    ny = Math.min(Math.max(0, ny), 1 - cropRect.h);
    cropRect.x = nx;
    cropRect.y = ny;
    DrawPreview();
  } else if (drag.mode === 'resize' && drag.handle) {
    // 固定比例，支援角與邊把手
    const asp = cropAspect.value;
    const outSize = { w: lastDraw.outW, h: lastDraw.outH };
    const initRect = { x: drag.init.x, y: drag.init.y, w: drag.init.w, h: drag.init.h };
    let nextRect: typeof initRect = { ...initRect };
    let handledByCorner = false;

    if (isCornerHandle(drag.handle)) {
      const cornerResult = computeCornerResize({
        handle: drag.handle,
        pointerPx: { x: p.x, y: p.y },
        initRect,
        outSize,
        aspect: asp,
        config: cfg.value,
      });
      if (cornerResult) {
        nextRect = cornerResult;
        handledByCorner = true;
      }
    }

    if (!handledByCorner) {
      const WtoH = (wn: number) => (wn * outSize.w) / (asp * outSize.h);
      const HtoW = (hn: number) => (hn * asp * outSize.h) / outSize.w;
      const clampW = (val: number) => Math.max(cfg.value.cropMinW, Math.min(val, cfg.value.cropMaxW));

      if (drag.handle === 'e') {
        // 右邊為錨：以中心Y容量與右側水平容量共同限制寬度
        const cy = initRect.y + initRect.h / 2;
        const HcapY = Math.min(1, 2 * Math.min(cy, 1 - cy));
        const WcapY = (HcapY * asp * outSize.h) / outSize.w;
        const WcapX = 1 - initRect.x;
        const desiredW = clampW(initRect.w + dx);
        const cappedW = Math.max(cfg.value.cropMinW, Math.min(desiredW, WcapX, WcapY, cfg.value.cropMaxW));
        const cappedH = WtoH(cappedW);
        const centeredY = cy - cappedH / 2;
        nextRect.w = cappedW;
        nextRect.h = cappedH;
        nextRect.x = initRect.x;
        nextRect.y = Math.min(Math.max(0, centeredY), 1 - cappedH);
      } else if (drag.handle === 'w') {
        // 左邊為錨：以中心Y容量與左側水平容量共同限制寬度
        const cy = initRect.y + initRect.h / 2;
        const HcapY = Math.min(1, 2 * Math.min(cy, 1 - cy));
        const WcapY = (HcapY * asp * outSize.h) / outSize.w;
        const WcapX = initRect.x + initRect.w;
        const desiredW = clampW(initRect.w - dx);
        const cappedW = Math.max(cfg.value.cropMinW, Math.min(desiredW, WcapX, WcapY, cfg.value.cropMaxW));
        const cappedH = WtoH(cappedW);
        const candX = initRect.x + (initRect.w - cappedW);
        const centeredY = initRect.y + (initRect.h - cappedH) / 2;
        nextRect.w = cappedW;
        nextRect.h = cappedH;
        nextRect.x = candX;
        nextRect.y = Math.min(Math.max(0, centeredY), 1 - cappedH);
      } else if (drag.handle === 's') {
        const candidateH = initRect.h + dy;
        nextRect.w = clampW(HtoW(candidateH));
        nextRect.h = WtoH(nextRect.w);
        nextRect.y = initRect.y;
        nextRect.x = initRect.x + (initRect.w - nextRect.w) / 2;
      } else if (drag.handle === 'n') {
        const candidateH = initRect.h - dy;
        nextRect.w = clampW(HtoW(candidateH));
        nextRect.h = WtoH(nextRect.w);
        nextRect.y = initRect.y + (initRect.h - nextRect.h);
        nextRect.x = initRect.x + (initRect.w - nextRect.w) / 2;
      }
    }

    const ratio = getDevicePixelRatio();
    const snapX = (cfg.value.snapPx * ratio) / (lastDraw.scale * outSize.w);
    const snapY = (cfg.value.snapPx * ratio) / (lastDraw.scale * outSize.h);
    if (Math.abs(nextRect.x - 0) < snapX) nextRect.x = 0;
    if (Math.abs(nextRect.y - 0) < snapY) nextRect.y = 0;
    if (Math.abs((nextRect.x + nextRect.w) - 1) < snapX) nextRect.x = 1 - nextRect.w;
    if (Math.abs((nextRect.y + nextRect.h) - 1) < snapY) nextRect.y = 1 - nextRect.h;

    nextRect.x = Math.min(Math.max(0, nextRect.x), 1 - nextRect.w);
    nextRect.y = Math.min(Math.max(0, nextRect.y), 1 - nextRect.h);
    nextRect.w = Math.min(nextRect.w, 1 - nextRect.x);
    nextRect.h = Math.min(nextRect.h, 1 - nextRect.y);

    cropRect.x = nextRect.x;
    cropRect.y = nextRect.y;
    cropRect.w = nextRect.w;
    cropRect.h = nextRect.h;
    DrawPreview();
  }
};

// 指標抬起
const OnPointerUp = (e: PointerEvent) => {
  e.preventDefault();
  drag.mode = 'none';
  drag.handle = null;
  (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
};

// 匯出：以原始像素維度（含旋轉後寬高）渲染至離屏 canvas，避免失真
const ExportImage = async () => {
  if (!hasImage.value || !srcFile.value) {
    ElMessage.warning('請先選擇圖片');
    return;
  }
  const img = imgBitmap.value as any;
  const out = GetTransformedSize(natural.w, natural.h, transform.angle);

  // 先渲染完整旋轉/鏡像後的畫面到大畫布
  const off = document.createElement('canvas');
  off.width = out.w;
  off.height = out.h;
  const ctx = off.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.translate(off.width / 2, off.height / 2);
  // 先旋轉再鏡像，避免鏡像導致旋轉方向顛倒
  ApplyImageTransform(ctx, transform.angle, transform.flipX, transform.flipY);
  ctx.drawImage(img, -natural.w / 2, -natural.h / 2, natural.w, natural.h);
  ctx.restore();

  // 若開啟裁切，將居中裁切為指定比例
  let finalCanvas = off;
  if (cropEnabled.value) {
    const cw = Math.round(cropRect.w * out.w);
    const ch = Math.round(cropRect.h * out.h);
    const sx0 = Math.floor(cropRect.x * out.w);
    const sy0 = Math.floor(cropRect.y * out.h);
    const cut = document.createElement('canvas');
    cut.width = cw;
    cut.height = ch;
    const cctx = cut.getContext('2d');
    if (!cctx) return;
    cctx.drawImage(off, sx0, sy0, cw, ch, 0, 0, cw, ch);
    finalCanvas = cut;
  }

  // 匯出 MIME 預設為 JPEG（可由 props 控制）
  const mime = cfg.value.preferJPEG ? 'image/jpeg' : (natural.type || srcFile.value.type || 'image/png');
  const quality = mime === 'image/jpeg' ? 0.92 : undefined;
  const blob: Blob = await new Promise((resolve, reject) => {
    finalCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失敗'))), mime, quality as any);
  });

  // 產生新檔案名稱
  const name = (() => {
    const n = srcFile.value!.name || 'image';
    const dot = n.lastIndexOf('.');
    const base = dot > -1 ? n.slice(0, dot) : n;
    const ext = dot > -1 ? n.slice(dot) : '';
    return `${base}-edited${ext || (mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : '')}`;
  })();

  const outFile = new File([blob], name, { type: blob.type, lastModified: Date.now() });
  props.resolve(outFile);
  $option.OnClose();
};

</script>

<template lang="pug">
ElDialogPlus.OpenDialogImageSelect(
  v-model="$option.visible.value"
  type="info"
  width="600px"
  hiddenFooter
  :title="cfg.title"
)
  .edit-area
    input(type="file" accept="image/*" ref="fileInputRef" @change="OnPickFile" style="display:none")

    //- 預覽區（RWD）
    .preview(ref="containerRef" @click="OnPreviewClick")
      canvas(ref="canvasRef" @pointerdown="OnPointerDown" @pointermove="OnPointerMove" @pointerup="OnPointerUp" @pointerleave="OnPointerUp")
      //- 刪除按鈕（在有圖時顯示）
      .delete-btn(v-if="imgBitmap" @click.stop="ClearImage") 
        NuxtIcon(name="my-icon:trash")
      .placeholder(v-if="!imgBitmap") 點擊這裡選擇圖片

    //- 工具列（移到圖片下方）
    .toolbar
      ElTooltip(effect="dark" content="向左旋轉" placement="top")
        .ctrl-btn(@click="() => Rotate(-90)")
          NuxtIcon(name="my-icon:rotate-l")
      ElTooltip(effect="dark" content="向右旋轉" placement="top")
        .ctrl-btn(@click="() => Rotate(90)")
          NuxtIcon(name="my-icon:rotate-r")
      ElTooltip(effect="dark" content="水平鏡像" placement="top")
        .ctrl-btn(@click="ToggleFlipX")
          NuxtIcon(name="my-icon:mirror")
      //- ElTooltip(effect="dark" content="垂直鏡像" placement="top")
      //-   .ctrl-btn(@click="ToggleFlipY")
      //-     NuxtIcon(name="my-icon:mirror-v")
      ElTooltip(effect="dark" content="重置" placement="top")
        .ctrl-btn(@click="ResetTransform")
          NuxtIcon(name="my-icon:reset")

    //- 底部操作
    .footer
    .confirm-btn(type="primary" :disabled="!imgBitmap" @click="ExportImage") 確認
</template>

<style lang="scss" scoped>
.OpenDialogImageSelect {
  .edit-area {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .toolbar {
    @include center(8px);
  }

  .preview {
    position: relative;
    width: 100%;
    // RWD 高度策略：桌機較高，手機較矮
    height: 60vh;
    max-height: 640px;
    min-height: 240px;
    // border: 2px dashed #6A574E;
    border-radius: 8px;
    overflow: hidden;
    background: #00000094;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    .placeholder {
      position: absolute;
      color: white;
      @include fs(24px);
    }
    .delete-btn {
      @include absolute('tr', 4px, 4px);
      @include btn-click;
      @include wh(35px, 35px);
      @include center;
      @include fs(28px);
      border-radius: 10px;
      background-color: #fff ;
      color: $primary;
      opacity: 0.7;
    }
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none; // 允許 pointer 事件拖曳
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .ctrl-btn {
    @include btn-click;
    @include wh(35px, 35px);
    @include center;
    @include fs(28px);
    border-radius: 10px;
    background: $primary;
    color: white;
    opacity: 0.7;
  }

  .confirm-btn {
    @include btn-click;
    @include wh(100%, 40px);
    @include center;
    @include fs(16px, bold);
    border-radius: 8px;
    background: $primary;
    color: white;
    opacity: 0.7;
    &[disabled="true"] {
      cursor: not-allowed;
      background: gray;
      opacity: .5;
    }
  }
}

</style>
