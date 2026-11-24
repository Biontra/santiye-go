import { createClient } from '@/lib/supabase/client';
import {
  AdminAuditLog,
  AdminRole,
  AdminUser,
  Category,
  Company,
  Listing,
  PaymentTransaction,
  PlatformSetting,
  Profile,
  Report,
} from '@/types/database';
import { CATEGORIES, DEMO_LISTINGS } from '@/lib/mock-data';
import { isDemoFallbackAllowed, isSupabaseConfigured } from '@/lib/config/runtime';

// Demo in-memory stores for Admin
export const DEMO_ADMIN_LOGS: AdminAuditLog[] = [
  {
    id: 'log-001',
    admin_id: 'admin-super-001',
    action: 'VERIFY_COMPANY_APPROVED',
    target_type: 'company',
    target_id: 'f0000000-0000-0000-0000-000000000001',
    ip_address: '127.0.0.1',
    details: { name: 'Anadolu İş Makineleri Parkı', status: 'approved' },
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: 'log-002',
    admin_id: 'admin-super-001',
    action: 'SETTING_COMMISSION_UPDATE',
    target_type: 'setting',
    target_id: 'default_commission_rate',
    ip_address: '127.0.0.1',
    details: { old_rate: 10.0, new_rate: 8.0 },
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
  },
];

export const DEMO_PLATFORM_SETTINGS: Record<string, PlatformSetting> = {
  default_commission_rate: {
    key: 'default_commission_rate',
    value: { rate_percent: 8.0 },
    description: 'Global varsayılan platform komisyon oranı (%)',
    updated_at: new Date().toISOString(),
  },
  booking_cancellation_hours: {
    key: 'booking_cancellation_hours',
    value: { hours: 24 },
    description: 'Rezervasyon başlangıç tarihinden kaç saat öncesine kadar cezasız iptal edilebilir',
    updated_at: new Date().toISOString(),
  },
  quote_request_auto_expire_hours: {
    key: 'quote_request_auto_expire_hours',
    value: { hours: 48 },
    description: 'Teklif ve rezervasyon talepleri için otomatik iptal süresi (saat)',
    updated_at: new Date().toISOString(),
  },
  platform_payout_escrow_days: {
    key: 'platform_payout_escrow_days',
    value: { days: 3 },
    description: 'İş tesliminden sonra şikayet bekleme ve satıcıya otomatik hakediş aktarım süresi (gün)',
    updated_at: new Date().toISOString(),
  },
};

export const DEMO_REPORTS: Report[] = [
  {
    id: 'rep-001',
    reporter_id: 'buyer-demo-001',
    reported_user_id: 'f0000000-0000-0000-0000-000000000002',
    listing_id: '10000000-0000-0000-0000-000000000004',
    reason: 'Fiyat Uyuşmazlığı',
    details: 'İlanda belirtilen tonaj fiyatı ile teklifte verilen fiyat arasında ciddi fark bulunuyor.',
    status: 'pending',
    created_at: new Date(Date.now() - 3600000 * 10).toISOString(),
  },
  {
    id: 'rep-002',
    reporter_id: 'buyer-demo-002',
    reported_user_id: 'f0000000-0000-0000-0000-000000000003',
    message_id: 'msg-001',
    reason: 'Kural Dışı Teklif',
    details: 'Platform dışından komisyonsuz nakit ödeme teklif edildi.',
    status: 'investigating',
    admin_notes: 'Firma ile görüşüldü, yazılı uyarı gönderilecek.',
    created_at: new Date(Date.now() - 3600000 * 30).toISOString(),
  },
];

export const DEMO_COMPANIES_FOR_VERIFICATION: Company[] = [
  {
    id: 'f0000000-0000-0000-0000-000000000001',
    user_id: 'e0000000-0000-0000-0000-000000000001',
    name: '[DEMO] Anadolu İş Makineleri Parkı',
    tax_office: 'Tuzla Vergi Dairesi',
    tax_number: '1234567890',
    legal_type: 'LIMITED_OR_JOINT_STOCK_COMPANY',
    tax_plate_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80',
    signature_circular_url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=800&q=80',
    verification_status: 'approved',
    sub_merchant_key: 'subm-anadolu-001',
    iban_last4: '9001',
    accept_online_payments: true,
    phone: '+90 532 000 0101',
    city_name: 'İstanbul',
    district_name: 'Tuzla',
    is_verified: true,
    is_demo: true,
    created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'f0000000-0000-0000-0000-000000000002',
    user_id: 'e0000000-0000-0000-0000-000000000002',
    name: '[DEMO] Marmara Yapı & Lojistik Deposu',
    tax_office: 'Gebze İhtisas Vergi Dairesi',
    tax_number: '9876543210',
    legal_type: 'LIMITED_OR_JOINT_STOCK_COMPANY',
    tax_plate_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80',
    signature_circular_url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=800&q=80',
    verification_status: 'pending',
    sub_merchant_key: null,
    iban_last4: '9002',
    accept_online_payments: true,
    phone: '+90 532 000 0102',
    city_name: 'Kocaeli',
    district_name: 'Gebze',
    is_verified: false,
    is_demo: true,
    created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'f0000000-0000-0000-0000-000000000003',
    user_id: 'e0000000-0000-0000-0000-000000000003',
    name: '[DEMO] Başkent Ağır Nakliyat & Lowbed',
    tax_office: 'Yenimahalle Vergi Dairesi',
    tax_number: '4455667788',
    legal_type: 'PRIVATE_COMPANY',
    tax_plate_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80',
    verification_status: 'rejected',
    verification_notes: 'Vergi levhası okunaksız ve IBAN mükellef adına değil.',
    sub_merchant_key: null,
    phone: '+90 532 000 0103',
    city_name: 'Ankara',
    district_name: 'Ostim',
    is_verified: false,
    is_demo: true,
    created_at: new Date(Date.now() - 3600000 * 40).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Audit Logger
export async function logAdminAction(
  adminId: string,
  action: string,
  targetType: 'user' | 'company' | 'listing' | 'category' | 'setting' | 'payment' | 'subscription' | 'compliance_log' | 'profile',
  targetId: string | null,
  details?: Record<string, any>
): Promise<void> {
  const log: AdminAuditLog = {
    id: `log-${Date.now()}`,
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    ip_address: '127.0.0.1',
    details: details || null,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Kimlik istemciden gelen parametreye değil oturuma dayanır; ip sunucuda bilinmez.
      await supabase.from('admin_audit_logs').insert({
        admin_id: user?.id ?? null,
        action,
        target_type: targetType,
        target_id: targetId,
        details: details || null,
      });
    } catch {
      // Denetim logu yazılamazsa asıl işlem engellenmez.
    }
    if (!isDemoFallbackAllowed()) return;
  }

  DEMO_ADMIN_LOGS.unshift(log);
}

export async function getRecentAdminLogs(limit = 20): Promise<AdminAuditLog[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && data) return data as AdminAuditLog[];
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_ADMIN_LOGS.slice(0, limit);
}

// Dashboard Metrics
export async function getAdminDashboardMetrics() {
  try {
    const supabase = createClient();
    const [
      { count: totalUsers },
      { count: totalCompanies },
      { count: activeListings },
      { count: pendingVerifications },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('companies').select('*', { count: 'exact', head: true }),
      supabase.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('companies').select('*', { count: 'exact', head: true }).eq('is_verified', false),
    ]);
    const { count: pendingReports } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    return {
      totalUsers: totalUsers ?? 0,
      totalCompanies: totalCompanies ?? 0,
      activeListings: activeListings ?? 0,
      monthBookings: 0,
      totalVolumeCents: 0,
      totalCommissionCents: 0,
      pendingVerifications: pendingVerifications ?? 0,
      pendingReports: pendingReports ?? 0,
    };
  } catch (err) {
    console.warn('[admin-service] getAdminDashboardMetrics error:', err);
  }

  const allowDemo = isDemoFallbackAllowed() && process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === 'true';
  if (allowDemo) {
    return {
      totalUsers: 6,
      totalCompanies: DEMO_COMPANIES_FOR_VERIFICATION.length,
      activeListings: DEMO_LISTINGS.filter((l) => l.status === 'active').length,
      monthBookings: 28,
      totalVolumeCents: 184500000,
      totalCommissionCents: 14760000,
      pendingVerifications: DEMO_COMPANIES_FOR_VERIFICATION.filter(
        (c) => c.verification_status === 'pending'
      ).length,
      pendingReports: DEMO_REPORTS.filter((r) => r.status === 'pending').length,
    };
  }

  return {
    totalUsers: 0,
    totalCompanies: 0,
    activeListings: 0,
    monthBookings: 0,
    totalVolumeCents: 0,
    totalCommissionCents: 0,
    pendingVerifications: 0,
    pendingReports: 0,
  };
}

// Company Verification Workflow
export async function getCompaniesForVerification(): Promise<Company[]> {
  const resultList: Company[] = [];

  try {
    const supabase = createClient();

    // 1. Canlı Supabase Companies tablosunu çek
    const { data: dbCompanies, error: compError } = await supabase
      .from('companies')
      .select(`
        *,
        city:cities(name),
        district:districts(name)
      `)
      .order('created_at', { ascending: false });

    if (!compError && dbCompanies && dbCompanies.length > 0) {
      dbCompanies.forEach((c) => {
        resultList.push({
          ...c,
          city_name: c.city?.name || 'Belirtilmedi',
          district_name: c.district?.name || '',
          verification_status: c.verification_status || (c.is_verified ? 'approved' : 'pending'),
        });
      });
    }

    // 2. Profiles tablosunda rolü 'company' olan tüm gerçek kullanıcıları da ekle (Henüz companies tablosunda olmayanlar dahil)
    const { data: companyProfiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'company')
      .order('created_at', { ascending: false });

    if (companyProfiles && companyProfiles.length > 0) {
      for (const p of companyProfiles) {
        const alreadyInList = resultList.some((c) => c.user_id === p.id || c.id === p.id);
        if (!alreadyInList) {
          resultList.push({
            id: p.id,
            user_id: p.id,
            name: p.full_name || 'Firma Kullanıcısı',
            phone: p.phone || '',
            city_id: 34,
            district_id: 104,
            city_name: 'İstanbul',
            district_name: 'Merkez',
            verification_status: p.is_phone_verified ? 'pending' : 'pending',
            is_verified: false,
            is_demo: false,
            created_at: p.created_at,
            updated_at: p.updated_at,
          } as Company);
        }
      }
    }
  } catch (err) {
    console.warn('[admin-service] getCompanies error:', err);
  }

  // 3. Gerçek veritabanı sonuçlarını dön (Production'da sahte/demo veri sızıntısını engelle)
  const allowDemo = isDemoFallbackAllowed() && process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === 'true';
  if (resultList.length > 0) {
    return resultList;
  }

  return allowDemo ? DEMO_COMPANIES_FOR_VERIFICATION : [];
}

export async function verifyCompany(
  companyId: string,
  status: 'approved' | 'rejected',
  notes: string,
  adminId: string
): Promise<{ success: boolean }> {
  try {
    const supabase = createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    const effectiveAdminId = authUser?.id || adminId;

    const updatePayload: Record<string, any> = {
      is_verified: status === 'approved',
      verification_status: status,
      verification_notes: notes || null,
      verified_at: new Date().toISOString(),
      verified_by: effectiveAdminId,
    };
    if (status === 'approved') {
      updatePayload.sub_merchant_status = 'approved';
    }

    // 1. Önce doğrudan id veya user_id üzerinden güncelle
    const { data: updatedRows, error } = await supabase
      .from('companies')
      .update(updatePayload)
      .or(`id.eq.${companyId},user_id.eq.${companyId}`)
      .select('id, user_id');

    // 2. Eğer companies tablosunda kayıt yoksa, profiles'tan alarak companies tablosuna ekle
    if (!updatedRows || updatedRows.length === 0) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', companyId)
        .maybeSingle();

      if (prof) {
        await supabase.from('companies').upsert({
          id: prof.id,
          user_id: prof.id,
          name: prof.full_name || 'Onaylı Firma',
          phone: prof.phone || '',
          is_verified: status === 'approved',
          verification_status: status,
          verification_notes: notes || null,
          verified_at: new Date().toISOString(),
          verified_by: effectiveAdminId,
          is_demo: false,
        });
      }
    }

    if (error) {
      console.warn('[admin-service] verifyCompany update error:', error);
    }

    await logAdminAction(
      effectiveAdminId,
      status === 'approved' ? 'VERIFY_COMPANY_APPROVED' : 'VERIFY_COMPANY_REJECTED',
      'company',
      companyId,
      { status, notes }
    );
  } catch (err) {
    console.warn('[admin-service] verifyCompany error:', err);
  }

  return { success: true };
}

// Listing Moderation
export async function getAdminListings(statusFilter = 'all'): Promise<Listing[]> {
  try {
    const supabase = createClient();
    let query = supabase
      .from('listings')
      .select(`
        *,
        company:companies(name, logo_url, phone),
        category:categories(name, slug),
        city:cities(name),
        district:districts(name)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (!error && data) {
      return data.map((l) => ({
        ...l,
        company_name: l.company?.name || 'Firma',
        category_name: l.category?.name || 'Genel',
        city_name: l.city?.name || '',
        district_name: l.district?.name || '',
      }));
    }
  } catch (err) {
    console.warn('[admin-service] getAdminListings error:', err);
  }

  const allowDemo = isDemoFallbackAllowed() && process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === 'true';
  if (allowDemo) {
    if (statusFilter === 'all') return DEMO_LISTINGS;
    return DEMO_LISTINGS.filter((l) => l.status === statusFilter);
  }

  return [];
}

export async function moderateListing(
  listingId: string,
  action: 'approve' | 'reject' | 'remove',
  reason: string,
  _adminId?: string
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    try {
      const res = await fetch('/api/admin/listings/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, action, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json.error || 'İlan güncellenemedi.' };
      return { success: true };
    } catch {
      if (!isDemoFallbackAllowed()) return { success: false, error: 'İlan güncellenemedi.' };
    }
  }
  const demo = DEMO_LISTINGS.find((l) => l.id === listingId);
  if (demo) demo.status = action === 'approve' ? 'active' : action === 'reject' ? 'rejected' : 'inactive';
  return { success: true };
}

// Category Management
export async function getAdminCategories(): Promise<Category[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase.from('categories').select('*').order('order_index');
    if (!error && data) {
      const parents = data.filter((c) => !c.parent_id);
      return parents.map((parent) => ({
        ...parent,
        subcategories: data.filter((c) => c.parent_id === parent.id),
      }));
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  return CATEGORIES;
}

export async function saveCategory(
  category: Partial<Category>,
  adminId: string
): Promise<{ success: boolean; category?: Category; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const row = {
      name: category.name,
      slug: category.slug,
      order_index: category.order_index,
      is_active: category.is_active ?? true,
      allowed_listing_types: category.allowed_listing_types,
      parent_id: category.parent_id ?? null,
    };
    const isUuid = !!category.id && /^[0-9a-f-]{36}$/i.test(category.id);
    const query = isUuid
      ? supabase.from('categories').update(row).eq('id', category.id!).select().maybeSingle()
      : supabase.from('categories').insert(row).select().maybeSingle();
    const { data, error } = await query;
    if (!error && data) {
      await logAdminAction(adminId, 'CATEGORY_SAVED', 'category', data.id, { name: data.name });
      return { success: true, category: data as Category };
    }
    if (!isDemoFallbackAllowed()) {
      return { success: false, error: 'Kategori kaydedilemedi (slug benzersiz olmalı).' };
    }
  }

  let savedCat: Category;
  const existingIdx = CATEGORIES.findIndex((c) => c.id === category.id);
  if (existingIdx >= 0) {
    CATEGORIES[existingIdx] = { ...CATEGORIES[existingIdx], ...category } as Category;
    savedCat = CATEGORIES[existingIdx];
  } else {
    savedCat = {
      id: `cat-${Date.now()}`,
      name: category.name || 'Yeni Kategori',
      slug: category.slug || `cat-${Date.now()}`,
      order_index: category.order_index || CATEGORIES.length + 1,
      is_active: category.is_active ?? true,
      created_at: new Date().toISOString(),
      subcategories: category.subcategories || [],
    };
    CATEGORIES.push(savedCat);
  }
  await logAdminAction(adminId, 'CATEGORY_SAVED', 'category', savedCat.id, { name: savedCat.name });
  return { success: true, category: savedCat };
}

// Reports Desk
export async function getAdminReports(): Promise<Report[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error && data) return data as Report[];
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_REPORTS;
}

export async function resolveReport(
  reportId: string,
  status: 'resolved' | 'dismissed',
  adminNotes: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('reports')
      .update({
        status,
        admin_notes: adminNotes,
        resolved_by: user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', reportId)
      .select('id')
      .maybeSingle();
    if (!error && data) {
      await logAdminAction(adminId, `REPORT_${status.toUpperCase()}`, 'user', reportId, { status, adminNotes });
      return { success: true };
    }
    if (!isDemoFallbackAllowed()) return { success: false, error: 'Şikayet güncellenemedi.' };
  }

  const rep = DEMO_REPORTS.find((r) => r.id === reportId);
  if (rep) {
    rep.status = status;
    rep.admin_notes = adminNotes;
    rep.resolved_by = adminId;
    rep.resolved_at = new Date().toISOString();
  }
  await logAdminAction(adminId, `REPORT_${status.toUpperCase()}`, 'user', reportId, { status, adminNotes });
  return { success: true };
}

// Platform Settings
// soft_launch_config gibi bazı anahtarlar system_settings tablosunda tutulur.
const SYSTEM_SETTING_KEYS = new Set(['soft_launch_config']);

export async function getPlatformSettings(): Promise<Record<string, PlatformSetting>> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const [platform, system] = await Promise.all([
      supabase.from('platform_settings').select('*'),
      supabase.from('system_settings').select('*').in('key', Array.from(SYSTEM_SETTING_KEYS)),
    ]);
    if (!platform.error && platform.data) {
      const result: Record<string, PlatformSetting> = {};
      for (const row of [...platform.data, ...(system.data || [])]) {
        result[row.key] = row as PlatformSetting;
      }
      return result;
    }
    if (!isDemoFallbackAllowed()) return {};
  }
  return DEMO_PLATFORM_SETTINGS;
}

export async function updatePlatformSetting(
  key: string,
  value: Record<string, any>,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const table = SYSTEM_SETTING_KEYS.has(key) ? 'system_settings' : 'platform_settings';
    const { data: existing } = await supabase.from(table).select('value').eq('key', key).maybeSingle();
    // Mevcut alanlar korunur (ör. soft_launch_config.allowed_categories).
    const merged = { ...((existing?.value as Record<string, any>) || {}), ...value };
    const { error } = await supabase
      .from(table)
      .upsert({ key, value: merged, updated_by: user?.id ?? null, updated_at: new Date().toISOString() });
    if (!error) {
      await logAdminAction(adminId, 'SETTING_UPDATED', 'setting', key, {
        old_value: existing?.value ?? null,
        new_value: merged,
      });
      return { success: true };
    }
    if (!isDemoFallbackAllowed()) return { success: false, error: `Ayar kaydedilemedi: ${key}` };
  }

  const existing = DEMO_PLATFORM_SETTINGS[key];
  const oldVal = existing ? existing.value : null;
  DEMO_PLATFORM_SETTINGS[key] = {
    key,
    value,
    description: existing?.description,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
  await logAdminAction(adminId, 'SETTING_UPDATED', 'setting', key, { old_value: oldVal, new_value: value });
  return { success: true };
}


// ==========================================
// PROMPT 9A: İLETİŞİM KORUMA & DENETİM SERVİSİ
// ==========================================

export interface ComplianceLogItem {
  id: string;
  user_id: string;
  user_name?: string;
  detected_types: string[];
  target_entity_type: string;
  is_false_positive_reported: boolean;
  false_positive_notes?: string;
  false_positive_status: 'none' | 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface OffenderProfile {
  user_id: string;
  full_name: string;
  role: 'buyer' | 'company';
  company_name?: string;
  mask_violation_count: number;
  compliance_status: 'good_standing' | 'warned' | 'suspended';
  last_violation_at: string;
}

export const DEMO_COMPLIANCE_LOGS: ComplianceLogItem[] = [
  {
    id: 'comp-001',
    user_id: 'buyer-demo-002',
    user_name: 'Mehmet Demir (Alt Taşeron)',
    detected_types: ['phone'],
    target_entity_type: 'message',
    is_false_positive_reported: false,
    false_positive_status: 'none',
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
  },
  {
    id: 'comp-002',
    user_id: 'buyer-demo-002',
    user_name: 'Mehmet Demir (Alt Taşeron)',
    detected_types: ['social_keyword', 'phone'],
    target_entity_type: 'message',
    is_false_positive_reported: false,
    false_positive_status: 'none',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'comp-003',
    user_id: 'buyer-demo-003',
    user_name: 'Kemal Can (Hafriyatçı)',
    detected_types: ['phone'],
    target_entity_type: 'quote_notes',
    is_false_positive_reported: true,
    false_positive_notes: 'Makine motor gücü ve saatlik tüketimini belirttim, numara yazmadım.',
    false_positive_status: 'pending',
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'comp-004',
    user_id: 'f0000000-0000-0000-0000-000000000003',
    user_name: 'Başkent Ağır Nakliyat',
    detected_types: ['iban'],
    target_entity_type: 'message',
    is_false_positive_reported: false,
    false_positive_status: 'none',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

export const DEMO_REPEAT_OFFENDERS: OffenderProfile[] = [
  {
    user_id: 'buyer-demo-002',
    full_name: 'Mehmet Demir',
    role: 'buyer',
    company_name: 'Demir Altyapı Ltd.',
    mask_violation_count: 4,
    compliance_status: 'warned',
    last_violation_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    user_id: 'f0000000-0000-0000-0000-000000000003',
    full_name: 'Başkent Nakliyat İrtibat',
    role: 'company',
    company_name: 'Başkent Ağır Nakliyat',
    mask_violation_count: 3,
    compliance_status: 'good_standing',
    last_violation_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

export async function getComplianceStats(): Promise<{
  totalMasked: number;
  phoneCount: number;
  emailCount: number;
  ibanCount: number;
  socialCount: number;
  disputeCount: number;
  repeatOffenderCount: number;
  softModeRevealCount: number;
}> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data: logs, error } = await supabase
        .from('compliance_mask_logs')
        .select('detected_types, is_false_positive_reported, review_status');
      if (!error && logs) {
        let phone = 0, email = 0, iban = 0, social = 0, disputes = 0;
        logs.forEach((l: any) => {
          const t: string[] = l.detected_types || [];
          if (t.includes('phone')) phone++;
          if (t.includes('email')) email++;
          if (t.includes('iban')) iban++;
          if (t.includes('social_keyword') || t.includes('domain_url')) social++;
          if (l.is_false_positive_reported && l.review_status === 'pending') disputes++;
        });
        const [{ count: offendersCount }, { count: revealCount }] = await Promise.all([
          supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('mask_violation_count', 3),
          supabase.from('phone_reveal_daily_logs').select('*', { count: 'exact', head: true }),
        ]);
        return {
          totalMasked: logs.length,
          phoneCount: phone,
          emailCount: email,
          ibanCount: iban,
          socialCount: social,
          disputeCount: disputes,
          repeatOffenderCount: offendersCount || 0,
          softModeRevealCount: revealCount || 0,
        };
      }
    } catch {
      // aşağıdaki karara düşer
    }
    if (!isDemoFallbackAllowed()) {
      return {
        totalMasked: 0, phoneCount: 0, emailCount: 0, ibanCount: 0,
        socialCount: 0, disputeCount: 0, repeatOffenderCount: 0, softModeRevealCount: 0,
      };
    }
  }

  return {
    totalMasked: DEMO_COMPLIANCE_LOGS.length + 8,
    phoneCount: 7,
    emailCount: 2,
    ibanCount: 1,
    socialCount: 2,
    disputeCount: 1,
    repeatOffenderCount: 2,
    softModeRevealCount: 12,
  };
}

export async function getComplianceDisputes(): Promise<ComplianceLogItem[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('compliance_mask_logs')
      .select('*')
      .eq('is_false_positive_reported', true)
      .order('created_at', { ascending: false });
    if (!error && data) {
      // Canlı şemada durum sütunu review_status, açıklama false_positive_reason.
      return data.map((d: any) => ({
        ...d,
        false_positive_status: d.false_positive_status ?? d.review_status,
      })) as ComplianceLogItem[];
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_COMPLIANCE_LOGS.filter((l) => l.is_false_positive_reported);
}

export async function resolveComplianceDispute(
  logId: string,
  status: 'approved' | 'rejected',
  adminNotes?: string,
  adminId: string = 'admin-super-001'
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('compliance_mask_logs')
      .update({
        review_status: status,
        reviewed_by_admin: user?.id ?? null,
      })
      .eq('id', logId)
      .select('id')
      .maybeSingle();
    if (!error && data) {
      await logAdminAction(adminId, `COMPLIANCE_DISPUTE_${status.toUpperCase()}`, 'compliance_log', logId, {
        status,
        adminNotes,
      });
      return { success: true };
    }
    if (!isDemoFallbackAllowed()) return { success: false, error: 'İtiraz güncellenemedi.' };
  }

  const found = DEMO_COMPLIANCE_LOGS.find((l) => l.id === logId);
  if (found) found.false_positive_status = status;
  await logAdminAction(adminId, `COMPLIANCE_DISPUTE_${status.toUpperCase()}`, 'compliance_log', logId, {
    status,
    adminNotes,
  });
  return { success: true };
}

export async function getRepeatOffendersList(): Promise<OffenderProfile[]> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id:id, full_name, role, mask_violation_count, compliance_status, updated_at')
      .gte('mask_violation_count', 1)
      .order('mask_violation_count', { ascending: false });
    if (!error && data) {
      return data.map((d: any) => ({
        ...d,
        last_violation_at: d.updated_at || new Date().toISOString(),
      }));
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_REPEAT_OFFENDERS;
}

export async function takeOffenderAction(
  userId: string,
  action: 'warn' | 'suspend' | 'clear',
  adminId: string = 'admin-super-001'
): Promise<{ success: boolean; error?: string }> {
  // profiles.compliance_status değerleri: clean | warned | flagged | suspended
  const newStatus = action === 'suspend' ? 'suspended' : action === 'warn' ? 'warned' : 'clean';

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const patch: Record<string, unknown> = { compliance_status: newStatus };
    if (action === 'clear') patch.mask_violation_count = 0;
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (!error && data) {
      await logAdminAction(adminId, `OFFENDER_ACTION_${action.toUpperCase()}`, 'profile', userId, {
        action,
        newStatus,
      });
      return { success: true };
    }
    if (!isDemoFallbackAllowed()) return { success: false, error: 'Kullanıcı durumu güncellenemedi.' };
  }

  const offender = DEMO_REPEAT_OFFENDERS.find((o) => o.user_id === userId);
  if (offender) {
    offender.compliance_status = newStatus as OffenderProfile['compliance_status'];
    if (action === 'clear') offender.mask_violation_count = 0;
  }
  await logAdminAction(adminId, `OFFENDER_ACTION_${action.toUpperCase()}`, 'profile', userId, {
    action,
    newStatus,
  });
  return { success: true };
}

type AntiLeakSettings = {
  contactRevealRule: 'teklif_kabul' | 'odeme' | 'talep_kredisi' | 'numara_goster_butonu';
  violationThreshold: number;
  softModeDailyLimit: number;
  forbiddenKeywords: string;
};

const DEFAULT_ANTI_LEAK: AntiLeakSettings = {
  contactRevealRule: 'teklif_kabul',
  violationThreshold: 3,
  softModeDailyLimit: 3,
  forbiddenKeywords:
    'whatsapp, wp, watsap, telegram, t.me, instagram, insta, özelden yaz, elden anlaşalım, komisyonsuz, telefonumu ara',
};

/** Canlı system_settings anahtarları: reveal_rule, violation_threshold, numara_goster_config, mask_patterns. */
export async function getAntiLeakSettings(): Promise<AntiLeakSettings> {
  if (!isSupabaseConfigured()) return DEFAULT_ANTI_LEAK;
  const supabase = createClient();
  const { data } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', ['reveal_rule', 'violation_threshold', 'numara_goster_config', 'mask_patterns']);
  const byKey = Object.fromEntries((data || []).map((r: any) => [r.key, r.value || {}]));
  return {
    contactRevealRule: byKey.reveal_rule?.default || DEFAULT_ANTI_LEAK.contactRevealRule,
    violationThreshold: Number(byKey.violation_threshold?.warn_max) || DEFAULT_ANTI_LEAK.violationThreshold,
    softModeDailyLimit: Number(byKey.numara_goster_config?.daily_limit) || DEFAULT_ANTI_LEAK.softModeDailyLimit,
    forbiddenKeywords: Array.isArray(byKey.mask_patterns?.keywords)
      ? byKey.mask_patterns.keywords.join(', ')
      : DEFAULT_ANTI_LEAK.forbiddenKeywords,
  };
}

export async function updateAntiLeakSettings(
  settings: AntiLeakSettings | { contactRevealRule: string; violationThreshold: number; softModeDailyLimit: number; forbiddenKeywords: string },
  adminId: string = 'admin-super-001'
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data: rows } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', ['reveal_rule', 'violation_threshold', 'numara_goster_config', 'mask_patterns']);
    const cur = Object.fromEntries((rows || []).map((r: any) => [r.key, r.value || {}]));
    const keywordList = settings.forbiddenKeywords.split(',').map((k) => k.trim()).filter(Boolean);

    const updates = [
      { key: 'reveal_rule', value: { ...cur.reveal_rule, default: settings.contactRevealRule } },
      { key: 'violation_threshold', value: { ...cur.violation_threshold, warn_max: Number(settings.violationThreshold) } },
      { key: 'numara_goster_config', value: { ...cur.numara_goster_config, daily_limit: Number(settings.softModeDailyLimit) } },
      { key: 'mask_patterns', value: { ...cur.mask_patterns, keywords: keywordList } },
    ];
    const { error } = await supabase.from('system_settings').upsert(updates);
    if (error) return { success: false, error: 'Ayarlar kaydedilemedi.' };
  }

  await logAdminAction(adminId, 'ANTI_LEAK_SETTINGS_UPDATED', 'setting', 'anti_leak_config', settings);
  return { success: true };
}
