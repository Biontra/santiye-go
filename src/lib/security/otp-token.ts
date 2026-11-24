import crypto from 'crypto';

/**
 * İmzalı OTP oturum jetonu (sunucu tarafı).
 *
 * - Kod jetonda ASLA düz ya da sade SHA-256 olarak bulunmaz: 6 haneli kodun sade hash'i
 *   milisaniyeler içinde kaba kuvvetle çözülür. Bunun yerine sunucu sırrıyla anahtarlı
 *   HMAC kullanılır; sır olmadan çevrimdışı deneme imkânsızdır.
 * - Jeton telefon ve e-postaya bağlıdır; başka bir numara için kullanılamaz.
 * - Sır koddan okunmaz: OTP_SIGNING_SECRET (tercih edilen) veya SUPABASE_SERVICE_ROLE_KEY.
 *   Üretimde ikisi de yoksa jeton üretilmez (fail-closed).
 */

let devFallbackSecret: string | null = null;

export function getOtpSecret(): string | null {
  const configured = process.env.OTP_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === 'production') return null;
  // Yalnızca yerel geliştirme: süreç başına rastgele sır (koda gömülü sabit sır yok).
  if (!devFallbackSecret) devFallbackSecret = crypto.randomBytes(32).toString('hex');
  return devFallbackSecret;
}

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function mac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function safeEq(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function codeMac(secret: string, phone: string, email: string, nonce: string, code: string): Buffer {
  return mac(secret, `otp-code|${phone}|${email}|${nonce}|${code.trim()}`);
}

/** Kriptografik olarak güvenli 6 haneli kod. */
export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function createOtpToken(
  secret: string,
  phone: string,
  email: string,
  code: string,
  ttlMs = 5 * 60 * 1000
): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = JSON.stringify({
    v: 2,
    phone,
    email,
    nonce,
    exp: Date.now() + ttlMs,
    cm: codeMac(secret, phone, email, nonce, code).toString('hex'),
  });
  const body = b64u(payload);
  return `${body}.${b64u(mac(secret, `otp-token|${body}`))}`;
}

export type OtpTokenCheck = { valid: boolean; reason?: string; email?: string };

export function verifyOtpToken(
  secret: string,
  token: string,
  enteredCode: string,
  phone: string
): OtpTokenCheck {
  try {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return { valid: false, reason: 'Doğrulama bilgisi okunamadı.' };

    const expectedSig = mac(secret, `otp-token|${body}`);
    if (!safeEq(Buffer.from(sig, 'base64url'), expectedSig)) {
      return { valid: false, reason: 'Geçersiz güvenlik imzası.' };
    }

    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (data?.v !== 2 || typeof data.exp !== 'number' || Date.now() > data.exp) {
      return { valid: false, reason: 'Doğrulama kodunun 5 dakikalık süresi doldu. Lütfen yeni kod isteyin.' };
    }

    // Telefon bağlama: jeton başka bir numara için kullanılamaz.
    if (data.phone !== phone) {
      return { valid: false, reason: 'Bu kod farklı bir telefon numarası için üretildi.' };
    }

    const expectedCode = codeMac(secret, data.phone, data.email, data.nonce, enteredCode);
    if (!safeEq(Buffer.from(String(data.cm), 'hex'), expectedCode)) {
      return { valid: false, reason: 'Girdiğiniz 6 haneli kod hatalı.' };
    }

    return { valid: true, email: typeof data.email === 'string' ? data.email : undefined };
  } catch {
    return { valid: false, reason: 'Doğrulama bilgisi okunamadı.' };
  }
}

/** İstemci IP'si (proxy başlıkları; yalnızca hız sınırı anahtarı olarak kullanılır). */
export function clientKey(req: { headers: Headers }): string {
  const xff = req.headers.get('x-forwarded-for');
  const ip = (xff ? xff.split(',')[0] : req.headers.get('x-real-ip')) || 'unknown';
  return ip.trim().slice(0, 64);
}
