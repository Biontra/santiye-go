import { NextRequest, NextResponse } from 'next/server';
import { IyzicoPaymentAdapter } from '@/lib/payment/iyzico-adapter';
import { confirmEscrowPaymentPaid } from '@/lib/services/escrow-service';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function POST(req: NextRequest) {
  try {
    // İmza HAM gövde üzerinden doğrulanır; JSON'a çevirme sonradan yapılır.
    const rawText = await req.text();
    if (!rawText || rawText.length > 256 * 1024) {
      return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
    }

    let rawBody: any;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 });
    }
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
    }

    const headersRecord: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headersRecord[key.toLowerCase()] = value;
    });

    const adapter = new IyzicoPaymentAdapter();
    const verification = await adapter.verifyWebhook(headersRecord, rawBody, rawText);

    if (!verification.isValid) {
      return NextResponse.json(
        { error: 'Geçersiz webhook imzası (HMAC-SHA256 doğrulaması başarısız).' },
        { status: 400 }
      );
    }

    const eventId = String(rawBody.eventId || rawBody.paymentId || `evt-${Date.now()}`).slice(0, 128);

    // Webhook idempotency: tablo yalnızca service_role'e açıktır (RLS/REVOKE).
    let eventsDb: ReturnType<typeof createServiceRoleClient> | null = null;
    try {
      eventsDb = createServiceRoleClient();
      const { data: existingEvent } = await eventsDb
        .from('payment_webhook_events')
        .select('id, processed')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existingEvent?.processed) {
        return NextResponse.json({ success: true, idempotent_replay: true });
      }

      await eventsDb.from('payment_webhook_events').upsert({
        event_id: eventId,
        provider: 'iyzico',
        event_type: String(rawBody.eventType || 'payment.success').slice(0, 50),
        signature: headersRecord['x-iyz-signature'] || headersRecord['x-signature'] || null,
        is_valid_signature: true,
        payload: rawBody,
        processed: false,
      });
    } catch {
      // Service role yapılandırılmamışsa (yerel geliştirme) idempotency atlanır.
      eventsDb = null;
    }

    if (verification.paymentId && verification.status === 'paid') {
      const cardLastFour = String(rawBody.lastFourDigits || rawBody.cardLastFour || '').replace(/\D/g, '').slice(-4) || '0000';
      const result = await confirmEscrowPaymentPaid(String(verification.paymentId), String(verification.paymentId), cardLastFour);
      if (!result.success) {
        // İşlenmedi olarak bırak: sağlayıcı yeniden deneyebilir.
        return NextResponse.json({ error: 'Ödeme işlenemedi.' }, { status: 422 });
      }
    }

    // Yalnızca başarıyla işlendikten SONRA "processed" işaretlenir.
    if (eventsDb) {
      try {
        await eventsDb
          .from('payment_webhook_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('event_id', eventId);
      } catch {
        // kayıt güncellenemese de ödeme işlenmiştir
      }
    }

    return NextResponse.json({ success: true, received: true });
  } catch (err) {
    console.error('[webhooks/payment] error:', err);
    return NextResponse.json({ error: 'Webhook işleme hatası oluştu.' }, { status: 500 });
  }
}
