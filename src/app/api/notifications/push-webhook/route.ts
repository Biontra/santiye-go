import { NextRequest, NextResponse } from 'next/server';
import { sendPushForNotification } from '@/lib/push/server';
import { UUID_RE } from '@/lib/push/shared';
import { safeEqual } from '@/lib/security/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Supabase Database Webhook (notifications tablosu, INSERT) → web push.
 *
 * Kurulum: Supabase Dashboard > Database > Webhooks > Create:
 *   Table: notifications, Events: Insert, Type: HTTP Request, Method: POST,
 *   URL: https://<alan-adınız>/api/notifications/push-webhook,
 *   HTTP Headers: Authorization = Bearer <PUSH_WEBHOOK_SECRET>
 *
 * Güvenlik: sır tanımlı değilse (veya kısaysa) FAIL-CLOSED 503 döner. Gövdeye güvenilmez;
 * yalnızca kayıt kimliği alınır ve bildirim DB'den service_role ile yeniden okunur.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'Push webhook yapılandırılmamış.' }, { status: 503 });
  }

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 });
  }

  let body: { type?: unknown; table?: unknown; record?: { id?: unknown } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
  }

  if (body.type !== 'INSERT' || body.table !== 'notifications') {
    return NextResponse.json({ status: 'ignored' });
  }
  const id = body.record?.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Geçersiz kayıt kimliği.' }, { status: 400 });
  }

  try {
    const outcome = await sendPushForNotification(id);
    return NextResponse.json(outcome);
  } catch (err) {
    console.error('[push-webhook] Gönderim hatası:', (err as Error).message);
    return NextResponse.json({ error: 'Push gönderilemedi.' }, { status: 500 });
  }
}
