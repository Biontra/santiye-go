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

/**
 * 6 haneli rastgele PIN üretir
 */
export function generateDeliveryPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Benzersiz delivery_token üretir
 */
export function generateDeliveryToken(prefix: string = 'dlv'): string {
  const rand = Math.random().toString(36).substring(2, 9);
  const time = Date.now().toString(36).substring(4);
  return `${prefix}-tok-${rand}-${time}`;
}

/**
 * Sipariş/Rezervasyon için Dijital İrsaliyeyi Getir veya Otomatik Oluştur
 */
export function getOrCreateWaybillForBooking(bookingId: string): DeliveryWaybill {
  const waybills = getStoredWaybills();
  const existing = waybills.find((w) => w.booking_id === bookingId);
  if (existing) return existing;

  const booking = DEMO_BOOKINGS.find((b) => b.id === bookingId);
  const tx = DEMO_TRANSACTIONS.find((t) => t.booking_id === bookingId);

  const pin = booking?.delivery_pin || tx?.delivery_pin || generateDeliveryPin();
  const token = booking?.delivery_token || tx?.delivery_token || generateDeliveryToken();

  const newWaybill: DeliveryWaybill = {
    id: `wb-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    booking_id: bookingId,
    payment_id: tx?.id,
    delivery_token: token,
    delivery_pin: pin,
    buyer_id: booking?.buyer_id || tx?.buyer_id || 'buyer-demo-001',
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
 */
export function getWaybillByToken(token: string): DeliveryWaybill | null {
  const clean = token.trim();
  const list = getStoredWaybills();
  return list.find((w) => w.delivery_token.toLowerCase() === clean.toLowerCase()) || null;
}

/**
 * 6 Haneli PIN ile Dijital İrsaliye Bul (Şantiye şefi sahada manuel girdiğinde)
 */
export function getWaybillByPin(pin: string): DeliveryWaybill | null {
  const clean = pin.trim().replace(/\D/g, '');
  if (clean.length !== 6) return null;
  const list = getStoredWaybills();
  return list.find((w) => w.delivery_pin === clean) || null;
}

/**
 * ŞANTİYE TESLİMATINI ONAYLA VE ESCROW'U SERBEST BIRAK
 * Alıcı/Şantiye Şefi QR veya PIN ile doğrular:
 * 1. İrsaliye durumunu DELIVERED yapar.
 * 2. `buyerConfirmAndReleaseEscrow` çağırarak emanet parayı satıcıya aktarır.
 * 3. Booking durumunu 'completed' yapar.
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
  const input = params.tokenOrPin.trim();
  let waybill = getWaybillByPin(input) || getWaybillByToken(input);

  if (!waybill) {
    return {
      success: false,
      error: 'Geçersiz QR Kod veya 6 haneli Teslimat Kodu. Lütfen şoförün ekranındaki kodu kontrol ediniz.',
    };
  }

  if (waybill.status === 'DELIVERED') {
    return {
      success: false,
      error: 'Bu teslimat zaten daha önce onaylanmış ve emanet ödeme serbest bırakılmıştır.',
      waybill,
    };
  }

  // Escrow Serbest Bırakma
  let tx = DEMO_TRANSACTIONS.find(
    (t) => t.booking_id === waybill?.booking_id || t.id === waybill?.payment_id
  );

  if (tx) {
    const actorId = params.actorUserId || waybill.buyer_id;
    const releaseRes = await buyerConfirmAndReleaseEscrow(tx.id, tx.buyer_id || actorId);
    if (!releaseRes.success && releaseRes.error && !releaseRes.error.includes('zaten serbest bırakılmış')) {
      return {
        success: false,
        error: `Escrow serbest bırakılamadı: ${releaseRes.error}`,
      };
    }
  }

  // İrsaliye kaydını güncelle
  const now = new Date().toISOString();
  waybill.status = 'DELIVERED';
  waybill.delivered_at = now;
  waybill.delivery_note =
    params.deliveryNote?.trim() ||
    'Sipariş şantiyede eksiksiz ve sağlam teslim alındı. Dijital onay verildi.';
  waybill.delivered_by_user_id = params.actorUserId;
  waybill.updated_at = now;

  saveWaybill(waybill);

  // İlgili booking'i tamamlandı yap
  const booking = DEMO_BOOKINGS.find((b) => b.id === waybill?.booking_id);
  if (booking) {
    booking.status = 'completed';
    booking.delivered_at = now;
    booking.delivery_note = waybill.delivery_note;
  }

  return {
    success: true,
    waybill,
    transaction: tx,
  };
}
