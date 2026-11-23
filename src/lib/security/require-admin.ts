import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isAdminRole } from '@/lib/security/admin-guard';

export type RequireAdminResult =
  | { ok: true; adminId: string; serviceClient: SupabaseClient }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Sunucu uçları için yönetici kontrolü.
 * Kimlik oturum çerezinden, rol veritabanındaki profilden okunur.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: 'Giriş yapılmamış.' };
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!isAdminRole(profile?.role)) {
    return { ok: false, status: 403, error: 'Bu işlem yalnız yöneticiler içindir.' };
  }

  return { ok: true, adminId: user.id, serviceClient };
}
