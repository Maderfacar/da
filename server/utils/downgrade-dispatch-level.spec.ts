/**
 * Wave 2D：downgradeDispatchLevel transaction 行為單元測試。
 *
 * 用 in-memory fake Firestore（最小子集）模擬：
 *   - db.collection('orders').doc(id)：返回固定 ref
 *   - db.runTransaction(fn)：直接 invoke，提供 tx.get/tx.update
 *
 * 涵蓋場景：
 *   1. mode='downgrade' 從 '2' → '1'
 *   2. mode='downgrade' 從 '1' → '0'
 *   3. mode='downgrade' 從 '0' → already_at_lowest_level
 *   4. mode='force-open' 從 '2' → '0'（不論起始等級直降）
 *   5. mode='auto-downgrade' expectedLevel match → 降級
 *   6. mode='auto-downgrade' expectedLevel mismatch → level_changed
 *   7. 訂單已指派 → already_assigned
 *   8. levelHistory 正確 append
 */
import { describe, it, expect, vi } from 'vitest';
import {
  downgradeDispatchLevel,
  DispatchGuardError,
} from './order-dispatch';

interface FakeOrderDoc {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

function _makeFakeDb(initialData: Record<string, unknown>) {
  // 模擬一份可變 doc state
  const state: { current: Record<string, unknown> | undefined } = { current: initialData };
  const ref = { id: 'order-x' };
  const updates: Array<Record<string, unknown>> = [];

  const doc: FakeOrderDoc = {
    exists: true,
    get data() { return () => state.current; },
  };

  const tx = {
    get: vi.fn(async (r: unknown) => {
      expect(r).toBe(ref);
      return doc;
    }),
    update: vi.fn((r: unknown, patch: Record<string, unknown>) => {
      expect(r).toBe(ref);
      updates.push(patch);
      // 套用 patch 到 state（淺套；nested key 用點記法處理）
      const next = { ...(state.current ?? {}) };
      const vis = { ...((next.dispatchVisibility as Record<string, unknown> | undefined) ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'dispatchVisibility.currentLevel') vis.currentLevel = v;
        else if (k === 'dispatchVisibility.openedAt') vis.openedAt = v;
        else if (k === 'dispatchVisibility.levelHistory') vis.levelHistory = v;
        else next[k] = v;
      }
      next.dispatchVisibility = vis;
      state.current = next;
    }),
  };

  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: (tx: typeof tx) => Promise<unknown>) => {
      return await fn(tx);
    },
  };

  return { db, updates, state, ref, tx };
}

const _orderTemplate = (currentLevel: '0' | '1' | '2', extras: Record<string, unknown> = {}) => ({
  orderStatus: 'pending',
  dispatchAt: new Date(),
  assignedDriverId: null,
  dispatchVisibility: {
    startLevel: '2',
    currentLevel,
    openedAt: new Date(),
    levelHistory: [{ level: currentLevel, openedAt: new Date(), openedBy: 'admin-init', reason: 'init' }],
  },
  ...extras,
});

describe('downgradeDispatchLevel — mode=downgrade', () => {
  it('從 \'2\' 降到 \'1\'', async () => {
    const { db, updates } = _makeFakeDb(_orderTemplate('2'));
    const res = await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'downgrade',
      actor: 'admin-abc',
    });
    expect(res.previousLevel).toBe('2');
    expect(res.newLevel).toBe('1');
    expect(updates).toHaveLength(1);
    expect(updates[0]['dispatchVisibility.currentLevel']).toBe('1');
    const history = updates[0]['dispatchVisibility.levelHistory'] as Array<Record<string, unknown>>;
    expect(history.at(-1)).toMatchObject({ level: '1', openedBy: 'admin-abc', reason: 'manual-downgrade' });
  });

  it('從 \'1\' 降到 \'0\'', async () => {
    const { db } = _makeFakeDb(_orderTemplate('1'));
    const res = await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'downgrade',
      actor: 'admin-abc',
    });
    expect(res.previousLevel).toBe('1');
    expect(res.newLevel).toBe('0');
  });

  it('從 \'0\' → already_at_lowest_level', async () => {
    const { db } = _makeFakeDb(_orderTemplate('0'));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', { mode: 'downgrade', actor: 'admin-abc' }),
    ).rejects.toMatchObject({ code: 'already_at_lowest_level' });
  });
});

describe('downgradeDispatchLevel — mode=force-open', () => {
  it('從 \'2\' 一次降到 \'0\'', async () => {
    const { db, updates } = _makeFakeDb(_orderTemplate('2'));
    const res = await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'force-open',
      actor: 'admin-abc',
    });
    expect(res.previousLevel).toBe('2');
    expect(res.newLevel).toBe('0');
    const history = updates[0]['dispatchVisibility.levelHistory'] as Array<Record<string, unknown>>;
    expect(history.at(-1)).toMatchObject({ level: '0', openedBy: 'admin-abc', reason: 'force-open-all' });
  });

  it('從 \'1\' 一次降到 \'0\'', async () => {
    const { db } = _makeFakeDb(_orderTemplate('1'));
    const res = await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'force-open',
      actor: 'admin-abc',
    });
    expect(res.newLevel).toBe('0');
  });
});

describe('downgradeDispatchLevel — mode=auto-downgrade（race 守則）', () => {
  it('expectedLevel match → 降級 + reason=auto-downgrade + actor=system', async () => {
    const { db, updates } = _makeFakeDb(_orderTemplate('2'));
    const res = await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'auto-downgrade',
      actor: 'system',
      expectedLevel: '2',
    });
    expect(res.newLevel).toBe('1');
    const history = updates[0]['dispatchVisibility.levelHistory'] as Array<Record<string, unknown>>;
    expect(history.at(-1)).toMatchObject({ openedBy: 'system', reason: 'auto-downgrade' });
  });

  it('expectedLevel mismatch（兩司機同時 GET，第二個被擋）→ level_changed', async () => {
    // 模擬：第一個 GET 觸發降級後 currentLevel 變 '1'；第二個 GET 帶 expectedLevel='2'
    const { db } = _makeFakeDb(_orderTemplate('1'));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', {
        mode: 'auto-downgrade',
        actor: 'system',
        expectedLevel: '2',
      }),
    ).rejects.toBeInstanceOf(DispatchGuardError);
  });

  it('缺 expectedLevel → throw Error（dev bug 提前曝出）', async () => {
    const { db } = _makeFakeDb(_orderTemplate('2'));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', {
        mode: 'auto-downgrade',
        actor: 'system',
      }),
    ).rejects.toThrow(/expectedLevel/);
  });
});

describe('downgradeDispatchLevel — guard 守則', () => {
  it('訂單已指派 → already_assigned', async () => {
    const { db } = _makeFakeDb(_orderTemplate('2', { assignedDriverId: 'line:Uxxx' }));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', { mode: 'downgrade', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'already_assigned' });
  });

  it('訂單未派發 → invalid_status', async () => {
    const { db } = _makeFakeDb(_orderTemplate('2', { dispatchAt: null }));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', { mode: 'downgrade', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('orderStatus 非 pending → invalid_status', async () => {
    const { db } = _makeFakeDb(_orderTemplate('2', { orderStatus: 'confirmed' }));
    await expect(
      downgradeDispatchLevel(db as never, 'order-x', { mode: 'downgrade', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'invalid_status' });
  });
});

describe('downgradeDispatchLevel — levelHistory append', () => {
  it('保留既有 init entry + 新增 manual-downgrade entry', async () => {
    const { db, updates } = _makeFakeDb(_orderTemplate('2'));
    await downgradeDispatchLevel(db as never, 'order-x', {
      mode: 'downgrade',
      actor: 'admin-abc',
    });
    const history = updates[0]['dispatchVisibility.levelHistory'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ reason: 'init' });
    expect(history[1]).toMatchObject({ reason: 'manual-downgrade', openedBy: 'admin-abc' });
  });
});
