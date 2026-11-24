import { createClient } from '@/lib/supabase/client';
import { Booking, Listing } from '@/types/database';
import { DEMO_LISTINGS } from '@/lib/mock-data';
import { checkDateRangeAvailable } from './calendar-service';
import { sanitizeContent } from '@/lib/security/contact-masker';
import { isDemoFallbackAllowed, isSupabaseConfigured } from '@/lib/config/runtime';

export interface BookingWithDetails extends Booking {
  listing?: Listing;
  buyer_name?: string;
  company_name?: string;
}

// In-Memory store for offline/demo operation
export const DEMO_BOOKINGS: BookingWithDetails[] = [
  {
    id: 'book-0000-0000-0000-000000000001',
    listing_id: '10000000-0000-0000-0000-000000000001',
    buyer_id: 'buyer-demo-001',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    start_date: '2026-11-01',
    end_date: '2026-11-03',
    quantity: 1,
    daily_price_applied: 12000,
    total_price: 36000,
    currency: 'TRY',
    status: 'approved',
    operator_included: true,
    fuel_included: false,
    transport_included: true,
    site_address: 'Tuzla Tepeören Şantiyesi No: 4',
    expires_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
    is_demo: true,
    listing: DEMO_LISTINGS[0],
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
    company_name: '[DEMO] Anadolu İş Makineleri Parkı',
  },
  {
    id: 'book-0000-0000-0000-000000000002',
    listing_id: '10000000-0000-0000-0000-000000000003',
    buyer_id: 'buyer-demo-001',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    start_date: '2026-11-20',
    end_date: '2026-11-24',
    quantity: 1,
    daily_price_applied: 8500,
    total_price: 34000,
    currency: 'TRY',
    status: 'pending',
    operator_included: true,
    fuel_included: false,
    transport_included: false,
    site_address: 'Kadıköy Fikirtepe Kentsel Dönüşüm Şantiyesi',
    expires_at: new Date(Date.now() + 3600000 * 36).toISOString(), // 36 hours remaining
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    updated_at: new Date().toISOString(),
    is_demo: true,
    listing: DEMO_LISTINGS[2],
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
    company_name: '[DEMO] Anadolu İş Makineleri Parkı',
  },
];

type BookingResult = { success: boolean; error?: string };

/** Veritabanı satırını ekranların beklediği alanlarla zenginleştirir. */
function mapBookingRow(row: any): BookingWithDetails {
  const totalDays = Number(row.total_days) || 1;
  const agreed = Number(row.agreed_price) || 0;
  return {
    ...row,
    total_price: agreed,
    daily_price_applied: totalDays > 0 ? Math.round(agreed / totalDays) : agreed,
    operator_included: row.is_operator_included ?? false,
    fuel_included: row.is_fuel_included ?? false,
    transport_included: row.is_transport_included ?? false,
    buyer_name: row.buyer?.full_name || row.buyer_name || undefined,
    company_name: row.company?.name || row.company_name || undefined,
  };
}

function friendlyDbError(message?: string): string {
  if (!message) return 'İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.';
  // Veritabanı korumalarının Türkçe mesajlarını olduğu gibi göster.
  if (/[ğüşıöçĞÜŞİÖÇ]/.test(message)) return message;
  return 'İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.';
}

export async function createBookingRequest(data: {
  listing_id: string;
  buyer_id?: string;
  company_id: string;
  start_date: string;
  end_date: string;
  quantity?: number;
  daily_price_applied: number;
  total_price: number;
  operator_included: boolean;
  fuel_included: boolean;
  transport_included: boolean;
  site_address: string;
  notes?: string;
}): Promise<{ success: boolean; booking?: BookingWithDetails; error?: string }> {
  if (!data.start_date || !data.end_date || data.end_date < data.start_date) {
    return { success: false, error: 'Lütfen geçerli bir başlangıç ve bitiş tarihi seçiniz.' };
  }

  const sanitizedNotes = data.notes ? sanitizeContent(data.notes).maskedText : null;
  const sanitizedAddress = data.site_address ? sanitizeContent(data.site_address).maskedText : null;
  const totalDays =
    Math.round(
      (new Date(data.end_date).getTime() - new Date(data.start_date).getTime()) / 86400000
    ) + 1;

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Çakışma ve kapalı gün kontrolü veritabanında (bookings_guard tetikleyicisi) da yapılır.
      const { data: dbData, error } = await supabase
        .from('bookings')
        .insert({
          buyer_id: user.id,
          company_id: data.company_id,
          listing_id: data.listing_id,
          start_date: data.start_date,
          end_date: data.end_date,
          total_days: totalDays,
          quantity: data.quantity || 1,
          agreed_price: data.total_price,
          currency: 'TRY',
          is_operator_included: data.operator_included,
          is_fuel_included: data.fuel_included,
          is_transport_included: data.transport_included,
          site_address: sanitizedAddress,
          notes: sanitizedNotes,
        })
        .select()
        .single();

      if (error || !dbData) {
        return { success: false, error: friendlyDbError(error?.message) };
      }
      return { success: true, booking: mapBookingRow(dbData) };
    }

    if (!isDemoFallbackAllowed()) {
      return { success: false, error: 'Rezervasyon talebi göndermek için giriş yapmalısınız.' };
    }
  }

  // ---------------- YEREL DEMO MODU ----------------
  const conflict = await checkDateRangeAvailable(data.listing_id, data.start_date, data.end_date);
  if (!conflict.available) {
    return {
      success: false,
      error: `Seçilen tarihler arasında (${conflict.conflictDate}) makine müsait değildir. Lütfen takvimdeki müsait günleri seçiniz.`,
    };
  }

  const newBooking: BookingWithDetails = {
    id: `book-${Date.now()}`,
    listing_id: data.listing_id,
    buyer_id: data.buyer_id || 'buyer-demo-001',
    company_id: data.company_id,
    start_date: data.start_date,
    end_date: data.end_date,
    quantity: data.quantity || 1,
    total_days: totalDays,
    daily_price_applied: data.daily_price_applied,
    total_price: data.total_price,
    agreed_price: data.total_price,
    currency: 'TRY',
    status: 'pending',
    operator_included: data.operator_included,
    fuel_included: data.fuel_included,
    transport_included: data.transport_included,
    site_address: sanitizedAddress,
    notes: sanitizedNotes,
    expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_demo: true,
    listing: DEMO_LISTINGS.find((l) => l.id === data.listing_id),
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
    company_name: '[DEMO] Anadolu İş Makineleri Parkı',
  };
  DEMO_BOOKINGS.unshift(newBooking);
  return { success: true, booking: newBooking };
}

export async function getBuyerBookings(buyerId?: string): Promise<BookingWithDetails[]> {
  if (isSupabaseConfigured()) {
    const db = createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (user) {
      const { data, error } = await db
        .from('bookings')
        .select('*, listing:listings(*), company:companies(name)')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map(mapBookingRow);
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  checkAutoExpiration();
  return buyerId ? DEMO_BOOKINGS.filter((b) => b.buyer_id === buyerId) : DEMO_BOOKINGS;
}

export async function getCompanyBookings(companyId: string): Promise<BookingWithDetails[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('bookings')
      .select('*, listing:listings(*)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    const buyerIds = Array.from(new Set((data || []).map((b: any) => b.buyer_id).filter(Boolean)));
    const names = new Map<string, string>();
    if (buyerIds.length > 0) {
      const { data: nameRows } = await supabase.rpc('get_profile_names', { p_ids: buyerIds });
      (nameRows || []).forEach((r: any) => names.set(r.id, r.full_name));
    }
    return (data || []).map((b: any) => ({
      ...mapBookingRow(b),
      buyer_name: names.get(b.buyer_id) || 'Alıcı / Müteahhit',
    }));
  }

  checkAutoExpiration();
  return DEMO_BOOKINGS.filter((b) => b.company_id === companyId);
}

/**
 * Durum değişikliği. Yetki ve geçiş kuralları veritabanında (bookings_guard) uygulanır;
 * onayda takvim doldurma ve iletişim açılışı da veritabanı tetikleyicileriyle yapılır.
 */
async function updateBookingStatus(
  bookingId: string,
  status: 'approved' | 'rejected' | 'cancelled',
  rejectionReason?: string
): Promise<BookingResult> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const patch: Record<string, unknown> = { status };
    if (status === 'rejected' && rejectionReason) {
      patch.rejection_reason = sanitizeContent(rejectionReason).maskedText;
    }
    const { data, error } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .select('id')
      .maybeSingle();

    if (error) return { success: false, error: friendlyDbError(error.message) };
    if (data) return { success: true };
    if (!isDemoFallbackAllowed()) {
      return { success: false, error: 'Rezervasyon bulunamadı veya bu işlem için yetkiniz yok.' };
    }
  }

  const booking = DEMO_BOOKINGS.find((b) => b.id === bookingId);
  if (!booking) return { success: false, error: 'Rezervasyon bulunamadı.' };
  booking.status = status;
  booking.updated_at = new Date().toISOString();
  return { success: true };
}

export function approveBooking(bookingId: string): Promise<BookingResult> {
  return updateBookingStatus(bookingId, 'approved');
}

export function rejectBooking(bookingId: string, reason?: string): Promise<BookingResult> {
  return updateBookingStatus(bookingId, 'rejected', reason);
}

export function cancelBooking(bookingId: string): Promise<BookingResult> {
  return updateBookingStatus(bookingId, 'cancelled');
}

function checkAutoExpiration(): void {
  const now = new Date();
  DEMO_BOOKINGS.forEach((b) => {
    if (b.status === 'pending' && new Date(b.expires_at) < now) {
      b.status = 'expired';
    }
  });
}
