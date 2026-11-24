import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import {
  DEFAULT_PUSH_PREFS,
  isAllowedPushEndpoint,
  parsePrefs,
  parseSubscription,
} from '@/lib/push/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DEVICES_PER_USER = 10;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Oturum açmış kullanıcıyı döner. Kimlik, her zaman sunucu tarafında oturum çerezinden çözülür. */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Çerez tabanlı kimlik doğrulamada basit çapraz-site form POST'larını engeller. */
function isJsonRequest(req: NextRequest): boolean {
  return (req.headers.get('content-type') || '').toLowerCase().startsWith('application/json');
}

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function prefsToColumns(prefs: ReturnType<typeof parsePrefs>) {
  const cols: Record<string, boolean> = {};
  if (prefs.messages !== undefined) cols.notify_messages = prefs.messages;
  if (prefs.quotes !== undefined) cols.notify_quotes = prefs.quotes;
  if (prefs.bookings !== undefined) cols.notify_bookings = prefs.bookings;
  return cols;
}

/** Bu cihazın abonelik durumu ve tercihleri. */
export async function GET(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Giriş yapmanız gerekiyor.' }, 401);

  const endpoint = req.nextUrl.searchParams.get('endpoint');
  if (!isAllowedPushEndpoint(endpoint)) return json({ subscribed: false, prefs: DEFAULT_PUSH_PREFS });

  try {
    const db = createServiceRoleClient();
    const { data } = await db
      .from('push_subscriptions')
      .select('notify_messages, notify_quotes, notify_bookings')
      .eq('endpoint', endpoint)
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return json({ subscribed: false, prefs: DEFAULT_PUSH_PREFS });
    return json({
      subscribed: true,
      prefs: {
        messages: data.notify_messages !== false,
        quotes: data.notify_quotes !== false,
        bookings: data.notify_bookings !== false,
      },
    });
  } catch {
    return json({ error: 'Servis şu anda kullanılamıyor.' }, 503);
  }
}

/** Cihazı kaydeder. Aynı endpoint başka kullanıcıdaysa bu kullanıcıya devredilir (aynı tarayıcı). */
export async function POST(req: NextRequest) {
  if (!isJsonRequest(req)) return json({ error: 'Geçersiz içerik türü.' }, 415);
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Giriş yapmanız gerekiyor.' }, 401);

  if (!checkRateLimit(`push-sub:${userId}`, 20, 10 * 60 * 1000).allowed) {
    return json({ error: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' }, 429);
  }

  const body = await readJson(req);
  const sub = parseSubscription(body?.subscription);
  if (!sub) return json({ error: 'Geçersiz bildirim aboneliği.' }, 400);

  try {
    const db = createServiceRoleClient();
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 200);
    const { error } = await db.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
        user_agent: userAgent,
        updated_at: new Date().toISOString(),
        ...prefsToColumns(parsePrefs(body?.prefs)),
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;

    // Kullanıcı başına cihaz sınırı: en eski abonelikler silinir.
    const { data: all } = await db
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    const extra = (all || []).slice(MAX_DEVICES_PER_USER).map((r) => r.id);
    if (extra.length > 0) await db.from('push_subscriptions').delete().in('id', extra);

    return json({ success: true });
  } catch (err) {
    console.error('[push/subscribe] kayıt hatası:', (err as Error)?.message);
    return json({ error: 'Abonelik kaydedilemedi.' }, 500);
  }
}

/** Bu cihazın bildirim tercihlerini günceller. */
export async function PATCH(req: NextRequest) {
  if (!isJsonRequest(req)) return json({ error: 'Geçersiz içerik türü.' }, 415);
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Giriş yapmanız gerekiyor.' }, 401);

  const body = await readJson(req);
  const endpoint = body?.endpoint;
  const columns = prefsToColumns(parsePrefs(body?.prefs));
  if (!isAllowedPushEndpoint(endpoint) || Object.keys(columns).length === 0) {
    return json({ error: 'Geçersiz istek.' }, 400);
  }

  try {
    const db = createServiceRoleClient();
    const { data, error } = await db
      .from('push_subscriptions')
      .update({ ...columns, updated_at: new Date().toISOString() })
      .eq('endpoint', endpoint)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return json({ error: 'Abonelik bulunamadı.' }, 404);
    return json({ success: true });
  } catch (err) {
    console.error('[push/subscribe] tercih hatası:', (err as Error)?.message);
    return json({ error: 'Tercihler kaydedilemedi.' }, 500);
  }
}

/** Bu cihazın aboneliğini siler (yalnızca sahibi). */
export async function DELETE(req: NextRequest) {
  if (!isJsonRequest(req)) return json({ error: 'Geçersiz içerik türü.' }, 415);
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Giriş yapmanız gerekiyor.' }, 401);

  const body = await readJson(req);
  const endpoint = body?.endpoint;
  if (!isAllowedPushEndpoint(endpoint)) return json({ error: 'Geçersiz istek.' }, 400);

  try {
    const db = createServiceRoleClient();
    const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId);
    if (error) throw error;
    return json({ success: true });
  } catch (err) {
    console.error('[push/subscribe] silme hatası:', (err as Error)?.message);
    return json({ error: 'Abonelik silinemedi.' }, 500);
  }
}
