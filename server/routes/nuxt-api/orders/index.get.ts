// GET /nuxt-api/orders — 取得訂單列表（Stage 5 接 Firestore 後填入真實查詢）

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { userId } = query as { userId?: string };

  if (!userId) {
    return {
      data: [],
      status: { code: 400, message: { zh_tw: '缺少使用者 ID', en: 'Missing userId', ja: 'ユーザー ID が不足しています' } },
    };
  }

  // Stage 5 將替換為 Firestore 查詢
  return {
    data: [],
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
});
