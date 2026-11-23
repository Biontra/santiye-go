import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { normalizeTurkishPhone } from '@/lib/services/sms-service';
import { sendEmailOtp, isDisposableEmail } from '@/lib/services/email-service';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { clientKey, createOtpToken, generateOtpCode, getOtpSecret } from '@/lib/security/otp-token';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const phone = body?.phone;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body?.name === 'string' ? body.name : undefined;

    if (!email || !phone || typeof phone !== 'string') {
      return NextResponse.json(
        { success: false, message: 'E-posta ve telefon bilgisi zorunludur.' },
        { status: 400 }
      );
    }

    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { success: false, message: 'Geçerli bir e-posta adresi giriniz.' },
        { status: 400 }
      );
    }

    if (isDisposableEmail(email)) {
      return NextResponse.json(
        { success: false, message: 'Geçici / tek kullanımlık e-posta adresleri kabul edilmemektedir.' },
        { status: 400 }
      );
    }

    const { valid, formatted } = normalizeTurkishPhone(phone);
    if (!valid) {
      return NextResponse.json(
        { success: false, message: 'Geçerli bir Türkiye telefon numarası (05XX XXX XX XX) giriniz.' },
        { status: 400 }
      );
    }

    // Kötüye kullanım (e-posta bombardımanı / üçüncü kişiye spam) sınırları.
    // Not: bellek içi sayaç sunucu örneği başınadır; kalıcı sınır için DB cooldown'ı da kullanılır.
    const ip = clientKey(req);
    const limits = [
      checkRateLimit(`otp-send:ip:${ip}`, 10, 10 * 60 * 1000),
      checkRateLimit(`otp-send:email:${email}`, 3, 10 * 60 * 1000),
      checkRateLimit(`otp-send:phone:${formatted}`, 3, 10 * 60 * 1000),
    ];
    const blocked = limits.find((l) => !l.allowed);
    if (blocked) {
      return NextResponse.json(
        { success: false, message: 'Çok fazla kod isteği gönderdiniz. Lütfen birkaç dakika sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(blocked.resetInMs / 1000)) } }
      );
    }

    const secret = getOtpSecret();
    if (!secret) {
      console.error('[send-otp] OTP_SIGNING_SECRET veya SUPABASE_SERVICE_ROLE_KEY tanımlı değil.');
      return NextResponse.json(
        { success: false, message: 'Doğrulama servisi şu anda kullanılamıyor.' },
        { status: 503 }
      );
    }

    // 6 haneli, kriptografik olarak güvenli kod
    const code = generateOtpCode();

    // 1. Veritabanı kaydı + kalıcı 60 sn bekleme (yalnızca service_role çağırabilir)
    try {
      const admin = createServiceRoleClient();
      const { data } = await admin.rpc('request_phone_otp', {
        p_phone: formatted,
        p_code_hash: crypto.createHash('sha256').update(code).digest('hex'),
      });
      if (data && data.success === false && data.error === 'RATE_LIMIT_COOLDOWN') {
        return NextResponse.json(
          {
            success: false,
            message: `Yeni kod için ${data.remaining_seconds ?? 60} saniye beklemelisiniz.`,
          },
          { status: 429 }
        );
      }
    } catch {
      // Service role / RPC yoksa imzalı jeton ile doğrulama devam eder
    }

    // 2. Resend üzerinden e-posta gönderimi
    const emailResult = await sendEmailOtp(email, code, name);
    if (!emailResult.success) {
      return NextResponse.json(
        { success: false, message: emailResult.error || 'Doğrulama e-postası gönderilemedi.' },
        { status: 500 }
      );
    }

    // 3. İmzalı, telefona bağlı oturum jetonu (kod anahtarlı HMAC olarak saklanır)
    const signedToken = createOtpToken(secret, formatted, email, code);

    const response = NextResponse.json({
      success: true,
      message: `${email} adresinize 6 haneli güvenlik onay kodu gönderildi.`,
      otpToken: signedToken,
      expiresInSeconds: 300,
    });

    response.cookies.set('santiye_otp_session', signedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[send-otp] error:', err);
    return NextResponse.json(
      { success: false, message: 'Onay kodu oluşturulamadı.' },
      { status: 500 }
    );
  }
}
