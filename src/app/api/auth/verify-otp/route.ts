import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { normalizeTurkishPhone } from '@/lib/services/sms-service';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { clientKey, getOtpSecret, verifyOtpToken } from '@/lib/security/otp-token';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const phone = body?.phone;
    const code = typeof body?.code === 'string' ? body.code : '';
    let otpToken: string | undefined = typeof body?.otpToken === 'string' ? body.otpToken : undefined;

    if (!otpToken) {
      otpToken = req.cookies.get('santiye_otp_session')?.value;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      return NextResponse.json(
        { success: false, message: 'Lütfen 6 haneli kodu eksiksiz giriniz.' },
        { status: 400 }
      );
    }

    const { valid, formatted } = normalizeTurkishPhone(typeof phone === 'string' ? phone : '');
    if (!valid) {
      return NextResponse.json(
        { success: false, message: 'Geçersiz telefon formatı.' },
        { status: 400 }
      );
    }

    // Kaba kuvvet koruması: 6 haneli kod için deneme sayısı sınırlıdır.
    const ip = clientKey(req);
    const limits = [
      checkRateLimit(`otp-verify:phone:${formatted}`, 5, 5 * 60 * 1000),
      checkRateLimit(`otp-verify:ip:${ip}`, 20, 5 * 60 * 1000),
    ];
    const blocked = limits.find((l) => !l.allowed);
    if (blocked) {
      return NextResponse.json(
        { success: false, message: 'Çok fazla deneme yaptınız. Lütfen yeni bir kod isteyin ve biraz bekleyin.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(blocked.resetInMs / 1000)) } }
      );
    }

    let isVerified = false;

    // 1. İmzalı, telefona bağlı jeton ile doğrulama
    const secret = getOtpSecret();
    if (otpToken && secret) {
      isVerified = verifyOtpToken(secret, otpToken, code, formatted).valid;
    }

    // 2. Veritabanı kaydı ile doğrulama (yedek; yalnızca service_role çağırabilir.
    //    Kayıtları yalnızca send-otp oluşturabildiği için istemci tarafından sahte kod eklenemez.)
    if (!isVerified) {
      try {
        const admin = createServiceRoleClient();
        const { data } = await admin.rpc('verify_phone_otp', {
          p_phone: formatted,
          p_code_hash: crypto.createHash('sha256').update(code.trim()).digest('hex'),
        });
        if (data?.success) isVerified = true;
      } catch {
        // Service role / RPC yoksa jeton kontrolü esastır
      }
    }

    if (!isVerified) {
      return NextResponse.json(
        { success: false, message: 'Girdiğiniz 6 haneli kod hatalı veya süresi dolmuş.' },
        { status: 400 }
      );
    }

    // 3. Oturumdaki kullanıcıyı doğrulanmış olarak işaretle (RLS: yalnızca kendi satırı)
    try {
      const supabase = await createClient();
      await supabase
        .from('profiles')
        .update({
          is_phone_verified: true,
          is_email_verified: true,
          phone_verified_at: new Date().toISOString(),
          email_verified_at: new Date().toISOString(),
        })
        .eq('phone', formatted);
    } catch {
      // Profil güncelleme başarısız olsa bile oturum devam eder
    }

    const response = NextResponse.json({
      success: true,
      message: 'Hesabınız başarıyla doğrulandı!',
    });

    response.cookies.delete('santiye_otp_session');
    return response;
  } catch (err) {
    console.error('[verify-otp] error:', err);
    return NextResponse.json(
      { success: false, message: 'Doğrulama işlemi başarısız oldu.' },
      { status: 500 }
    );
  }
}
