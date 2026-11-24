import crypto from 'crypto';

/** Zamanlama saldırılarına dayanıklı dize karşılaştırması (uzunluk farkı da sızdırılmaz). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}
