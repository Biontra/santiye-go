// ============================================================
// ŞantiyeGO – Dijital İrsaliye & QR Kodlu Şantiye Teslimatı Servisi
// ============================================================

import { DEMO_BOOKINGS } from './booking-service';
import { DEMO_TRANSACTIONS } from './payment-service';
import { buyerConfirmAndReleaseEscrow } from './escrow-service';
import { PaymentTransaction } from '@/types/database';

export interface DeliveryWaybill {
  id: string;
  booking_id: string;
  payment_id?: string;
  delivery_token: string;
  delivery_pin: string; // 6 haneli sayısal kod
  buyer_id: string;
  buyer_name: string;
  buyer_phone?: string;
  company_id: string;
  company_name: string;
  company_phone?: string;
  listing_title: string;
  material_summary: string;
  quantity: number;
  unit: string;
  total_price: number;
  currency: string;
  site_address: string;
  driver_name: string;
  plate_number: string;
  status: 'PENDING_DELIVERY' | 'DELIVERED' | 'DISPUTED';
  delivered_at?: string | null;
  delivery_note?: string | null;
  delivered_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

const STORAGE_WAYBILLS_KEY = 'santiyego_delivery_waybills_store';

// Başlangıç Demo İrsaliyeleri
export const INITIAL_DEMO_WAYBILLS: DeliveryWaybill[] = [
  {
    id: 'wb-0000-0000-0001',
    booking_id: 'book-0000-0000-0000-000000000001',
    payment_id: 'pay-0000-0000-0001',
    delivery_token: 'dlv-tok-381942-tuzla',
    delivery_pin: '381942',
    buyer_id: 'buyer-demo-001',
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
    buyer_phone: '+90 532 111 2233',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    company_name: '[DEMO] Anadolu İş Makineleri Parkı',
    company_phone: '+90 532 000 0101',
    listing_title: '2022 Model CAT 320 Ekskavatör',
    material_summary: '2022 Model CAT 320 Ekskavatör (Operatörlü Kiralama)',
    quantity: 1,
    unit: 'Adet',
    total_price: 36000,
    currency: 'TRY',
    site_address: 'Tuzla Tepeören Şantiyesi No: 4, İstanbul',
    driver_name: 'Mustafa Kaya (Operatör/Şoför)',
    plate_number: '34 SG 1907',
    status: 'DELIVERED',
    delivered_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    delivery_note: 'Makine sahada sağlam ve eksiksiz teslim alındı. Operatör çalışmaya başladı.',
    delivered_by_user_id: 'buyer-demo-001',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'wb-0000-0000-0002',
    booking_id: 'book-0000-0000-0000-000000000002',
    payment_id: 'pay-0000-0000-0002',
    delivery_token: 'dlv-tok-749215-kadikoy',
    delivery_pin: '749215',
    buyer_id: 'buyer-demo-001',
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
    buyer_phone: '+90 532 111 2233',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    company_name: '[DEMO] Anadolu İş Makineleri Parkı',
    company_phone: '+90 532 000 0101',
    listing_title: 'JCB 3CX Kazıcı Yükleyici (Beko Loder)',
    material_summary: 'JCB 3CX Kazıcı Yükleyici - Kırıcı Uçlu (Operatörlü)',
    quantity: 1,
    unit: 'Adet',
    total_price: 34000,
    currency: 'TRY',
    site_address: 'Kadıköy Fikirtepe Kentsel Dönüşüm Şantiyesi, İstanbul',
    driver_name: 'Mehmet Demir (Taşıyıcı Lowbed Şoförü)',
    plate_number: '34 GO 2026',
    status: 'PENDING_DELIVERY',
    delivered_at: null,
    delivery_note: null,
    delivered_by_user_id: null,
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

let inMemWaybills: DeliveryWaybill[] = [...INITIAL_DEMO_WAYBILLS];

function getStoredWaybills(): DeliveryWaybill[] {
  if (typeof window === 'undefined') return inMemWaybills;
  try {
    const raw = localStorage.getItem(STORAGE_WAYBILLS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return inMemWaybills;
}

function saveWaybill(wb: DeliveryWaybill) {
  const list = getStoredWaybills();
  const idx = list.findIndex((w) => w.id === wb.id || w.booking_id === wb.booking_id);
  if (idx !== -1) {
    list[idx] = wb;
  } else {
    list.unshift(wb);
  }
  inMemWaybills = list;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_WAYBILLS_KEY, JSON.stringify(list));
    } catch {}
  }
}

// ── Kriptografik rastgelelik (Math.random tahmin edilebilir; PIN/token escrow'u açar) ──
function secureRandomInt(maxExclusive: number): number {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (!c || typeof c.getRandomValues !== 'function') {
    // Güvenli RNG yoksa (çok eski ortam) sessizce zayıf üretme: hata fırlat.
    throw new Error('Güvenli rastgele sayı üreteci (crypto.getRandomValues) bulunamadı.');
  }
  // Rejection sampling: modulo bias olmadan
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  do {
    c.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % maxExclusive;
}

function secureRandomHex(bytes: number): string {
  const c: Crypto = (globalThis as any).crypto;
  const buf = new Uint8Array(bytes);
  c.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 6 haneli rastgele PIN üretir (crypto tabanlı).
 * `taken` verilirse çakışmayan bir PIN seçilir (aynı PIN iki farklı irsaliyede bulunmaz).
 */
export function generateDeliveryPin(taken?: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const pin = String(100000 + secureRandomInt(900000));
    if (!taken || !taken.has(pin)) return pin;
  }
  throw new Error('Benzersiz teslimat PIN kodu üretilemedi.');
}

/**
 * Benzersiz delivery_token üretir (64 bit crypto rastgelelik; tahmin edilemez).
 * Biçim: <prefix>-tok-<16 hex>-<zaman> (en fazla 32 karakter, modal inputuna sığar)
 */
export function generateDeliveryToken(prefix: string = 'dlv'): string {
  const rand = secureRandomHex(8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}-tok-${rand}-${time}`;
}

// ── Alıcı kimliği ────────────────────────────────────────────
// Demo veri seti alıcıyı 'buyer-demo-001' olarak tutar; demo giriş hesabı ise
// 'demo-buyer-user-001' kimliğini kullanır. Gerçek (Supabase/UUID) kimlikler birebir karşılaştırılır.
const BUYER_ID_ALIASES: Record<string, string> = {
  'demo-buyer-user-001': 'buyer-demo-001',
};

export function canonicalBuyerId(id?: string | null): string {
  const v = (id ?? '').trim();
  return BUYER_ID_ALIASES[v] ?? v;
}

function isWaybillBuyer(actorUserId: string | undefined | null, buyerId: string): boolean {
  const actor = canonicalBuyerId(actorUserId);
  return actor !== '' && actor === canonicalBuyerId(buyerId);
}

/**
 * Sipariş/Rezervasyon için Dijital İrsaliyeyi Getir veya Otomatik Oluştur
 */
export function getOrCreateWaybillForBooking(
  bookingId: string,
  bookingHint?: (typeof DEMO_BOOKINGS)[number]
): DeliveryWaybill {
  const waybills = getStoredWaybills();
  const existing = waybills.find((w) => w.booking_id === bookingId);
  if (existing) return existing;

  // Demo kayıt yoksa (gerçek Supabase rezervasyonu) çağıranın verdiği kaydı kullan:
  // alıcı kimliği asla 'demo' değerine düşmemeli, yoksa gerçek alıcı hiçbir zaman onaylayamaz.
  const booking = DEMO_BOOKINGS.find((b) => b.id === bookingId) ?? bookingHint;
  const tx = DEMO_TRANSACTIONS.find((t) => t.booking_id === bookingId);

  const takenPins = new Set(waybills.map((w) => w.delivery_pin));
  const pin = booking?.delivery_pin || tx?.delivery_pin || generateDeliveryPin(takenPins);
  const token = booking?.delivery_token || tx?.delivery_token || generateDeliveryToken();

  const newWaybill: DeliveryWaybill = {
    id: `wb-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    booking_id: bookingId,
    payment_id: tx?.id,
    delivery_token: token,
    delivery_pin: pin,
    buyer_id: booking?.buyer_id || tx?.buyer_id || '',
    buyer_name: booking?.buyer_name || tx?.buyer?.full_name || 'Alıcı / Şantiye Yetkilisi',
    buyer_phone: tx?.buyer?.phone || '+90 532 111 2233',
    company_id: booking?.company_id || tx?.company_id || 'f0000000-0000-0000-0000-000000000001',
    company_name: booking?.company_name || tx?.company?.name || 'Tedarikçi / Lojistik Firma',
    company_phone: tx?.company?.phone || '+90 532 000 0101',
    listing_title: booking?.listing?.title || 'Şantiye Ekipmanı / Yapı Malzemesi',
    material_summary: booking?.listing?.title || 'Sipariş Teslimatı',
    quantity: booking?.quantity || 1,
    unit: 'Birim',
    total_price: booking?.total_price || (tx ? tx.amount_cents / 100 : 0),
    currency: booking?.currency || 'TRY',
    site_address: booking?.site_address || 'Şantiye Teslimat Adresi',
    driver_name: 'Sevkiyat Sorumlusu / Nakliye Şoförü',
    plate_number: '34 SG 2026',
    status: tx?.status === 'transferred' ? 'DELIVERED' : 'PENDING_DELIVERY',
    delivered_at: tx?.transferred_at || null,
    delivery_note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveWaybill(newWaybill);

  // Booking ve Transaction nesnelerini de senkronize et
  if (booking) {
    booking.delivery_token = token;
    booking.delivery_pin = pin;
  }
  if (tx) {
    tx.delivery_token = token;
    tx.delivery_pin = pin;
  }

  return newWaybill;
}

/**
 * Token ile Dijital İrsaliye Bul (QR kod okutulduğunda yönlendirilen sayfa için)
 * `buyerId` verilirse yalnızca o alıcıya ait irsaliye döner (başkasının irsaliyesi sızmaz).
 */
export function getWaybillByToken(token: string, buyerId?: string | null): DeliveryWaybill | null {
  const clean = (token ?? '').trim().toLowerCase();
  if (!clean || clean.length > 64) return null;
  const list = getStoredWaybills();
  const found = list.find((w) => w.delivery_token.toLowerCase() === clean);
  if (!found) return null;
  if (buyerId !== undefined && !isWaybillBuyer(buyerId, found.buyer_id)) return null;
  return found;
}

/**
 * 6 Haneli PIN ile Dijital İrsaliye Bul (Şantiye şefi sahada manuel girdiğinde)
 * PIN 1M'lik küçük bir uzay olduğundan arama MUTLAKA alıcıya göre daraltılmalıdır:
 * `buyerId` verilirse yalnızca o alıcının irsaliyeleri taranır (bekleyenler öncelikli).
 */
export function getWaybillByPin(pin: string, buyerId?: string | null): DeliveryWaybill | null {
  const clean = (pin ?? '').trim().replace(/\D/g, '');
  if (clean.length !== 6) return null;
  const matches = getStoredWaybills().filter(
    (w) => w.delivery_pin === clean && (buyerId === undefined || isWaybillBuyer(buyerId, w.buyer_id))
  );
  return matches.find((w) => w.status === 'PENDING_DELIVERY') || matches[0] || null;
}

// Aynı irsaliye için eşzamanlı onay istekleri (çift tıklama / replay) tek geçsin
const inFlightWaybills = new Set<string>();

/**
 * ŞANTİYE TESLİMATINI ONAYLA VE ESCROW'U SERBEST BIRAK
 * YALNIZCA oturum açmış ALICI çağırabilir: QR/PIN'i şoför (satıcı tarafı) taşıdığı için
 * kod tek başına yetki sayılmaz; `actorUserId` doğrulanmış oturumdan gelmelidir.
 * 1. Alıcı kimliği irsaliye alıcısıyla eşleşmeli (aksi halde 'Yetkisiz').
 * 2. Aynı irsaliyede eşzamanlı/tekrarlı çağrılar engellenir (replay / çift serbest bırakma).
 * 3. `buyerConfirmAndReleaseEscrow` GERÇEK aktörle çağrılır (escrow katmanı da kontrol eder).
 * 4. Bağlı escrow kaydı yoksa onay verilmez (para akışı olmadan "teslim edildi" işaretlenmez).
 */
export async function confirmDeliveryAndReleaseEscrow(params: {
  tokenOrPin: string;
  actorUserId: string;
  deliveryNote?: string;
  quantityConfirmed?: boolean;
}): Promise<{
  success: boolean;
  waybill?: DeliveryWaybill;
  transaction?: PaymentTransaction;
  error?: string;
}> {
  const actorId = canonicalBuyerId(params.actorUserId);
  if (!actorId) {
    return {
      success: false,
      error: 'Teslimatı onaylamak için alıcı hesabınızla giriş yapmanız gerekir.',
    };
  }

  if (params.quantityConfirmed === false) {
    return {
      success: false,
      error: 'Teslimatı onaylamak için malzemenin eksiksiz teslim alındığını doğrulamalısınız.',
    };
  }

  const input = (params.tokenOrPin ?? '').trim();
  const invalid = {
    success: false,
    error: 'Geçersiz QR Kod veya 6 haneli Teslimat Kodu. Lütfen şoförün ekranındaki kodu kontrol ediniz.',
  };
  if (!input || input.length > 64) return invalid;

  // Arama alıcıya göre daraltılır: başka alıcıya ait kod "bulunamadı" gibi davranır (oracle yok).
  const waybill = getWaybillByPin(input, actorId) || getWaybillByToken(input, actorId);
  if (!waybill) return invalid;

  if (!isWaybillBuyer(actorId, waybill.buyer_id)) {
    return {
      success: false,
      error: 'Yetkisiz İşlem: Teslimatı yalnızca siparişin alıcısı onaylayabilir.',
    };
  }

  if (waybill.status === 'DELIVERED') {
    return {
      success: false,
      error: 'Bu teslimat zaten daha önce onaylanmış ve emanet ödeme serbest bırakılmıştır.',
      waybill,
    };
  }
  if (waybill.status === 'DISPUTED') {
    return {
      success: false,
      error: 'Bu teslimat için itiraz açılmış; onay yönetici hakem kararından sonra verilebilir.',
      waybill,
    };
  }

  if (inFlightWaybills.has(waybill.id)) {
    return {
      success: false,
      error: 'Bu teslimat için onay işlemi zaten sürüyor. Lütfen birkaç saniye bekleyiniz.',
    };
  }
  inFlightWaybills.add(waybill.id);

  try {
    // Kilidi aldıktan sonra güncel durumu tekrar oku (beklerken başka istek bitirmiş olabilir)
    const fresh = getStoredWaybills().find((w) => w.id === waybill.id) ?? waybill;
    if (fresh.status !== 'PENDING_DELIVERY') {
      return {
        success: false,
        error: 'Bu teslimat zaten daha önce onaylanmış ve emanet ödeme serbest bırakılmıştır.',
        waybill: fresh,
      };
    }

    const tx = DEMO_TRANSACTIONS.find(
      (t) => t.booking_id === fresh.booking_id || t.id === fresh.payment_id
    );
    if (!tx) {
      return {
        success: false,
        error: 'Bu irsaliyeye bağlı emanet ödeme kaydı bulunamadı; teslimat onaylanamadı.',
      };
    }

    // Escrow: GERÇEK aktör ile (escrow-service alıcı/firma ayrımını ayrıca doğrular)
    const releaseRes = await buyerConfirmAndReleaseEscrow(tx.id, actorId);
    if (!releaseRes.success) {
      // Ödeme başka bir yoldan (ör. alıcı paneli) zaten serbest bırakılmışsa irsaliyeyi tamamla.
      // Başka hiçbir hata (yetki, iade, itiraz, sağlayıcı) onayı geçirmez.
      if (tx.status !== 'transferred') {
        return { success: false, error: `Escrow serbest bırakılamadı: ${releaseRes.error}` };
      }
    }

    const now = new Date().toISOString();
    const note = (params.deliveryNote ?? '').trim().slice(0, 500);
    fresh.status = 'DELIVERED';
    fresh.delivered_at = now;
    fresh.delivery_note =
      note || 'Sipariş şantiyede eksiksiz ve sağlam teslim alındı. Dijital onay verildi.';
    fresh.delivered_by_user_id = actorId;
    fresh.updated_at = now;
    saveWaybill(fresh);

    const booking = DEMO_BOOKINGS.find((b) => b.id === fresh.booking_id);
    if (booking) {
      booking.status = 'completed';
      booking.delivered_at = now;
      booking.delivery_note = fresh.delivery_note;
    }

    return { success: true, waybill: fresh, transaction: tx };
  } finally {
    inFlightWaybills.delete(waybill.id);
  }
}
