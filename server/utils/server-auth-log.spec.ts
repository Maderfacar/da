import { describe, it, expect, vi } from 'vitest';
import { writeAuthErrorLog } from './server-auth-log';

function makeDb() {
  const addSpy = vi.fn().mockResolvedValue(undefined);
  const db = { collection: vi.fn(() => ({ add: addSpy })) };
  return { db: db as never, addSpy, collectionSpy: db.collection };
}

describe('writeAuthErrorLog', () => {
  it('寫入 client_error_logs，category=auth + schema 對齊', async () => {
    const { db, addSpy, collectionSpy } = makeDb();
    await writeAuthErrorLog(db, {
      event: 'auth.line-login.callback.fail',
      severity: 'warn',
      message: 'invalid state',
      end: 'driver',
      path: '/nuxt-api/auth/line/callback',
      userAgent: 'UA/1.0',
      appVersion: 'abc123',
      lineUserId: 'Uxyz',
      metadata: { stage: 'state' },
    });

    expect(collectionSpy).toHaveBeenCalledWith('client_error_logs');
    const doc = addSpy.mock.calls[0][0];
    expect(doc.category).toBe('auth');
    expect(doc.severity).toBe('warn');
    expect(doc.event).toBe('auth.line-login.callback.fail');
    expect(doc.message).toBe('invalid state');
    expect(doc.context.end).toBe('driver');
    expect(doc.context.lineUserId).toBe('Uxyz');
    expect(doc.context.path).toBe('/nuxt-api/auth/line/callback');
    expect(doc.context.userAgent).toBe('UA/1.0');
    expect(doc.context.appVersion).toBe('abc123');
    expect(doc.context.roles).toEqual([]);
    expect(doc.metadata).toEqual({ stage: 'state' });
  });

  it('無 lineUserId / metadata → lineUserId null 且不含 metadata 欄位', async () => {
    const { db, addSpy } = makeDb();
    await writeAuthErrorLog(db, {
      event: 'auth.line-login.callback.ok',
      severity: 'info',
      message: 'ok',
      end: 'passenger',
      path: '/nuxt-api/auth/line/callback',
    });
    const doc = addSpy.mock.calls[0][0];
    expect(doc.context.lineUserId).toBeNull();
    expect('metadata' in doc).toBe(false);
  });

  it('過長 event / message / path 會被截斷', async () => {
    const { db, addSpy } = makeDb();
    await writeAuthErrorLog(db, {
      event: 'e'.repeat(300),
      severity: 'error',
      message: 'm'.repeat(600),
      end: 'passenger',
      path: '/p'.repeat(400),
    });
    const doc = addSpy.mock.calls[0][0];
    expect(doc.event.length).toBe(200);
    expect(doc.message.length).toBe(500);
    expect(doc.context.path.length).toBe(500);
  });

  it('Firestore add 失敗 → 不 throw（fire-and-forget）', async () => {
    const db = { collection: () => ({ add: () => Promise.reject(new Error('quota')) }) } as never;
    await expect(writeAuthErrorLog(db, {
      event: 'auth.line-login.callback.fail',
      severity: 'error',
      message: 'x',
      end: 'passenger',
      path: '/x',
    })).resolves.toBeUndefined();
  });
});
