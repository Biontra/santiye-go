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
    let tokenEmail: string | undefined;

    // 1. İmzalı, telefona bağlı jeton ile doğrulama
    const secret = getOtpSecret();
    if (otpToken && secret) {
      const check = verifyOtpToken(secret, otpToken, code, formatted);
      isVerified = check.valid;
      tokenEmail = check.email?.toLowerCase();
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

    // 3. Doğrulanmış bayraklarını SUNUCUDA işaretle (istemci bu alanları değiştiremez).
    //    Hedef: oturumdaki kullanıcı ya da bu telefona kayıtlı ve e-postası jetondaki
    //    e-postayla eşleşen hesap (kod o e-posta adresine gönderildi).
    try {
      const admin = createServiceRoleClient();
      const session = await createClient();
      const {
        data: { user: sessionUser },
      } = await session.auth.getUser();

      const { data: candidates } = await admin.from('profiles').select('id, phone').eq('phone', formatted);
      const targetIds: string[] = [];
      for (const cand of candidates || []) {
        if (sessionUser && cand.id === sessionUser.id) {
          targetIds.push(cand.id);
          continue;
        }
        if (tokenEmail) {
          const { data: authUser } = await admin.auth.admin.getUserById(cand.id);
          if (authUser?.user?.email?.toLowerCase() === tokenEmail) targetIds.push(cand.id);
        }
      }

      const nowIso = new Date().toISOString();
      for (const id of targetIds) {
        await admin
          .from('profiles')
          .update({
            is_phone_verified: true,
            phone_verified_at: nowIso,
            ...(tokenEmail ? { is_email_verified: true, email_verified_at: nowIso } : {}),
          })
          .eq('id', id);
      }
    } catch (markErr) {
      // Profil güncelleme başarısız olsa bile kod doğrulaması geçerlidir.
      console.warn('[verify-otp] profil işaretlenemedi:', markErr);
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
