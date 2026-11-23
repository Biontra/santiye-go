import { NextResponse } from 'next/server';
import { confirmDeliveryAndReleaseEscrow } from '@/lib/services/delivery-service';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/security/rate-limiter';

/**
 * Teslimat onayı + escrow serbest bırakma.
 * GÜVENLİK: Aktör ASLA istek gövdesinden alınmaz; doğrulanmış Supabase oturumundan gelir.
 * (Eskiden gövdedeki `actorUserId` kabul ediliyor ve varsayılan 'buyer-demo-001' atanıyordu —
 *  QR/PIN'e sahip herkes, satıcı dahil, ödemeyi kendine serbest bırakabilirdi.)
 */
export async function POST(req: Request) {
  try {
    // 1) Kimlik doğrulama
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      userId = null;
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Oturum gerekli. Lütfen alıcı hesabınızla giriş yapın.' },
        { status: 401 }
      );
    }

    // 2) Hız sınırı (PIN tahmini / kaba kuvvet): kullanıcı başına dakikada 10 deneme
    const rl = checkRateLimit(`delivery-confirm:${userId}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla deneme. Lütfen biraz bekleyip tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetInMs / 1000)) } }
      );
    }

    // 3) Girdi doğrulama
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
    }
    const { tokenOrPin, deliveryNote } = (body ?? {}) as Record<string, unknown>;

    if (typeof tokenOrPin !== 'string' || !tokenOrPin.trim() || tokenOrPin.length > 64) {
      return NextResponse.json(
        { success: false, error: 'tokenOrPin parametresi zorunludur (en fazla 64 karakter).' },
        { status: 400 }
      );
    }
    if (deliveryNote !== undefined && (typeof deliveryNote !== 'string' || deliveryNote.length > 500)) {
      return NextResponse.json(
        { success: false, error: 'deliveryNote en fazla 500 karakterlik metin olmalıdır.' },
        { status: 400 }
      );
    }

    const res = await confirmDeliveryAndReleaseEscrow({
      tokenOrPin: tokenOrPin.trim(),
      actorUserId: userId,
      deliveryNote: typeof deliveryNote === 'string' ? deliveryNote.trim() || undefined : undefined,
      quantityConfirmed: true,
    });

    if (!res.success) {
      const status = res.error?.startsWith('Yetkisiz') ? 403 : 400;
      return NextResponse.json({ success: false, error: res.error }, { status });
    }

    return NextResponse.json({ success: true, waybill: res.waybill, transaction: res.transaction });
  } catch {
    // İç hata ayrıntıları istemciye sızdırılmaz
    return NextResponse.json(
      { success: false, error: 'Beklenmeyen bir sunucu hatası oluştu.' },
      { status: 500 }
    );
  }
}
