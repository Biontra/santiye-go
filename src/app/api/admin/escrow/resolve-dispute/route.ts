import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

/** Zamanlama saldırısına dayanıklı dize karşılaştırması. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * SHA-256 Hash Helper for Replay Attack Prevention
 */
function hashTwoFactorCode(adminId: string, code: string): string {
  return crypto.createHash('sha256').update(`${adminId}:${code.trim()}`).digest('hex');
}

/**
 * Server-Side TOTP Code Verification
 * Verifies 30-second time-step window (current, -1 step, +1 step).
 */
function verifyTotpCode(code: string, secret: string): boolean {
  if (!code || !secret) return false;
  const cleanCode = code.trim();

  // 1. Direct secret match (e.g. emergency static pin if configured)
  if (safeEqual(cleanCode, secret.trim())) return true;

  // 2. RFC 6238 Standard Time-based One Time Password (TOTP)
  const epochStep = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const step = epochStep + offset;
    const stepBuffer = Buffer.alloc(8);
    stepBuffer.writeBigInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'utf-8')).update(stepBuffer).digest();
    const codeInt = (hmac.readUInt32BE(hmac[hmac.length - 1] & 0x0f) & 0x7fffffff) % 1000000;
    const expectedTotp = codeInt.toString().padStart(6, '0');
    if (safeEqual(cleanCode, expectedTotp)) return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    // paymentId tercih edilir; geriye dönük uyumluluk için disputeId (payment_disputes.id) de kabul edilir.
    const { paymentId, disputeId, action, notes, twoFactorCode } = body || {};
    const buyerRefundCents = Number(body?.buyerRefundCents ?? 0);
    const companyTransferCents = Number(body?.companyTransferCents ?? 0);

    if ((!paymentId && !disputeId) || !action || !notes || !twoFactorCode) {
      return NextResponse.json(
        { error: 'Eksik parametre: paymentId (veya disputeId), action, notes ve twoFactorCode zorunludur.' },
        { status: 400 }
      );
    }

    if (
      typeof notes !== 'string' ||
      typeof twoFactorCode !== 'string' ||
      typeof action !== 'string' ||
      (paymentId !== undefined && typeof paymentId !== 'string') ||
      (disputeId !== undefined && typeof disputeId !== 'string')
    ) {
      return NextResponse.json({ error: 'Geçersiz parametre türü.' }, { status: 400 });
    }

    // Eski istemci adlarını veritabanı fonksiyonunun çözüm türlerine eşle.
    const ACTION_MAP: Record<string, 'transfer_to_company' | 'full_refund_to_buyer' | 'split'> = {
      transfer_to_company: 'transfer_to_company',
      payout_to_seller: 'transfer_to_company',
      full_refund_to_buyer: 'full_refund_to_buyer',
      refund_to_buyer: 'full_refund_to_buyer',
      refund_buyer: 'full_refund_to_buyer',
      split: 'split',
    };
    const resolutionType = ACTION_MAP[action];
    if (!resolutionType) {
      return NextResponse.json({ error: 'Geçersiz çözüm türü.' }, { status: 400 });
    }
    if (
      resolutionType === 'split' &&
      (!Number.isInteger(buyerRefundCents) ||
        !Number.isInteger(companyTransferCents) ||
        buyerRefundCents < 0 ||
        companyTransferCents < 0)
    ) {
      return NextResponse.json({ error: 'Paylaşım tutarları geçersiz.' }, { status: 400 });
    }

    if (notes.trim().length < 15) {
      return NextResponse.json(
        { error: 'Gerekçe en az 15 karakter olmalı ve denetim loglarına işlenmelidir.' },
        { status: 400 }
      );
    }

    const serviceClient = createServiceRoleClient();

    // 1. Sunucu tarafı kimlik: çerez oturumu veya Bearer jetonu. İstek gövdesinden
    //    gelen bir yönetici kimliği ASLA kullanılmaz (başkası adına işlem yapılamaz).
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let adminUser: { id: string; email?: string | null; app_metadata?: Record<string, any> } | null = null;
    if (token) {
      const { data: authData, error: userErr } = await serviceClient.auth.getUser(token);
      if (!userErr && authData.user) adminUser = authData.user;
    } else {
      const sessionClient = await createClient();
      const {
        data: { user },
      } = await sessionClient.auth.getUser();
      adminUser = user;
    }

    if (!adminUser) {
      return NextResponse.json(
        { error: 'Yetkisiz erişim: Geçersiz veya süresi dolmuş oturum.' },
        { status: 401 }
      );
    }

    const authenticatedAdminId = adminUser.id;
    // AAL2 yalnızca sunucu denetimindeki app_metadata'dan okunur (user_metadata değil).
    const isAal2Verified = adminUser.app_metadata?.aal === 'aal2';

    // Rol Kontrolü: gerçekten admin veya super_admin mi? (rol veritabanından okunur)
    const { data: profile, error: profErr } = await serviceClient
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', authenticatedAdminId)
      .single();

    if (profErr || !profile || !['admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Erişim Engellendi: Bu işlem yalnızca sistem yöneticileri (admin/super_admin) tarafından yürütülebilir.' },
        { status: 403 }
      );
    }

    // 2. Yönetici Başına 2FA Kodu Doğrulama & Hız Sınırı / Replay Koruması
    const codeHash = hashTwoFactorCode(authenticatedAdminId, twoFactorCode);
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

    // Veritabanı tabanlı yanlış deneme sınırı ve replay kontrolü
    // Yöneticiye özel secret (varsa profile/metadata, yoksa güvenli admin totp secret)
    // Üretimde ADMIN_2FA_SECRET zorunludur: tahmin edilebilir yedek sır kabul edilmez.
    const configuredSecret = process.env.ADMIN_2FA_SECRET;
    if (process.env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 16)) {
      console.error('[resolve-dispute] ADMIN_2FA_SECRET tanımlı değil veya 16 karakterden kısa.');
      return NextResponse.json(
        { error: 'Yönetici 2FA yapılandırması eksik; işlem güvenlik nedeniyle durduruldu.' },
        { status: 503 }
      );
    }
    const adminSecret = configuredSecret || `admin-sec-${authenticatedAdminId.slice(0, 8)}`;
    const isCodeMatch = isAal2Verified || verifyTotpCode(twoFactorCode, adminSecret);

    const { data: rateCheck, error: rateErr } = await serviceClient.rpc('check_and_record_admin_2fa', {
      p_admin_id: authenticatedAdminId,
      p_code_hash: codeHash,
      p_success: isCodeMatch,
      p_ip_address: clientIp.slice(0, 45),
      p_details: {
        payment_id: paymentId ?? null,
        dispute_id: disputeId ?? null,
        action: resolutionType,
        aal2: isAal2Verified,
        attempted_at: new Date().toISOString(),
      },
    });

    if (rateErr) {
      console.warn('check_and_record_admin_2fa error:', rateErr.message);
      // Deneme sınırı/replay koruması çalışmıyorsa üretimde işlem yapılmaz (kaba kuvvet riski).
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          { error: '2FA doğrulama servisi kullanılamıyor; lütfen daha sonra tekrar deneyin.' },
          { status: 503 }
        );
      }
    } else if (rateCheck?.error_code === 'ADMIN_2FA_LOCKED_OUT') {
      return NextResponse.json(
        { error: rateCheck.error, code: 'LOCKED_OUT' },
        { status: 429 }
      );
    } else if (rateCheck?.error_code === 'ADMIN_2FA_CODE_REUSED') {
      return NextResponse.json(
        { error: rateCheck.error, code: 'CODE_REUSED' },
        { status: 409 }
      );
    }

    if (!isCodeMatch) {
      return NextResponse.json(
        {
          error: `Geçersiz 2FA onay kodu. Kalan deneme hakkı: ${rateCheck?.remaining_attempts ?? 'Sınırlı'}.`,
          code: 'INVALID_2FA_CODE',
        },
        { status: 403 }
      );
    }

    // 3. Ödeme kaydını belirle
    let targetPaymentId: string | null = typeof paymentId === 'string' ? paymentId : null;
    if (!targetPaymentId && disputeId) {
      const { data: disp } = await serviceClient
        .from('payment_disputes')
        .select('payment_id')
        .eq('id', disputeId)
        .maybeSingle();
      targetPaymentId = disp?.payment_id ?? null;
    }
    if (!targetPaymentId) {
      return NextResponse.json({ error: 'İtiraz / ödeme kaydı bulunamadı.' }, { status: 404 });
    }

    // 4. Service Role RPC ile itirazı çözümle (yalnızca service_role çağırabilir)
    const { data, error } = await serviceClient.rpc('admin_resolve_escrow_dispute', {
      p_payment_id: targetPaymentId,
      p_admin_id: authenticatedAdminId,
      p_resolution_type: resolutionType,
      p_admin_notes: `[SUNUCU 2FA DOĞRULANDI - Yönetici: ${adminUser.email || authenticatedAdminId}] ${notes.trim()}`,
      p_buyer_refund_cents: resolutionType === 'split' ? buyerRefundCents : 0,
      p_company_transfer_cents: resolutionType === 'split' ? companyTransferCents : 0,
    });

    if (error) {
      console.error('[resolve-dispute] rpc error:', error.message);
      return NextResponse.json({ error: 'Uyuşmazlık çözümlenemedi.' }, { status: 400 });
    }
    if (data && data.success === false) {
      return NextResponse.json({ error: data.error || 'Uyuşmazlık çözümlenemedi.' }, { status: 400 });
    }

    // 5. Değiştirilemez Denetim Logu
    try {
      await serviceClient.from('admin_audit_logs').insert({
        action: 'escrow_dispute_manual_resolution_2fa',
        admin_id: authenticatedAdminId,
        target_type: 'payment_transaction',
        target_id: targetPaymentId,
        details: {
          action: resolutionType,
          dispute_id: disputeId ?? null,
          notes,
          admin_email: adminUser.email,
          admin_name: profile.full_name,
          two_factor_verified: true,
          aal2: isAal2Verified,
          ip_address: clientIp,
          resolved_at: new Date().toISOString(),
        },
      });
    } catch {
      // Non-blocking log insertion
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[resolve-dispute] error:', err);
    return NextResponse.json(
      { error: 'Uyuşmazlık çözümlenirken sunucu hatası oluştu.' },
      { status: 500 }
    );
  }
}
