interface LineMessage {
  type: 'text';
  text: string;
}

export async function sendLinePush(
  accessToken: string,
  to: string,
  messages: LineMessage[],
): Promise<void> {
  if (!accessToken || !to) return;
  await $fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: { to, messages },
  }).catch((err) => {
    console.error('[line-push] push failed:', err?.data ?? err);
  });
}
