import { createClient } from '@/lib/supabase/client';
import { isDemoFallbackAllowed, isSupabaseConfigured } from '@/lib/config/runtime';

export interface CalendarDayStatus {
  date: string; // YYYY-MM-DD
  status: 'available' | 'booked' | 'maintenance';
  stock_booked: number;
  stock_total: number;
  notes?: string;
}

// In-memory demo availability calendar store
export const DEMO_CALENDAR_ENTRIES: Record<string, CalendarDayStatus[]> = {
  // CAT 320D Excavator
  '10000000-0000-0000-0000-000000000001': [
    { date: '2026-11-01', status: 'booked', stock_booked: 1, stock_total: 1, notes: 'Önceden kiralanmış' },
    { date: '2026-11-02', status: 'booked', stock_booked: 1, stock_total: 1, notes: 'Önceden kiralanmış' },
    { date: '2026-11-03', status: 'booked', stock_booked: 1, stock_total: 1, notes: 'Önceden kiralanmış' },
    { date: '2026-11-04', status: 'maintenance', stock_booked: 1, stock_total: 1, notes: 'Periyodik 1000 saat bakımı' },
    { date: '2026-11-15', status: 'booked', stock_booked: 1, stock_total: 1 },
    { date: '2026-11-16', status: 'booked', stock_booked: 1, stock_total: 1 },
    { date: '2026-11-17', status: 'booked', stock_booked: 1, stock_total: 1 },
  ],
};

type AvailabilityRow = {
  date: string;
  status: CalendarDayStatus['status'];
  booked_quantity: number | null;
  notes: string | null;
};

function monthRange(year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
  return { startDate, endDate };
}

export async function getListingAvailability(
  listingId: string,
  year: number,
  month: number // 1-12
): Promise<CalendarDayStatus[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { startDate, endDate } = monthRange(year, month);
    const [{ data, error }, { data: listing }] = await Promise.all([
      supabase
        .from('listing_availability')
        .select('date, status, booked_quantity, notes')
        .eq('listing_id', listingId)
        .gte('date', startDate)
        .lt('date', endDate),
      supabase.from('listings').select('stock_quantity').eq('id', listingId).maybeSingle(),
    ]);

    if (!error && data) {
      const stock = Number(listing?.stock_quantity) || 1;
      return (data as AvailabilityRow[]).map((row) => ({
        date: row.date,
        status: row.status,
        stock_booked: row.booked_quantity ?? 0,
        stock_total: stock,
        notes: row.notes ?? undefined,
      }));
    }
    if (!isDemoFallbackAllowed()) return [];
  }

  return DEMO_CALENDAR_ENTRIES[listingId] || [];
}

export async function setBatchAvailability(
  listingId: string,
  dates: string[],
  status: 'available' | 'booked' | 'maintenance',
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  if (dates.length === 0) return { success: true };

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    // Elle "dolu" işaretlenen gün tüm stok için kapanır.
    const { data: listing } = await supabase
      .from('listings')
      .select('stock_quantity')
      .eq('id', listingId)
      .maybeSingle();
    const stock = Number(listing?.stock_quantity) || 1;

    const rows = dates.map((date) => ({
      listing_id: listingId,
      date,
      status,
      notes: notes ? notes.slice(0, 200) : null,
      booked_quantity: status === 'booked' ? stock : 0,
    }));

    const { error } = await supabase
      .from('listing_availability')
      .upsert(rows, { onConflict: 'listing_id,date' });

    if (!error) return { success: true };
    if (!isDemoFallbackAllowed()) {
      return { success: false, error: 'Takvim kaydedilemedi. Bu ilan için yetkiniz olmayabilir.' };
    }
  }

  // Yerel demo deposu
  if (!DEMO_CALENDAR_ENTRIES[listingId]) {
    DEMO_CALENDAR_ENTRIES[listingId] = [];
  }
  dates.forEach((d) => {
    const existingIdx = DEMO_CALENDAR_ENTRIES[listingId].findIndex((entry) => entry.date === d);
    const updatedEntry: CalendarDayStatus = {
      date: d,
      status,
      stock_booked: status === 'available' ? 0 : 1,
      stock_total: 1,
      notes,
    };
    if (existingIdx >= 0) {
      DEMO_CALENDAR_ENTRIES[listingId][existingIdx] = updatedEntry;
    } else {
      DEMO_CALENDAR_ENTRIES[listingId].push(updatedEntry);
    }
  });

  return { success: true };
}

export async function checkDateRangeAvailable(
  listingId: string,
  startDateStr: string,
  endDateStr: string
): Promise<{ available: boolean; conflictDate?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('check_booking_overlap', {
      p_listing_id: listingId,
      p_start_date: startDateStr,
      p_end_date: endDateStr,
    });
    if (!error && typeof data === 'boolean') {
      return data ? { available: true } : { available: false, conflictDate: `${startDateStr} – ${endDateStr}` };
    }
    if (!isDemoFallbackAllowed()) return { available: false };
  }

  const entries = DEMO_CALENDAR_ENTRIES[listingId] || [];
  const curr = new Date(startDateStr);
  const end = new Date(endDateStr);
  while (curr <= end) {
    const dateFormatted = curr.toISOString().split('T')[0];
    const match = entries.find((e) => e.date === dateFormatted);
    if (match && (match.status === 'booked' || match.status === 'maintenance')) {
      return { available: false, conflictDate: dateFormatted };
    }
    curr.setDate(curr.getDate() + 1);
  }
  return { available: true };
}
