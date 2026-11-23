import crypto from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Zamanlanmış görev yetkisi. CRON_SECRET tanımlı değilse uç KAPALIDIR
 * (eskiden tanımsızken herkese açıktı).
 */
export function isCronAuthorized(
  cronSecret: string | undefined,
  authorizationHeader: string | null,
  customHeader: string | null
): boolean {
  if (!cronSecret) return false;
  const bearer = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice(7) : null;
  return (bearer !== null && safeEqual(bearer, cronSecret)) ||
    (!!customHeader && safeEqual(customHeader, cronSecret));
}
