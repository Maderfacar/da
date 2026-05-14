/**
 * P44a：richmenu area editor 拖拉互動 composable
 *
 * 封裝 area editor 的 pointer / keyboard 互動：
 *   - 空白處 drag → 建新 area（createFlow）
 *   - area 內 drag → 整塊位移（moveFlow，含多選保持相對位置）
 *   - 8 個 resize handle drag → 改寬高（resizeFlow，single-select only）
 *   - Ctrl+drag 空白 → 矩形框選（marqueeFlow）
 *   - Shift+click → 加減選
 *   - Delete / Backspace → 刪選中
 *   - Esc → clear selection
 *   - Arrow keys → 1px 位移；Shift+Arrow → 10px
 *
 * 座標策略：所有滑鼠事件以 stageRef.getBoundingClientRect() 為原點換算 preview px，
 * commit 時 / previewScale.value 轉成底圖 px 並 Math.round。
 *
 * Snap：preview 端 snapThresholdPx = 6（default）；候選 = 底圖外框 + 其他 area 4 邊。
 *
 * **不負責 DOM render**（handle / guide / marquee 矩形由 Edit.vue 接 state 畫），
 * 只 expose state + 操作 fn。
 */
import type { Ref } from 'vue';
import type {
  RichmenuArea,
  RichmenuSize,
} from '@/protocol/fetch-api/api/admin/line-richmenu';

export type DragMode = 'idle' | 'create' | 'move' | 'resize' | 'marquee';
export type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface AreaEditorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AreaEditorGuide {
  orientation: 'h' | 'v';
  pos: number; // preview px
}

export interface UseRichmenuAreaEditorParams {
  imageSize: Ref<RichmenuSize | null>;
  previewScale: Ref<number>;
  areas: Ref<RichmenuArea[]>;
  stageRef: Ref<HTMLElement | null>;
  maxAreas: number;
  snapThresholdPx?: number;
  /** create 模式拖距小於此值（preview px）視為誤觸 */
  minCreateDragPx?: number;
}

const DEFAULT_SNAP_PX = 6;
const DEFAULT_MIN_CREATE_DRAG = 20;

export function useRichmenuAreaEditor(params: UseRichmenuAreaEditorParams) {
  const {
    imageSize,
    previewScale,
    areas,
    stageRef,
    maxAreas,
    snapThresholdPx = DEFAULT_SNAP_PX,
    minCreateDragPx = DEFAULT_MIN_CREATE_DRAG,
  } = params;

  // ── State ─────────────────────────────────────────────────
  const selectedIndices = ref<Set<number>>(new Set<number>());
  const dragMode = ref<DragMode>('idle');
  const guides = ref<AreaEditorGuide[]>([]);
  const transientRect = ref<AreaEditorRect | null>(null);
  const marqueeRect = ref<AreaEditorRect | null>(null);

  /** 主編輯 idx（給右側 detail card 用）：multi-select 取最後選中 */
  const primarySelectedIndex = computed<number>(() => {
    if (selectedIndices.value.size === 0) return -1;
    return [...selectedIndices.value].at(-1) ?? -1;
  });

  // ── 拖拉內部 state（不需 reactive） ───────────────────────
  interface DragContext {
    mode: Exclude<DragMode, 'idle'>;
    startX: number; // stage 原點 preview px
    startY: number;
    pointerId: number;
    // create
    // （用 transientRect 即可）
    // move
    /** moveFlow：起拖時各選中 area 的 bounds snapshot（底圖 px） */
    moveSnapshots?: Map<number, { x: number; y: number; w: number; h: number }>;
    // resize
    resizeIdx?: number;
    resizeHandle?: HandlePosition;
    /** resizeFlow：起拖時被改 area 的 bounds snapshot */
    resizeSnapshot?: { x: number; y: number; w: number; h: number };
    // marquee
    // （用 marqueeRect 即可）
  }
  let drag: DragContext | null = null;

  // ── helpers ───────────────────────────────────────────────
  /** stage 座標轉 preview px（含 clamp 到底圖大小） */
  function eventToPreviewPos(e: PointerEvent): { x: number; y: number } | null {
    const stage = stageRef.value;
    if (!stage || !imageSize.value) return null;
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const previewW = imageSize.value.width * previewScale.value;
    const previewH = imageSize.value.height * previewScale.value;
    return {
      x: Math.max(0, Math.min(previewW, x)),
      y: Math.max(0, Math.min(previewH, y)),
    };
  }

  /** preview px → 底圖 px（round 取整） */
  function toImagePx(v: number): number {
    if (previewScale.value <= 0) return 0;
    return Math.round(v / previewScale.value);
  }

  /** 底圖 px → preview px */
  function toPreviewPx(v: number): number {
    return v * previewScale.value;
  }

  /** clamp area bounds 不出底圖（底圖 px） */
  function clampToImage(b: { x: number; y: number; w: number; h: number }) {
    if (!imageSize.value) return b;
    const imgW = imageSize.value.width;
    const imgH = imageSize.value.height;
    const x = Math.max(0, Math.min(imgW - 1, b.x));
    const y = Math.max(0, Math.min(imgH - 1, b.y));
    const w = Math.max(1, Math.min(imgW - x, b.w));
    const h = Math.max(1, Math.min(imgH - y, b.h));
    return { x, y, w, h };
  }

  /**
   * 收集 snap 候選（底圖 px）— x 軸 / y 軸 兩組
   *
   * - 底圖外框：0 / imgW / 0 / imgH
   * - 其他 area 的 4 邊（排除 excludeIdxSet 內的 area）
   */
  function collectSnapTargets(excludeIdxSet: Set<number>): { xs: number[]; ys: number[] } {
    if (!imageSize.value) return { xs: [], ys: [] };
    const xs: number[] = [0, imageSize.value.width];
    const ys: number[] = [0, imageSize.value.height];
    areas.value.forEach((a, i) => {
      if (excludeIdxSet.has(i)) return;
      xs.push(a.bounds.x, a.bounds.x + a.bounds.width);
      ys.push(a.bounds.y, a.bounds.y + a.bounds.height);
    });
    return { xs, ys };
  }

  /**
   * 對被拖的 rect 套 snap，回傳調整後 rect + 觸發的 guides
   *
   * @param rect 被拖的 rect（底圖 px）
   * @param edgesToSnap 此次 drag 需要 snap 的邊（resize 只 snap 動到的邊；move 4 邊都試；create 動到的兩邊 — endX/endY）
   * @param excludeIdxSet 不納入候選的 area idx（自己 / 多選同行者）
   */
  function applySnap(
    rect: { x: number; y: number; w: number; h: number },
    edgesToSnap: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
    excludeIdxSet: Set<number>,
  ): { rect: { x: number; y: number; w: number; h: number }; guides: AreaEditorGuide[] } {
    if (!imageSize.value || previewScale.value <= 0) {
      return { rect, guides: [] };
    }
    const snapImgPx = snapThresholdPx / previewScale.value;
    const { xs, ys } = collectSnapTargets(excludeIdxSet);

    let out = { ...rect };
    const newGuides: AreaEditorGuide[] = [];

    // 找 axis 上最近 target；< snapImgPx 才 snap
    function findNearest(value: number, targets: number[]): number | null {
      let bestDiff = Infinity;
      let best: number | null = null;
      for (const t of targets) {
        const d = Math.abs(t - value);
        if (d < bestDiff) {
          bestDiff = d;
          best = t;
        }
      }
      return bestDiff < snapImgPx ? best : null;
    }

    if (edgesToSnap.left) {
      const t = findNearest(out.x, xs);
      if (t !== null) {
        out = { ...out, w: out.w + (out.x - t), x: t };
        newGuides.push({ orientation: 'v', pos: toPreviewPx(t) });
      }
    }
    if (edgesToSnap.right) {
      const t = findNearest(out.x + out.w, xs);
      if (t !== null) {
        out = { ...out, w: t - out.x };
        newGuides.push({ orientation: 'v', pos: toPreviewPx(t) });
      }
    }
    if (edgesToSnap.top) {
      const t = findNearest(out.y, ys);
      if (t !== null) {
        out = { ...out, h: out.h + (out.y - t), y: t };
        newGuides.push({ orientation: 'h', pos: toPreviewPx(t) });
      }
    }
    if (edgesToSnap.bottom) {
      const t = findNearest(out.y + out.h, ys);
      if (t !== null) {
        out = { ...out, h: t - out.y };
        newGuides.push({ orientation: 'h', pos: toPreviewPx(t) });
      }
    }

    return { rect: out, guides: newGuides };
  }

  // ── 公開：選取相關 ──────────────────────────────────────
  function selectArea(idx: number, additive = false) {
    if (additive) {
      const next = new Set(selectedIndices.value);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      selectedIndices.value = next;
    } else {
      selectedIndices.value = new Set([idx]);
    }
  }

  function clearSelection() {
    if (selectedIndices.value.size === 0) return;
    selectedIndices.value = new Set();
  }

  function deleteSelected() {
    if (selectedIndices.value.size === 0) return;
    const toRemove = [...selectedIndices.value].sort((a, b) => b - a);
    const next = [...areas.value];
    toRemove.forEach((i) => next.splice(i, 1));
    areas.value = next;
    selectedIndices.value = new Set();
  }

  // ── Pointer event handlers ─────────────────────────────
  /**
   * stage 容器（背景圖區）pointerdown：
   *   - Ctrl/Meta 鍵 → marqueeFlow
   *   - 否則 → createFlow
   *
   * 注意：本 handler 應只在「按到背景而非 area / handle」時觸發；
   * area / handle 的 pointerdown 自行 stopPropagation 即可。
   */
  function onPointerDownStage(e: PointerEvent) {
    if (e.button !== 0) return;
    if (areas.value.length >= maxAreas && !(e.ctrlKey || e.metaKey)) {
      // create 模式滿了就不啟動（marquee 仍可用）
    }
    const pos = eventToPreviewPos(e);
    if (!pos) return;
    const stage = stageRef.value;
    if (!stage) return;

    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);

    if (e.ctrlKey || e.metaKey) {
      drag = {
        mode: 'marquee',
        startX: pos.x,
        startY: pos.y,
        pointerId: e.pointerId,
      };
      dragMode.value = 'marquee';
      marqueeRect.value = { x: pos.x, y: pos.y, w: 0, h: 0 };
      clearSelection();
    } else {
      if (areas.value.length >= maxAreas) {
        ElMessage({ message: `最多 ${maxAreas} 個區塊`, type: 'warning' });
        return;
      }
      drag = {
        mode: 'create',
        startX: pos.x,
        startY: pos.y,
        pointerId: e.pointerId,
      };
      dragMode.value = 'create';
      transientRect.value = { x: pos.x, y: pos.y, w: 0, h: 0 };
      clearSelection();
    }
  }

  /**
   * area body pointerdown：開始 moveFlow（或 Shift = 加減選後就停手）
   */
  function onPointerDownArea(e: PointerEvent, idx: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) {
      selectArea(idx, true);
      return;
    }
    // 若 idx 不在 selectedIndices 內 → 改為單選 idx；否則保持多選一起 move
    if (!selectedIndices.value.has(idx)) {
      selectedIndices.value = new Set([idx]);
    }
    const pos = eventToPreviewPos(e);
    if (!pos) return;

    e.preventDefault();
    stageRef.value?.setPointerCapture?.(e.pointerId);

    const snapshots = new Map<number, { x: number; y: number; w: number; h: number }>();
    selectedIndices.value.forEach((i) => {
      const a = areas.value[i];
      if (a) {
        snapshots.set(i, {
          x: a.bounds.x,
          y: a.bounds.y,
          w: a.bounds.width,
          h: a.bounds.height,
        });
      }
    });

    drag = {
      mode: 'move',
      startX: pos.x,
      startY: pos.y,
      pointerId: e.pointerId,
      moveSnapshots: snapshots,
    };
    dragMode.value = 'move';
  }

  /**
   * resize handle pointerdown：開始 resizeFlow（single-select only — 多選不支援 resize）
   */
  function onPointerDownHandle(e: PointerEvent, idx: number, handle: HandlePosition) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (selectedIndices.value.size !== 1) return;

    const a = areas.value[idx];
    if (!a) return;
    const pos = eventToPreviewPos(e);
    if (!pos) return;

    e.preventDefault();
    stageRef.value?.setPointerCapture?.(e.pointerId);

    drag = {
      mode: 'resize',
      startX: pos.x,
      startY: pos.y,
      pointerId: e.pointerId,
      resizeIdx: idx,
      resizeHandle: handle,
      resizeSnapshot: {
        x: a.bounds.x,
        y: a.bounds.y,
        w: a.bounds.width,
        h: a.bounds.height,
      },
    };
    dragMode.value = 'resize';
  }

  /** stage pointermove：依 drag.mode 分派 */
  function onPointerMoveStage(e: PointerEvent) {
    if (!drag) return;
    const pos = eventToPreviewPos(e);
    if (!pos) return;

    if (drag.mode === 'marquee') {
      const x = Math.min(drag.startX, pos.x);
      const y = Math.min(drag.startY, pos.y);
      const w = Math.abs(pos.x - drag.startX);
      const h = Math.abs(pos.y - drag.startY);
      marqueeRect.value = { x, y, w, h };
      return;
    }

    if (drag.mode === 'create') {
      const x = Math.min(drag.startX, pos.x);
      const y = Math.min(drag.startY, pos.y);
      const w = Math.abs(pos.x - drag.startX);
      const h = Math.abs(pos.y - drag.startY);
      // snap：自動把右 / 下 邊試 snap（建框的方向不重要，最後 commit 看四邊）
      const imgRect = {
        x: toImagePx(x),
        y: toImagePx(y),
        w: toImagePx(w),
        h: toImagePx(h),
      };
      const { rect: snapped, guides: g } = applySnap(
        imgRect,
        { left: true, right: true, top: true, bottom: true },
        new Set(), // create 階段沒被排除的 idx
      );
      transientRect.value = {
        x: toPreviewPx(snapped.x),
        y: toPreviewPx(snapped.y),
        w: toPreviewPx(snapped.w),
        h: toPreviewPx(snapped.h),
      };
      guides.value = g;
      return;
    }

    if (drag.mode === 'move' && drag.moveSnapshots) {
      const dxPx = toImagePx(pos.x - drag.startX);
      const dyPx = toImagePx(pos.y - drag.startY);

      // 多選一起拖時，整批位移；snap 以「主編輯 idx」的 4 邊為對齊基準
      const primaryIdx = primarySelectedIndex.value;
      const primarySnap = drag.moveSnapshots.get(primaryIdx);
      let snapDx = 0;
      let snapDy = 0;
      let nextGuides: AreaEditorGuide[] = [];
      if (primarySnap) {
        const tentative = clampToImage({
          x: primarySnap.x + dxPx,
          y: primarySnap.y + dyPx,
          w: primarySnap.w,
          h: primarySnap.h,
        });
        const { rect: snapped, guides: g } = applySnap(
          tentative,
          { left: true, right: true, top: true, bottom: true },
          new Set(selectedIndices.value),
        );
        // snap 後 size 不變（move 不縮）；只取位移補正
        snapDx = snapped.x - primarySnap.x;
        snapDy = snapped.y - primarySnap.y;
        nextGuides = g;
      }

      const next = [...areas.value];
      drag.moveSnapshots.forEach((snap, idx) => {
        const moved = clampToImage({
          x: snap.x + snapDx,
          y: snap.y + snapDy,
          w: snap.w,
          h: snap.h,
        });
        const existing = next[idx];
        if (existing) {
          next[idx] = {
            ...existing,
            bounds: {
              x: moved.x,
              y: moved.y,
              width: moved.w,
              height: moved.h,
            },
          };
        }
      });
      areas.value = next;
      guides.value = nextGuides;
      return;
    }

    if (drag.mode === 'resize' && drag.resizeIdx !== undefined && drag.resizeHandle && drag.resizeSnapshot) {
      const dxPx = toImagePx(pos.x - drag.startX);
      const dyPx = toImagePx(pos.y - drag.startY);
      const snap = drag.resizeSnapshot;
      const h = drag.resizeHandle;

      let x = snap.x;
      let y = snap.y;
      let w = snap.w;
      let hh = snap.h;

      // 各 handle 的更新規則（NW 角：x/y 變，w/h 反向；N 邊：y / h 變；以此類推）
      if (h === 'nw' || h === 'w' || h === 'sw') {
        x = snap.x + dxPx;
        w = snap.w - dxPx;
      }
      if (h === 'ne' || h === 'e' || h === 'se') {
        w = snap.w + dxPx;
      }
      if (h === 'nw' || h === 'n' || h === 'ne') {
        y = snap.y + dyPx;
        hh = snap.h - dyPx;
      }
      if (h === 'sw' || h === 's' || h === 'se') {
        hh = snap.h + dyPx;
      }

      // 防止負寬高翻轉：min 1
      if (w < 1) {
        x = snap.x + snap.w - 1;
        w = 1;
      }
      if (hh < 1) {
        y = snap.y + snap.h - 1;
        hh = 1;
      }

      const clamped = clampToImage({ x, y, w, h: hh });
      // snap：只 snap 被拖的邊
      const edges = {
        left: h === 'nw' || h === 'w' || h === 'sw',
        right: h === 'ne' || h === 'e' || h === 'se',
        top: h === 'nw' || h === 'n' || h === 'ne',
        bottom: h === 'sw' || h === 's' || h === 'se',
      };
      const { rect: snapped, guides: g } = applySnap(clamped, edges, new Set([drag.resizeIdx]));

      const next = [...areas.value];
      const existing = next[drag.resizeIdx];
      if (existing) {
        next[drag.resizeIdx] = {
          ...existing,
          bounds: {
            x: snapped.x,
            y: snapped.y,
            width: snapped.w,
            height: snapped.h,
          },
        };
        areas.value = next;
      }
      guides.value = g;
      return;
    }
  }

  /** stage pointerup：commit + reset drag state */
  function onPointerUpStage(e: PointerEvent) {
    if (!drag) return;
    stageRef.value?.releasePointerCapture?.(drag.pointerId);

    if (drag.mode === 'create' && transientRect.value) {
      // 拖距太小 → 視為誤觸
      const tr = transientRect.value;
      if (tr.w < minCreateDragPx || tr.h < minCreateDragPx) {
        transientRect.value = null;
        guides.value = [];
        drag = null;
        dragMode.value = 'idle';
        return;
      }
      const newArea: RichmenuArea = {
        bounds: {
          x: toImagePx(tr.x),
          y: toImagePx(tr.y),
          width: Math.max(1, toImagePx(tr.w)),
          height: Math.max(1, toImagePx(tr.h)),
        },
        action: { type: 'message', text: `區塊 ${areas.value.length + 1}` },
      };
      const idx = areas.value.length;
      areas.value = [...areas.value, newArea];
      selectedIndices.value = new Set([idx]);
      transientRect.value = null;
    }

    if (drag.mode === 'marquee' && marqueeRect.value) {
      const m = marqueeRect.value;
      if (!imageSize.value || previewScale.value <= 0) {
        marqueeRect.value = null;
      } else {
        // marquee 與 area 矩形相交（preview px）
        const mx1 = m.x;
        const my1 = m.y;
        const mx2 = m.x + m.w;
        const my2 = m.y + m.h;
        const hits = new Set<number>();
        areas.value.forEach((a, i) => {
          const ax1 = toPreviewPx(a.bounds.x);
          const ay1 = toPreviewPx(a.bounds.y);
          const ax2 = toPreviewPx(a.bounds.x + a.bounds.width);
          const ay2 = toPreviewPx(a.bounds.y + a.bounds.height);
          const intersect = !(ax2 < mx1 || ax1 > mx2 || ay2 < my1 || ay1 > my2);
          if (intersect) hits.add(i);
        });
        selectedIndices.value = hits;
        marqueeRect.value = null;
      }
    }

    guides.value = [];
    drag = null;
    dragMode.value = 'idle';
  }

  function onPointerCancelStage(e: PointerEvent) {
    if (!drag) return;
    transientRect.value = null;
    marqueeRect.value = null;
    guides.value = [];
    drag = null;
    dragMode.value = 'idle';
  }

  // ── Keyboard handler ─────────────────────────────────────
  function onKeydown(e: KeyboardEvent) {
    // 在 input / textarea 焦點時不攔截 Delete / Backspace / Arrow（讓字段正常編輯）
    const tgt = e.target as HTMLElement | null;
    const tagInput = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || (tgt as HTMLElement).isContentEditable);

    if (e.key === 'Escape') {
      clearSelection();
      return;
    }
    if (!tagInput && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (selectedIndices.value.size > 0) {
        e.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (!tagInput && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (selectedIndices.value.size === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;

      const next = [...areas.value];
      selectedIndices.value.forEach((idx) => {
        const a = next[idx];
        if (!a) return;
        const moved = clampToImage({
          x: a.bounds.x + dx,
          y: a.bounds.y + dy,
          w: a.bounds.width,
          h: a.bounds.height,
        });
        next[idx] = {
          ...a,
          bounds: { x: moved.x, y: moved.y, width: moved.w, height: moved.h },
        };
      });
      areas.value = next;
    }
  }

  // 自動掛載 keydown
  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeydown);
    }
  });
  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
    }
  });

  // 監聽 areas 變動：若有 index 不存在於 areas 內，從 selectedIndices 移除
  watch(
    () => areas.value.length,
    (len) => {
      const next = new Set<number>();
      selectedIndices.value.forEach((i) => {
        if (i < len) next.add(i);
      });
      if (next.size !== selectedIndices.value.size) {
        selectedIndices.value = next;
      }
    },
  );

  return {
    selectedIndices,
    primarySelectedIndex,
    dragMode,
    guides,
    transientRect,
    marqueeRect,
    onPointerDownStage,
    onPointerDownArea,
    onPointerDownHandle,
    onPointerMoveStage,
    onPointerUpStage,
    onPointerCancelStage,
    selectArea,
    clearSelection,
    deleteSelected,
  };
}
