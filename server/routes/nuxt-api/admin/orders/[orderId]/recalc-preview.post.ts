/**
 * Wave 1C：訂單 tag 後修「車資重算預覽」endpoint（dry-run，不寫 doc）
 *
 * 用途：admin 在 /admin/orders Edit modal 改 tag 時，UI 先 call 此端點預覽差額，
 * 再經 UseAsk() 二次確認才走 PATCH /nuxt-api/orders/{orderId} 真寫。
 *
 * 流程：
 *   1. 守則：admin only（canManageOrders）+ 訂單未指派司機 + 仍 pending
 *   2. 重 snapshot（validateAndSnapshotPreferences）
 *   3. 重檢 discount（recheckDiscountCode，不 redeem）
 *   4. recalcFinalTotal → 回 { before, after, diff, warnings }
 *
 * 此 endpoint **不**寫 Firestore、**不**寫 audit log、**不**推 LINE。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { validateAndSnapshotPreferences } from '@@/utils/order-preferences';
import { recheckDiscountCode } from '@@/utils/discount-recheck';
import { recalcFinalTotal } from '~shared/fare/recalc';

interface RecalcPreviewBody {
  tagIds?: string[] | null;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({
      zh_tw: '需要訂單管理權限',
      en: 'canManageOrders required',
      ja: '注文管理権限が必要です',
    });
  }

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({
      zh_tw: '缺少訂單 ID',
      en: 'Missing orderId',
      ja: '注文 ID が不足しています',
    });
  }

  const body = await readBody<RecalcPreviewBody>(event);
  if (!body || !Array.isArray(body.tagIds)) {
    return badRequestError({
      zh_tw: 'tagIds 必須為陣列',
      en: 'tagIds must be an array',
      ja: 'tagIds は配列必須',
    });
  }
  const newTagIds = Array.from(
    new Set(body.tagIds.filter((x): x is string => typeof x === 'string' && x.length > 0)),
  );

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return notFoundError({
        zh_tw: '訂單不存在',
        en: 'Order not found',
        ja: '注文が見つかりません',
      });
    }
    const orderData = orderSnap.data() ?? {};

    // 狀態守則：assigned 後 / 非 pending → 403
    const assignedDriverId = (orderData.assignedDriverId as string | undefined) ?? '';
    if (assignedDriverId) {
      return forbiddenError({
        zh_tw: '訂單已指派司機，無法預覽重算',
        en: 'Order already assigned, cannot preview recalc',
        ja: 'ドライバー指定済みのため再計算プレビュー不可',
      });
    }
    const orderStatus = (orderData.orderStatus as string | undefined) ?? '';
    if (orderStatus !== 'pending') {
      return forbiddenError({
        zh_tw: '僅待確認狀態的訂單可預覽重算',
        en: 'Only pending orders can preview recalc',
        ja: '保留中の注文のみ再計算プレビュー可能',
      });
    }

    // 重 snapshot
    const { errors, snapshot } = await validateAndSnapshotPreferences(db, { tagIds: newTagIds });
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.field}:${e.code}`).join(', ');
      return badRequestError({
        zh_tw: `偏好標籤驗證失敗：${summary}`,
        en: `Preferences validation failed: ${summary}`,
        ja: `好み設定のバリデーション失敗：${summary}`,
      });
    }
    const newSnapshot = snapshot ?? {
      tagIds: newTagIds,
      tagSnapshot: [],
      tagSurcharge: 0,
      snapshotAt: new Date().toISOString(),
    };

    // 既有 fare 欄位
    const fareBeforeDiscount = typeof orderData.fareBeforeDiscount === 'number'
      ? orderData.fareBeforeDiscount
      : ((orderData.estimatedFare as number | undefined) ?? 0);
    const tagSurchargeBefore = typeof orderData.preferences === 'object'
      && orderData.preferences !== null
      && typeof (orderData.preferences as { tagSurcharge?: number }).tagSurcharge === 'number'
      ? (orderData.preferences as { tagSurcharge: number }).tagSurcharge
      : 0;
    const discountAmountBefore = typeof orderData.discountAmount === 'number'
      ? orderData.discountAmount
      : 0;
    const tagIdsBefore = typeof orderData.preferences === 'object'
      && orderData.preferences !== null
      && Array.isArray((orderData.preferences as { tagIds?: unknown }).tagIds)
      ? ((orderData.preferences as { tagIds: string[] }).tagIds)
      : [];

    // 重檢折扣
    const recheck = await recheckDiscountCode(db, {
      discountCode: (orderData.discountCode as string | null | undefined) ?? null,
      originalDiscountAmount: discountAmountBefore,
      orderType: (orderData.orderType as string | undefined) ?? '',
      fareBeforeDiscount,
    });

    // 重算
    const beforeCalc = recalcFinalTotal({
      fareBeforeDiscount,
      discountAmount: discountAmountBefore,
      tagSurcharge: tagSurchargeBefore,
    });
    const afterCalc = recalcFinalTotal({
      fareBeforeDiscount,
      discountAmount: recheck.discountAmount,
      tagSurcharge: newSnapshot.tagSurcharge,
    });

    const warnings: string[] = [];
    if (recheck.warning === 'expired_fallback') {
      warnings.push('discount_expired_fallback');
    }

    return successResponse({
      orderId,
      before: {
        tagIds: tagIdsBefore,
        tagSurcharge: beforeCalc.tagSurcharge,
        discountAmount: beforeCalc.discountAmount,
        fareBeforeDiscount: beforeCalc.fareBeforeDiscount,
        finalTotal: beforeCalc.finalTotal,
      },
      after: {
        tagIds: newSnapshot.tagIds,
        tagSnapshot: newSnapshot.tagSnapshot,
        tagSurcharge: afterCalc.tagSurcharge,
        discountAmount: afterCalc.discountAmount,
        fareBeforeDiscount: afterCalc.fareBeforeDiscount,
        finalTotal: afterCalc.finalTotal,
      },
      diff: {
        finalTotal: afterCalc.finalTotal - beforeCalc.finalTotal,
        tagSurcharge: afterCalc.tagSurcharge - beforeCalc.tagSurcharge,
        discountAmount: afterCalc.discountAmount - beforeCalc.discountAmount,
      },
      warnings,
    });
  } catch (err) {
    console.error('[admin/orders/recalc-preview] failed:', err);
    return serverError();
  }
});
