import crypto from 'crypto';

/** 30 saniyelik adım için 6 haneli zaman tabanlı kod (RFC 6238 düzeni). */
export function generateTotpCode(secret: string, step: number): string {
  const stepBuffer = Buffer.alloc(8);
  stepBuffer.writeBigInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'utf-8')).update(stepBuffer).digest();
  const codeInt = (hmac.readUInt32BE(hmac[hmac.length - 1] & 0x0f) & 0x7fffffff) % 1000000;
  return codeInt.toString().padStart(6, '0');
}

/**
 * Yalnız gerçek zaman tabanlı kodu kabul eder (şimdiki adım, bir önceki, bir sonraki).
 * Gizli anahtarın kendisini "acil durum pini" olarak kabul eden eski yol kaldırıldı.
 */
export function verifyTotpCode(code: string, secret: string, now: number = Date.now()): boolean {
  if (!code || !secret) return false;
  const cleanCode = code.trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const epochStep = Math.floor(now / 30000);
  return [-1, 0, 1].some((offset) => generateTotpCode(secret, epochStep + offset) === cleanCode);
}
