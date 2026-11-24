/**
 * Çalışma zamanı yapılandırması: Supabase bağlı mı, demo verisine düşülebilir mi?
 *
 * Kural: Gerçek bir Supabase projesine bağlıyken ÜRETİMDE asla sahte (demo / bellek içi)
 * veri gösterilmez ve yazma işlemleri sahte "başarılı" sonucu döndürmez. Veritabanı hata
 * verirse kullanıcıya hata / boş liste gösterilir.
 *
 * Demo verisi yalnızca:
 *  - Supabase hiç yapılandırılmamışsa (yerel demo modu), veya
 *  - Geliştirme ortamında NEXT_PUBLIC_SHOW_DEMO_DATA=true iken kullanılır.
 */

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && key && !url.includes('placeholder'));
}

export function isDemoFallbackAllowed(): boolean {
  if (!isSupabaseConfigured()) return true;
  return process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production';
}

/** Demo'ya düşülemediğinde kullanıcıya gösterilecek standart hata metni. */
export const SERVICE_UNAVAILABLE_MESSAGE =
  'İşlem şu anda gerçekleştirilemedi. Lütfen daha sonra tekrar deneyin.';
