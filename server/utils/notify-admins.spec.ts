import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendLinePush = vi.fn();
vi.mock('@@/utils/line-push', () => ({ sendLinePush: (...args: unknown[]) => sendLinePush(...args) }));
vi.mock('@@/utils/user-lang', () => ({ getUserLang: vi.fn().mockResolvedValue('zh_tw') }));
vi.mock('@@/utils/admin-notify-message', () => ({
  getAdminNotifyText: (key: string, lang: string) => `${key}:${lang}`,
}));

const { notifyAdmins, notifyAdminsText } = await import('./notify-admins');

/** 假 Firestore：admins collection 只支援 .get() 全表 */
function makeDb(admins: Array<{ id: string; level: string; permissions?: Record<string, boolean> }>) {
  return {
    collection: () => ({
      get: async () => ({
        docs: admins.map((a) => ({ id: a.id, data: () => ({ level: a.level, permissions: a.permissions ?? null }) })),
      }),
    }),
  } as never;
}

const THREE_ADMINS = [
  { id: 'Usuper', level: 'super' },
  { id: 'Uadmin1', level: 'admin', permissions: { canManageAdmins: true } },
  { id: 'Uadmin2', level: 'admin' },
];

describe('notifyAdmins', () => {
  beforeEach(() => {
    sendLinePush.mockReset();
    sendLinePush.mockResolvedValue(true);
  });

  it('業務通知只推 super，其他 admin 不推（走 passenger OA 文字訊息）', async () => {
    const result = await notifyAdmins(makeDb(THREE_ADMINS), 'adminNotify.orderCreated', { orderId: 'ABC' });

    expect(result).toEqual({ delivered: true });
    expect(sendLinePush).toHaveBeenCalledTimes(1);
    expect(sendLinePush).toHaveBeenCalledWith('passenger', 'Usuper', [
      { type: 'text', text: 'adminNotify.orderCreated:zh_tw' },
    ]);
  });

  it('audience=super 的系統告警同樣只推 super', async () => {
    await notifyAdmins(makeDb(THREE_ADMINS), 'adminNotify.authHealthAlert', {}, { audience: 'super' });
    expect(sendLinePush.mock.calls.map((c) => c[1])).toEqual(['Usuper']);
  });

  it('沒有 super → 不推並回報 no-recipients', async () => {
    const result = await notifyAdmins(makeDb([{ id: 'Uadmin1', level: 'admin' }]), 'adminNotify.orderCreated', {});
    expect(result).toEqual({ delivered: false, reason: 'no-recipients' });
    expect(sendLinePush).not.toHaveBeenCalled();
  });

  it('推播失敗（sendLinePush 回 false）→ delivered=false，告警去重才不會誤記已通知', async () => {
    sendLinePush.mockResolvedValue(false);
    const result = await notifyAdmins(makeDb(THREE_ADMINS), 'adminNotify.orderCreated', {});
    expect(result).toEqual({ delivered: false, reason: 'error' });
  });

  it('讀 admins 失敗 → 不 throw，回報 error', async () => {
    const db = { collection: () => ({ get: () => Promise.reject(new Error('firestore down')) }) } as never;
    await expect(notifyAdmins(db, 'adminNotify.orderCreated', {})).resolves.toEqual({ delivered: false, reason: 'error' });
  });
});

describe('notifyAdminsText', () => {
  beforeEach(() => {
    sendLinePush.mockReset();
    sendLinePush.mockResolvedValue(true);
  });

  it('司機審核類現成訊息原文推給 super', async () => {
    const text = '🔔 司機證件待審核\n司機：王\n證件：駕照';
    const result = await notifyAdminsText(makeDb(THREE_ADMINS), text);
    expect(result).toEqual({ delivered: true });
    expect(sendLinePush).toHaveBeenCalledWith('passenger', 'Usuper', [{ type: 'text', text }]);
  });
});
