import { createClient } from '@/lib/supabase/client';

// 30_circular_logistics.sql ile birebir uyumlu sabitler. Asıl zorlayıcı DB'dir (CHECK + RLS + tetikleyici);
// buradaki doğrulama yalnızca kullanıcıya erken ve anlaşılır geri bildirim vermek içindir.
export type ListingType = 'SURPLUS_MATERIAL' | 'BACKHAUL_TRUCK';
export const SURPLUS_CATEGORIES = ['Kaba Yapı & Demir', 'İskele & Kalıp', 'Konteyner & Ekipman'] as const;
export const TRUCK_CATEGORIES = ['Lowbed & Ağır Nakliye', 'Damperli & Kamyon'] as const;
export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  SURPLUS_MATERIAL: 'Artan Şantiye Malzemeleri',
  BACKHAUL_TRUCK: 'Boş Dönüş Kamyon & Lowbed',
};
export const LIMITS = {
  title: 200, description: 1500, quantity: 120, discount: 120, city: 80, district: 80, message: 1000, maxDays: 180,
} as const;

export function categoriesFor(type: ListingType): readonly string[] {
  return type === 'SURPLUS_MATERIAL' ? SURPLUS_CATEGORIES : TRUCK_CATEGORIES;
}

export interface MarketListing {
  id: string; listing_type: ListingType; title: string; category: string; quantity_info: string; price: number;
  discount_note: string; origin_city: string; origin_district: string; dest_city: string | null; dest_district: string | null;
  available_until: string; description: string; created_at: string; is_mine: boolean;
}
export interface MyListing extends MarketListing { status: 'ACTIVE' | 'SOLD'; contact_phone: string }
export interface Inquiry {
  id: string; listing_id: string; message: string; offered_price: number | null; requester_phone: string; created_at: string;
}
export interface NewListing {
  listing_type: ListingType; title: string; category: string; quantity_info: string; price: number; discount_note: string;
  origin_city: string; origin_district: string; dest_city: string; dest_district: string; available_until: string;
  contact_phone: string; description: string;
}
export interface NewInquiry { message: string; requester_phone: string; offered_price: number | null }

// ---------------------------------------------------------------- Yardımcılar
export const isDemo = (id: string) => id.startsWith('demo-');
export function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); }
export function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
}
export const formatPrice = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' ₺';
export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
/** "Piyasa fiyatının %35 altı" → 35. Metinde yüzde yoksa null. */
export function discountPercent(note: string): number | null {
  const m = /%\s*(\d{1,2})\b/.exec(note);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 99 ? n : null;
}
export const phoneHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '');

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|wa\.me\/)/i;
const PHONE_RE = /^[0-9+()\s-]+$/;
const phoneOk = (p: string) => { const t = p.trim(); const digits = t.replace(/\D/g, ''); return t.length >= 7 && t.length <= 25 && PHONE_RE.test(t) && digits.length >= 7 && digits.length <= 15; };

export function validateListing(v: NewListing): string | null {
  const title = v.title.trim(), qty = v.quantity_info.trim();
  if (title.length < 3 || v.title.length > LIMITS.title) return `Başlık 3 ile ${LIMITS.title} karakter arasında olmalı.`;
  if (!categoriesFor(v.listing_type).includes(v.category)) return 'Seçilen kategori ilan türüyle uyumlu değil.';
  if (!qty || v.quantity_info.length > LIMITS.quantity) return `Miktar / kapasite bilgisi zorunlu (en fazla ${LIMITS.quantity} karakter).`;
  if (!Number.isFinite(v.price) || v.price <= 0 || v.price > 1_000_000_000) return 'Fiyat 0’dan büyük geçerli bir tutar olmalı.';
  if (v.discount_note.length > LIMITS.discount) return `İndirim notu en fazla ${LIMITS.discount} karakter olabilir.`;
  if (v.origin_city.trim().length < 2) return 'Kalkış / bulunduğu şehri seçin.';
  if (v.listing_type === 'BACKHAUL_TRUCK' && v.dest_city.trim().length < 2) return 'Boş dönüş ilanları için varış şehri zorunlu.';
  if (v.origin_district.length > LIMITS.district || v.dest_district.length > LIMITS.district) return `İlçe adı en fazla ${LIMITS.district} karakter olabilir.`;
  if (!v.available_until || v.available_until < today() || v.available_until > addDays(LIMITS.maxDays)) return `Geçerlilik tarihi bugünden itibaren en fazla ${LIMITS.maxDays} gün olabilir.`;
  if (!phoneOk(v.contact_phone)) return 'Geçerli bir iletişim telefonu girin.';
  if (v.description.length > LIMITS.description) return `Açıklama en fazla ${LIMITS.description} karakter olabilir.`;
  if (LINK_RE.test([v.title, v.quantity_info, v.discount_note, v.description].join(' '))) return 'İlan metninde bağlantı (link) kullanılamaz.';
  return null;
}
export function validateInquiry(v: NewInquiry): string | null {
  if (v.message.trim().length < 5 || v.message.length > LIMITS.message) return `Mesaj 5 ile ${LIMITS.message} karakter arasında olmalı.`;
  if (!phoneOk(v.requester_phone)) return 'Geçerli bir telefon numarası girin.';
  if (v.offered_price !== null && (!Number.isFinite(v.offered_price) || v.offered_price <= 0 || v.offered_price > 1_000_000_000)) return 'Teklif tutarı 0’dan büyük olmalı.';
  if (LINK_RE.test(v.message)) return 'Mesajda bağlantı (link) kullanılamaz.';
  return null;
}

/** DB tetikleyicilerinin kendi (Türkçe) sınır mesajlarını gösterir; ham kısıt/RLS ayrıntılarını sızdırmaz. */
function friendly(error: { code?: string; message: string }, fallback: string) {
  if (error.code === '23514' && !/violates check constraint/i.test(error.message)) return error.message;
  if (error.code === '23514') return 'Alanlardan biri izin verilen sınırların dışında. Lütfen formu kontrol edin.';
  if (error.code === '23505') return 'Bu ilana zaten talep gönderdiniz.';
  if (error.code === '42501' || /row-level security/i.test(error.message)) return 'Bu işlem yapılamadı: ilan yayından kalkmış ya da kendi ilanınız olabilir.';
  return fallback;
}
async function requireUser() {
  const db = createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error('Bu işlem için giriş yapmalısınız.');
  return { db, userId: data.user.id };
}
export async function currentUserId(): Promise<string | null> {
  try { return (await createClient().auth.getUser()).data.user?.id ?? null; } catch { return null; }
}

// ---------------------------------------------------------------- Örnek (fallback) ilanlar
/** Veritabanı boşken vitrinin dolu görünmesi için. Tarihler her çağrıda bugüne göre hesaplanır (süresi dolmaz). */
export function exampleListings(): MarketListing[] {
  const base = { is_mine: false, created_at: new Date().toISOString() };
  const s = (n: number, o: Omit<MarketListing, 'id' | 'listing_type' | 'dest_city' | 'dest_district' | 'available_until' | 'is_mine' | 'created_at'> & { days: number }): MarketListing => {
    const { days, ...rest } = o;
    return { ...base, id: `demo-s${n}`, listing_type: 'SURPLUS_MATERIAL', dest_city: null, dest_district: null, available_until: addDays(days), ...rest };
  };
  const t = (n: number, o: Omit<MarketListing, 'id' | 'listing_type' | 'available_until' | 'is_mine' | 'created_at'> & { days: number }): MarketListing => {
    const { days, ...rest } = o;
    return { ...base, id: `demo-t${n}`, listing_type: 'BACKHAUL_TRUCK', available_until: addDays(days), ...rest };
  };
  return [
    s(1, { title: '4 Palet Ytong Gazbeton (10 cm, G2/04)', category: 'Kaba Yapı & Demir', quantity_info: '4 Palet / ~240 Adet', price: 26800, discount_note: 'Piyasa fiyatının %35 altı', origin_city: 'İstanbul', origin_district: 'Tuzla', description: 'Proje revizyonu sonrası artan, ambalajı açılmamış paletler. Kapalı alanda duruyor; yükleme için forklift mevcut.', days: 14 }),
    s(2, { title: 'Ø16 Nervürlü İnşaat Demiri (B500C, 12 m boy)', category: 'Kaba Yapı & Demir', quantity_info: 'Yaklaşık 3,2 Ton', price: 98000, discount_note: 'Piyasa fiyatının %12 altı', origin_city: 'Ankara', origin_district: 'Sincan', description: 'Temel imalatından artan, paslanmamış demir. Üretici sertifikası mevcut. Kantar fişi ile teslim.', days: 10 }),
    s(3, { title: 'Alüminyum Çerçeve Tip Cephe İskelesi Seti', category: 'İskele & Kalıp', quantity_info: '~850 m² / 1 şantiye seti', price: 210000, discount_note: 'Sıfır fiyatının %40 altı', origin_city: 'İzmir', origin_district: 'Bornova', description: 'Tek projede kullanıldı. Çerçeve, çapraz, ayak ve platformlar tam set. Teslim öncesi sayım yapılabilir.', days: 21 }),
    s(4, { title: 'Plywood Beton Kalıp Paneli (18 mm, 125×250)', category: 'İskele & Kalıp', quantity_info: '220 Adet', price: 165000, discount_note: 'Toplu alımda pazarlık payı var', origin_city: 'Bursa', origin_district: 'Nilüfer', description: '3-4 kullanım yapılmış, kenarları sağlam paneller. Yarısı da alınabilir.', days: 30 }),
    s(5, { title: '20 Feet Yalıtımlı Ofis Konteyneri (Klimalı)', category: 'Konteyner & Ekipman', quantity_info: '2 Adet', price: 145000, discount_note: 'Sıfır fiyatının %30 altı', origin_city: 'İstanbul', origin_district: 'Çekmeköy', description: 'Şantiye bitti. Elektrik tesisatı ve split klima çalışır durumda. Vinç ile yükleme alıcıya aittir.', days: 20 }),
    s(6, { title: '60 kVA Sessiz Tip Dizel Jeneratör (şantiye çıkışı)', category: 'Konteyner & Ekipman', quantity_info: '1 Adet / ~2.100 saat', price: 185000, discount_note: 'Piyasanın %20 altı', origin_city: 'Antalya', origin_district: 'Kepez', description: 'Periyodik bakımları yapıldı, bakım kayıtları mevcut. Yerinde çalışırken görülebilir.', days: 25 }),
    t(1, { title: 'Gebze - Ankara Boş Dönen Lowbed Tır', category: 'Lowbed & Ağır Nakliye', quantity_info: '28 Ton Kapasite', price: 32000, discount_note: 'Normal tarifenin %40 altı', origin_city: 'Kocaeli', origin_district: 'Gebze', dest_city: 'Ankara', dest_district: 'Sincan', description: 'Paletli iş makinesi taşımaya uygun, rampalı. Yükleme Gebze OSB çevresi; tarih esnek.', days: 4 }),
    t(2, { title: 'İzmir - İstanbul Dönüşü Boş Damperli Kamyon', category: 'Damperli & Kamyon', quantity_info: '18 Ton / 10 Teker', price: 14500, discount_note: 'Normal tarifenin %30 altı', origin_city: 'İzmir', origin_district: 'Aliağa', dest_city: 'İstanbul', dest_district: 'Tuzla', description: 'Hafriyat, kum veya çakıl taşımaya uygun. Dönüş yükü arıyorum.', days: 3 }),
    t(3, { title: 'Samsun - Ankara Boş Dönen Lowbed (Ekskavatör Uygun)', category: 'Lowbed & Ağır Nakliye', quantity_info: '35 Ton Kapasite', price: 38500, discount_note: 'Normal tarifenin %35 altı', origin_city: 'Samsun', origin_district: 'Atakum', dest_city: 'Ankara', dest_district: 'Etimesgut', description: 'Samsun çıkışlı iş makinesi teslimi sonrası boş dönüyor. Yükleme Atakum veya Çarşamba.', days: 6 }),
    t(4, { title: 'Bursa - Antalya Dönüşü Boş Kırkayak Damperli', category: 'Damperli & Kamyon', quantity_info: '22 Ton Kapasite', price: 21000, discount_note: 'Normal tarifenin %25 altı', origin_city: 'Bursa', origin_district: 'Nilüfer', dest_city: 'Antalya', dest_district: 'Kepez', description: 'Dökme yük için uygun. Yükleme Nilüfer sanayi bölgesi.', days: 5 }),
    t(5, { title: 'Konya - İstanbul Boş Dönen Lowbed (Vinç Taşımaya Uygun)', category: 'Lowbed & Ağır Nakliye', quantity_info: '40 Ton Kapasite', price: 52000, discount_note: 'Normal tarifenin %38 altı', origin_city: 'Konya', origin_district: 'Selçuklu', dest_city: 'İstanbul', dest_district: 'Pendik', description: 'Mobil vinç veya greyder taşımaya uygun, 3 akslı çekici. Eşlik belgesi mevcut.', days: 7 }),
    t(6, { title: 'Adana - Mersin Dönüşü Boş Damperli', category: 'Damperli & Kamyon', quantity_info: '16 Ton Kapasite', price: 6800, discount_note: 'Normal tarifenin %20 altı', origin_city: 'Adana', origin_district: 'Seyhan', dest_city: 'Mersin', dest_district: 'Tarsus', description: 'Kısa mesafe, aynı gün yükleme mümkün.', days: 2 }),
  ];
}

// ---------------------------------------------------------------- Okuma
type Row = Omit<MarketListing, 'price'> & { price: number | string };
const normalize = (r: Row): MarketListing => ({ ...r, price: Number(r.price), is_mine: !!r.is_mine, origin_district: r.origin_district ?? '' });

/** Vitrin: yalnızca aktif ve süresi dolmamış ilanlar (circular_market görünümü; telefon ve user_id içermez). */
export async function fetchListings(): Promise<MarketListing[]> {
  const db = createClient(), rows: MarketListing[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from('circular_market').select('*').order('created_at', { ascending: false }).order('id').range(page * 200, page * 200 + 199);
    if (error) throw new Error(error.message);
    rows.push(...(data as Row[]).map(normalize));
    if (data.length < 200) break;
  }
  return rows.length ? rows : exampleListings();
}

export async function fetchMyListings(): Promise<MyListing[]> {
  const { db, userId } = await requireUser();
  const { data, error } = await db.from('circular_listings').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('İlanlarınız alınamadı.');
  return (data as (Row & { status: 'ACTIVE' | 'SOLD'; contact_phone: string })[]).map(r => ({ ...normalize(r), is_mine: true, status: r.status, contact_phone: r.contact_phone }));
}

export async function fetchInquiriesFor(listingIds: string[]): Promise<Inquiry[]> {
  if (!listingIds.length) return [];
  const { db } = await requireUser();
  const { data, error } = await db.from('circular_inquiries').select('id,listing_id,message,offered_price,requester_phone,created_at')
    .in('listing_id', listingIds.slice(0, 100)).order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error('Gelen talepler alınamadı.');
  return (data as (Omit<Inquiry, 'offered_price'> & { offered_price: number | string | null })[]).map(r => ({ ...r, offered_price: r.offered_price === null ? null : Number(r.offered_price) }));
}

// ---------------------------------------------------------------- Yazma (user_id istemciden ASLA gönderilmez)
export async function createListing(v: NewListing): Promise<void> {
  const problem = validateListing(v);
  if (problem) throw new Error(problem);
  const { db } = await requireUser();
  const truck = v.listing_type === 'BACKHAUL_TRUCK';
  const { error } = await db.from('circular_listings').insert({
    listing_type: v.listing_type, title: v.title.trim(), category: v.category, quantity_info: v.quantity_info.trim(), price: v.price,
    discount_note: v.discount_note.trim(), origin_city: v.origin_city.trim(), origin_district: v.origin_district.trim(),
    dest_city: truck ? v.dest_city.trim() : null, dest_district: truck ? v.dest_district.trim() : null,
    available_until: v.available_until, contact_phone: v.contact_phone.trim(), description: v.description.trim(),
  });
  if (error) throw new Error(friendly(error, 'İlan kaydedilemedi. Alanları kontrol edip tekrar deneyin.'));
}

/** Talebi kaydeder; ardından (varsa) ilan sahibinin telefonunu döndürür. Telefon yalnızca talep gönderene verilir. */
export async function sendInquiry(listingId: string, v: NewInquiry): Promise<string | null> {
  const problem = validateInquiry(v);
  if (problem) throw new Error(problem);
  const { db } = await requireUser();
  const { error } = await db.from('circular_inquiries').insert({
    listing_id: listingId, message: v.message.trim(), requester_phone: v.requester_phone.trim(), offered_price: v.offered_price,
  });
  if (error) throw new Error(friendly(error, 'Talep gönderilemedi. İlan yayından kalkmış olabilir.'));
  try {
    const { data } = await db.rpc('circular_listing_contact', { p_listing: listingId });
    return typeof data === 'string' && data ? data : null;
  } catch { return null; }
}

export async function markListingSold(id: string): Promise<void> {
  const { db } = await requireUser();
  const { data, error } = await db.from('circular_listings').update({ status: 'SOLD' }).eq('id', id).select('id');
  if (error || !data?.length) throw new Error('İlan güncellenemedi.');
}
