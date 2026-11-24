import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendPushToUser } from '@/lib/push/server';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Oturum açmış kullanıcının kendi cihazlarına test bildirimi gönderir. */
export async function POST() {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return json({ error: 'Giriş yapmanız gerekiyor.' }, 401);

  if (!checkRateLimit(`push-test:${userId}`, 3, 60 * 1000).allowed) {
    return json({ error: 'Çok sık deneme yaptınız. Bir dakika sonra tekrar deneyin.' }, 429);
  }

  try {
    const outcome = await sendPushToUser(
      userId,
      {
        title: 'ŞantiyeGO bildirimleri açık',
        body: 'Yeni mesaj, teklif ve rezervasyonlardan anında haberdar olacaksınız.',
        url: '/bildirimler',
        tag: 'push-test',
      },
      'any' // test: kategori tercihlerinden bağımsız
    );
    return json(outcome);
  } catch (err) {
    console.error('[push/test] hata:', (err as Error)?.message);
    return json({ error: 'Test bildirimi gönderilemedi.' }, 500);
  }
}
