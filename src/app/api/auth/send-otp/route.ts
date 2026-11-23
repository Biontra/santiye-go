import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { normalizeTurkishPhone } from '@/lib/services/sms-service';
import { sendEmailOtp, isDisposableEmail } from '@/lib/services/email-service';
import { createClient } from '@/lib/supabase/server';
import { createSignedOtpToken, getOtpSecret } from '@/lib/security/otp-token';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const { phone, email, name } = await req.json();

    if (!email || !phone) {
      return NextResponse.json(
        { success: false, message: 'E-posta ve telefon bilgisi zorunludur.' },
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

    // İmza anahtarı yoksa kod üretme (koda gömülü yedek anahtar kullanılmaz)
    let otpSecret: string;
    try {
      otpSecret = getOtpSecret();
    } catch {
      return NextResponse.json(
        { success: false, message: 'Doğrulama servisi yapılandırılmamış.' },
        { status: 503 }
      );
    }

    // Aynı numaraya / aynı adresten kod yağdırmayı sınırla
    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (
      !checkRateLimit(`otp-send:${formatted}`, 3, 10 * 60 * 1000).allowed ||
      !checkRateLimit(`otp-send-ip:${ip}`, 10, 10 * 60 * 1000).allowed
    ) {
      return NextResponse.json(
        { success: false, message: 'Çok fazla kod istendi. Lütfen birkaç dakika sonra tekrar deneyin.' },
        { status: 429 }
      );
    }

    // 6 Haneli Rastgele Güvenlik Kodu
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 dakika

    // 1. Resend Üzerinden E-posta Gönderimi
    const emailResult = await sendEmailOtp(email.trim().toLowerCase(), code, name);
    if (!emailResult.success) {
      return NextResponse.json(
        { success: false, message: emailResult.error || 'Doğrulama e-postası gönderilemedi.' },
        { status: 500 }
      );
    }

    // 2. Supabase phone_verifications RPC'sini dene (Varsa)
    try {
      const supabase = await createClient();
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      await supabase.rpc('request_phone_otp', {
        p_phone: formatted,
        p_code_hash: codeHash,
      });
    } catch {
      // RPC tanımlı değilse bile imzalı oturum tokenı ile doğrulama kesintisiz çalışır
    }

    // 3. İmzalı Güvenli Oturum Tokenı Oluştur
    const signedToken = createSignedOtpToken(formatted, email.trim().toLowerCase(), code, expiresAt, otpSecret);

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
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err.message || 'Onay kodu oluşturulamadı.' },
      { status: 500 }
    );
  }
}
