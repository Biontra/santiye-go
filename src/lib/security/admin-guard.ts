/**
 * Admin yetkisi kuralları. Rol HER ZAMAN veritabanındaki profiles.role alanından
 * okunur; kullanıcının kendi değiştirebildiği user_metadata.role'a güvenilmez.
 */

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export type AdminRouteDecision = 'login' | 'forbidden' | 'allow';

/** Rolü bilinmeyen (boş) girişli kullanıcı içeri alınmaz. */
export function adminRouteDecision(
  isAuthenticated: boolean,
  profileRole: string | null | undefined
): AdminRouteDecision {
  if (!isAuthenticated) return 'login';
  return isAdminRole(profileRole) ? 'allow' : 'forbidden';
}
