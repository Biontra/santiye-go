import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { normalizeTurkishPhone } from '@/lib/services/sms-service';
import { createClient } from '@/lib/supabase/server';
import { verifySignedOtpToken, getOtpSecret } from '@/lib/security/otp-token';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone, code } = body;
    let otpToken = body.otpToken;

    if (!otpToken) {
      otpToken = req.cookies.get('santiye_otp_session')?.value;
    }

    if (!code || code.trim().length !== 6) {
      return NextResponse.json(
        { success: false, message: 'Lütfen 6 haneli kodu eksiksiz giriniz.' },
        { status: 400 }
      );
    }

    const { valid, formatted } = normalizeTurkishPhone(phone);
    if (!valid) {
      return NextResponse.json(
        { success: false, message: 'Geçersiz telefon formatı.' },
        { status: 400 }
      );
    }

    // Kod deneme sınırı: 6 haneli kodu deneyerek bulmayı engeller
    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (
      !checkRateLimit(`otp-verify:${formatted}`, 5, 10 * 60 * 1000).allowed ||
      !checkRateLimit(`otp-verify-ip:${ip}`, 20, 10 * 60 * 1000).allowed
    ) {
      return NextResponse.json(
        { success: false, message: 'Çok fazla hatalı deneme. Lütfen yeni kod isteyin ve birkaç dakika bekleyin.' },
        { status: 429 }
      );
    }

    let isVerified = false;

    // 1. İmzalı Token ile Doğrulama
    if (otpToken) {
      try {
        const tokenCheck = verifySignedOtpToken(otpToken, code, formatted, getOtpSecret());
        if (tokenCheck.valid) {
          isVerified = true;
        }
      } catch {
        // İmza anahtarı tanımlı değilse jetonla doğrulama yapılmaz
      }
    }

    // 2. Supabase RPC ile Doğrulama (Yedek Mekanizma)
    if (!isVerified) {
      try {
        const supabase = await createClient();
        const codeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
        const { data } = await supabase.rpc('verify_phone_otp', {
          p_phone: formatted,
          p_code_hash: codeHash,
        });
        if (data && data.success) {
          isVerified = true;
        }
      } catch {
        // RPC yoksa token kontrolü esastır
      }
    }

    if (!isVerified) {
      return NextResponse.json(
        { success: false, message: 'Girdiğiniz 6 haneli kod hatalı veya süresi dolmuş.' },
        { status: 400 }
      );
    }

    // 3. Veritabanında Kullanıcıyı Doğrulanmış Olarak İşaretle
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
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err.message || 'Doğrulama işlemi başarısız oldu.' },
      { status: 500 }
    );
  }
}
