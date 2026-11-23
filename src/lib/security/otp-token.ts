import crypto from 'crypto';

/**
 * Doğrulama kodu (OTP) jetonu.
 * Kodun özeti sunucu anahtarıyla (HMAC) alınır; jeton tarayıcıya gitse bile
 * anahtar olmadan 6 haneli kod çevrimdışı denenerek bulunamaz.
 */

type OtpEnv = Record<string, string | undefined>;

/** İmza anahtarı yalnız ortam değişkeninden gelir; koda gömülü yedek anahtar YOKTUR. */
export function getOtpSecret(env: OtpEnv = process.env): string {
  const secret = env.OTP_SIGNING_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('OTP_SIGNING_SECRET ortam değişkeni tanımlı değil; doğrulama kodu üretilemez.');
  }
  return secret;
}

function keyedCodeHash(code: string, phone: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${phone}:${code.trim()}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createSignedOtpToken(
  phone: string,
  email: string,
  code: string,
  expiresAt: number,
  secret: string
): string {
  const payload = JSON.stringify({ phone, email, codeHash: keyedCodeHash(code, phone, secret), expiresAt });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64');
}

export function verifySignedOtpToken(
  token: string,
  enteredCode: string,
  phone: string,
  secret: string
): { valid: boolean; reason?: string } {
  try {
    const { payload, signature } = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (typeof signature !== 'string' || !safeEqualHex(signature, expectedSig)) {
      return { valid: false, reason: 'Geçersiz güvenlik imzası.' };
    }

    const data = JSON.parse(payload);
    if (Date.now() > data.expiresAt) {
      return { valid: false, reason: 'Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin.' };
    }
    if (data.phone !== phone) {
      return { valid: false, reason: 'Bu kod başka bir telefon numarası için üretildi.' };
    }
    if (!safeEqualHex(keyedCodeHash(enteredCode, phone, secret), data.codeHash)) {
      return { valid: false, reason: 'Girdiğiniz 6 haneli kod hatalı.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Doğrulama bilgisi okunamadı.' };
  }
}
