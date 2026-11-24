/**
 * ŞANTİYE GO – Web Push ortak (istemci + sunucu) yardımcıları.
 * Saf fonksiyonlar: ağ/DB erişimi yok, kolayca test edilir.
 */

export type PushCategory = 'messages' | 'quotes' | 'bookings';

export interface PushPrefs {
  messages: boolean;
  quotes: boolean;
  bookings: boolean;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = { messages: true, quotes: true, bookings: true };

const MESSAGE_TYPES = new Set(['new_message']);
const QUOTE_TYPES = new Set([
  'new_quote_request',
  'new_quote',
  'quote_accepted',
  'quote_rejected',
  'circular_inquiry',
]);

/** Bildirim tipini kullanıcının tercih kategorisine eşler. Bilinmeyen tipler "işlem" sayılır. */
export function categoryForType(type: string): PushCategory {
  if (MESSAGE_TYPES.has(type)) return 'messages';
  if (QUOTE_TYPES.has(type)) return 'quotes';
  return 'bookings';
}

/**
 * Sunucu bu adrese istek attığı için endpoint YALNIZCA bilinen push servislerine izinlidir.
 * (Aksi halde kullanıcı iç ağ adreslerini abone olarak kaydedip SSRF yapabilir.)
 */
const ALLOWED_HOSTS_EXACT = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const ALLOWED_HOST_SUFFIXES = [
  '.push.services.mozilla.com', // Firefox
  '.push.apple.com', // Safari / iOS (web.push.apple.com)
  '.notify.windows.com', // Edge / Windows (WNS)
];

export function isAllowedPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return (
    ALLOWED_HOSTS_EXACT.includes(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export interface ParsedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `PushSubscription.toJSON()` çıktısını doğrular; geçersizse null döner. */
export function parseSubscription(input: unknown): ParsedSubscription | null {
  if (!input || typeof input !== 'object') return null;
  const sub = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(sub.endpoint)) return null;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  // p256dh: sıkıştırılmamış P-256 noktası (65 bayt ≈ 87 karakter), auth: 16 bayt ≈ 22 karakter
  if (typeof p256dh !== 'string' || !B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (typeof auth !== 'string' || !B64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint: sub.endpoint, p256dh, auth };
}

/** Yalnızca boolean alanları alır; bilinmeyen/yanlış tipli alanlar yok sayılır. */
export function parsePrefs(input: unknown): Partial<PushPrefs> {
  const out: Partial<PushPrefs> = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const key of ['messages', 'quotes', 'bookings'] as const) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  return out;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Yalnızca site içi yol. */
  url: string;
  tag: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Dış/şüpheli yönlendirmeyi engeller: yalnızca "/yol" biçimi kabul edilir. */
export function safeInternalPath(link: unknown, fallback = '/bildirimler'): string {
  if (typeof link !== 'string') return fallback;
  if (!/^\/([^/\\]|$)/.test(link) || /[\u0000-\u001f\u007f]/.test(link)) return fallback;
  return link.slice(0, 300);
}

export function buildPushPayload(n: {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  link_url: string | null;
}): PushPayload {
  const url = safeInternalPath(n.link_url);
  // Geçerli bir site içi link yoksa bildirimler birbirinin yerini almasın (kimlik tabanlı tag).
  const hasValidLink = safeInternalPath(n.link_url, '') !== '';
  return {
    title: clip((n.title || 'ŞANTİYE GO').trim(), 80),
    body: clip((n.content || '').trim(), 160),
    url,
    // Aynı konuşma/talep için gelen bildirimler birbirinin yerini alsın (bildirim yığılmasın).
    tag: hasValidLink ? `${n.type}:${url}` : `n:${n.id}`,
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
