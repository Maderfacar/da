import { createHmac } from 'node:crypto';

export function verifyLineSignature(secret: string, rawBody: string, signature: string): boolean {
  if (!secret || !signature) return false;
  const hash = createHmac('SHA256', secret).update(rawBody).digest('base64');
  return hash === signature;
}
