'use client';

/**
 * ŞANTİYE GO – Web Push tarayıcı yardımcıları.
 * Abonelik: izin iste → pushManager.subscribe → /api/push/subscribe (sunucu doğrular ve kaydeder).
 */
import { DEFAULT_PUSH_PREFS, type PushPrefs } from '@/lib/push/shared';

export type PushState =
  | 'checking'
  | 'unsupported' // tarayıcı push desteklemiyor
  | 'ios-install' // iPhone/iPad: önce "Ana Ekrana Ekle" gerekir
  | 'unconfigured' // sunucuda VAPID anahtarı yok
  | 'denied' // kullanıcı tarayıcıda engellemiş
  | 'off'
  | 'on';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(existing: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== wanted.length) return false;
  return a.every((byte, i) => byte === wanted[i]);
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function hasPushApis(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApis()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function detectPushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'checking';
  if (!hasPushApis()) return isIos() ? 'ios-install' : 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const sub = await currentSubscription();
  return sub ? 'on' : 'off';
}

async function api(method: string, body?: unknown, query = ''): Promise<Response> {
  return fetch(`/api/push/subscribe${query}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'unconfigured' | 'unsupported' | 'login' | 'error'; message?: string };

/** İzin ister, aboneliği oluşturur ve sunucuya kaydeder. */
export async function enablePush(prefs: PushPrefs = DEFAULT_PUSH_PREFS): Promise<EnableResult> {
  if (!hasPushApis()) return { ok: false, reason: 'unsupported' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'unconfigured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration =
      (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;

    const key = urlBase64ToBytes(VAPID_PUBLIC_KEY);
    let sub = await registration.pushManager.getSubscription();
    // VAPID anahtarı değiştiyse eski abonelik işe yaramaz: yenile.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }

    const res = await api('POST', { subscription: sub.toJSON(), prefs });
    if (res.status === 401) {
      await sub.unsubscribe();
      return { ok: false, reason: 'login' };
    }
    if (!res.ok) {
      await sub.unsubscribe();
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: 'error', message: data?.error };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error)?.message };
  }
}

/** Bu cihazın aboneliğini hem sunucudan hem tarayıcıdan kaldırır (çıkış yaparken de çağrılır). */
export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api('DELETE', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // sessiz: çıkış akışını asla bozmaz
  }
}

export type DeviceStatus =
  | { status: 'ok'; subscribed: boolean; prefs: PushPrefs }
  | { status: 'login' }
  | { status: 'error' };

/** Bu cihaz bu hesap için kayıtlı mı ve tercihleri neler? */
export async function loadDeviceStatus(): Promise<DeviceStatus> {
  try {
    const sub = await currentSubscription();
    if (!sub) return { status: 'ok', subscribed: false, prefs: DEFAULT_PUSH_PREFS };
    const res = await api('GET', undefined, `?endpoint=${encodeURIComponent(sub.endpoint)}`);
    if (res.status === 401) return { status: 'login' };
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    return { status: 'ok', subscribed: data.subscribed === true, prefs: data.prefs ?? DEFAULT_PUSH_PREFS };
  } catch {
    return { status: 'error' };
  }
}

export async function saveDevicePrefs(prefs: Partial<PushPrefs>): Promise<boolean> {
  try {
    const sub = await currentSubscription();
    if (!sub) return false;
    const res = await api('PATCH', { endpoint: sub.endpoint, prefs });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data?.error || 'Test bildirimi gönderilemedi.' };
    if (data.status === 'disabled') return { ok: false, message: 'Sunucuda push anahtarları (VAPID) tanımlı değil.' };
    if (data.status === 'no_subscribers') return { ok: false, message: 'Bu hesapta etkin cihaz bulunamadı.' };
    if (data.status === 'sent' && data.sent > 0) return { ok: true, message: 'Test bildirimi gönderildi.' };
    return { ok: false, message: 'Bildirim iletilemedi. Birkaç saniye sonra tekrar deneyin.' };
  } catch {
    return { ok: false, message: 'Ağ hatası. Lütfen tekrar deneyin.' };
  }
}
