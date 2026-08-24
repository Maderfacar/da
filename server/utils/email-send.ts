/**
 * Email 寄送 — Resend HTTP API
 *
 * 為什麼是 Resend 而不是 SMTP：Vercel serverless 打 SMTP 常被擋且需要額外套件；
 * Resend 是單純的 HTTP POST，用 $fetch 即可，不新增任何相依。
 *
 * 需要的環境變數（未設 → 不寄，只 warn）：
 *   NUXT_RESEND_API_KEY   Resend 後台的 API key
 *   NUXT_ALERT_EMAIL_TO   收件者（預設 youcool15@gmail.com）
 *   NUXT_ALERT_EMAIL_FROM 寄件者（預設 onboarding@resend.dev，Resend 提供的測試網域）
 *
 * **永不 throw**：這支掛在推播的失敗路徑上，它自己失敗不可以再炸一次。
 */
const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'youcool15@gmail.com';
const DEFAULT_FROM = 'DA Alerts <onboarding@resend.dev>';

export interface SendEmailResult {
  sent: boolean;
  /** 未寄出的原因，供呼叫端寫 log。'no-key' 代表根本沒設定 —— 那等於備援沒開 */
  reason?: 'no-key' | 'error';
}

export async function sendEmail(subject: string, text: string): Promise<SendEmailResult> {
  const config = useRuntimeConfig() as {
    resendApiKey?: string;
    alertEmailTo?: string;
    alertEmailFrom?: string;
  };
  const apiKey = config.resendApiKey || process.env.NUXT_RESEND_API_KEY;
  if (!apiKey) {
    // 大聲一點：沒有 key 等於 email 備援完全沒作用，而這件事不會有任何其他徵兆
    console.warn('[email-send] NUXT_RESEND_API_KEY 未設定 —— email 備援未啟用，本封信未寄出');
    return { sent: false, reason: 'no-key' };
  }
  try {
    await $fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: {
        from: config.alertEmailFrom || process.env.NUXT_ALERT_EMAIL_FROM || DEFAULT_FROM,
        to: [config.alertEmailTo || process.env.NUXT_ALERT_EMAIL_TO || DEFAULT_TO],
        subject,
        text,
      },
    });
    return { sent: true };
  } catch (err) {
    console.error('[email-send] 寄送失敗（silent）:', (err as { data?: unknown })?.data ?? err);
    return { sent: false, reason: 'error' };
  }
}
