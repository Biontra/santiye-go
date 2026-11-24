/**
 * ŞANTİYE GO – Web Push gönderimi (YALNIZCA SUNUCU).
 * İstemci bileşenlerinden import edilmemelidir (web-push + service_role kullanır).
 */
import webpush from 'web-push';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildPushPayload,
  categoryForType,
  isAllowedPushEndpoint,
  type PushCategory,
  type PushPayload,
} from '@/lib/push/shared';

let vapidReady: boolean | null = null;

/** VAPID anahtarları tanımlı ve geçerli mi? (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) */
export function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
  } catch (err) {
    console.error('[push] VAPID yapılandırması geçersiz:', (err as Error).message);
    vapidReady = false;
  }
  return vapidReady;
}

/** Yalnızca testler için. */
export function __resetVapidForTests() {
  vapidReady = null;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  keys: { p256dh?: string; auth?: string } | null;
  notify_messages?: boolean | null;
  notify_quotes?: boolean | null;
  notify_bookings?: boolean | null;
}

export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  body: string,
  options: { TTL: number; urgency: 'normal' | 'high'; timeout: number }
) => Promise<{ statusCode: number }>;

const defaultTransport: PushTransport = (subscription, body, options) =>
  webpush.sendNotification(subscription, body, options);

export interface DeliveryResult {
  sent: number;
  failed: number;
  /** Tarayıcının artık geçersiz saydığı (404/410) abonelik kimlikleri: silinmeli. */
  gone: string[];
}

/** Kategori tercihi kapalı olan veya izinli olmayan endpoint'li abonelikleri eler. */
export function selectDeliverable(subs: StoredSubscription[], category: PushCategory | 'any'): StoredSubscription[] {
  const flag =
    category === 'any'
      ? null // test bildirimi: kategori tercihlerinden bağımsız
      : ({ messages: 'notify_messages', quotes: 'notify_quotes', bookings: 'notify_bookings' } as const)[category];
  return subs.filter(
    (s) =>
      (flag === null || s[flag] !== false) && // null/undefined = varsayılan açık
      isAllowedPushEndpoint(s.endpoint) && // gönderim anında da doğrula (DB'ye başka yoldan yazılmış olabilir)
      typeof s.keys?.p256dh === 'string' &&
      typeof s.keys?.auth === 'string'
  );
}

export async function deliverToSubscriptions(
  subs: StoredSubscription[],
  payload: PushPayload,
  transport: PushTransport = defaultTransport
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) =>
      transport(
        { endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh!, auth: s.keys!.auth! } },
        body,
        { TTL: 60 * 60 * 24, urgency: 'normal', timeout: 8000 }
      )
    )
  );

  const out: DeliveryResult = { sent: 0, failed: 0, gone: [] };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      out.sent += 1;
      return;
    }
    const status = (r.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) out.gone.push(subs[i].id);
    else out.failed += 1;
  });
  return out;
}

const SUB_COLUMNS = 'id, endpoint, keys, notify_messages, notify_quotes, notify_bookings';
const MAX_DEVICES_PER_USER = 10;

async function loadSubscriptions(db: ReturnType<typeof createServiceRoleClient>, userId: string) {
  const { data, error } = await db
    .from('push_subscriptions')
    .select(SUB_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_DEVICES_PER_USER);
  if (error) throw new Error(`push_subscriptions okunamadı: ${error.message}`);
  return (data || []) as StoredSubscription[];
}

async function pruneGone(db: ReturnType<typeof createServiceRoleClient>, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await db.from('push_subscriptions').delete().in('id', ids);
  if (error) console.warn('[push] Geçersiz abonelikler silinemedi:', error.message);
}

export type PushOutcome =
  | { status: 'disabled' }
  | { status: 'skipped' } // zaten gönderilmiş / bulunamadı
  | { status: 'no_subscribers' }
  | { status: 'sent'; sent: number; failed: number; removed: number };

/**
 * Bir bildirim satırı için push gönderir. `push_sent_at` atomik olarak "talep edilir";
 * böylece aynı bildirim webhook tekrarında bile en fazla bir kez gönderilir.
 */
export async function sendPushForNotification(
  notificationId: string,
  deps: { transport?: PushTransport; db?: ReturnType<typeof createServiceRoleClient> } = {}
): Promise<PushOutcome> {
  if (!deps.transport && !ensureVapid()) return { status: 'disabled' };
  const db = deps.db ?? createServiceRoleClient();

  const { data: claimed, error } = await db
    .from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('push_sent_at', null)
    .select('id, user_id, type, title, content, link_url')
    .maybeSingle();
  if (error) throw new Error(`Bildirim talep edilemedi: ${error.message}`);
  if (!claimed) return { status: 'skipped' };

  const subs = selectDeliverable(await loadSubscriptions(db, claimed.user_id), categoryForType(claimed.type));
  if (subs.length === 0) return { status: 'no_subscribers' };

  const result = await deliverToSubscriptions(subs, buildPushPayload(claimed), deps.transport);
  await pruneGone(db, result.gone);
  return { status: 'sent', sent: result.sent, failed: result.failed, removed: result.gone.length };
}

/** Bildirim satırı oluşturmadan, doğrudan kullanıcının cihazlarına gönderir (test bildirimi için). */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category: PushCategory | 'any',
  deps: { transport?: PushTransport; db?: ReturnType<typeof createServiceRoleClient> } = {}
): Promise<PushOutcome> {
  if (!deps.transport && !ensureVapid()) return { status: 'disabled' };
  const db = deps.db ?? createServiceRoleClient();
  const subs = selectDeliverable(await loadSubscriptions(db, userId), category);
  if (subs.length === 0) return { status: 'no_subscribers' };
  const result = await deliverToSubscriptions(subs, payload, deps.transport);
  await pruneGone(db, result.gone);
  return { status: 'sent', sent: result.sent, failed: result.failed, removed: result.gone.length };
}
