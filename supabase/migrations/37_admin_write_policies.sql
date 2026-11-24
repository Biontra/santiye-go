-- ==============================================================================
-- ŞANTİYE GO – 37: YÖNETİCİ YAZMA POLİTİKALARI
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Yönetim panelindeki kategori ve platform ayarı ekranları artık gerçek tablolara yazıyor.
--  - categories: hiç yazma politikası yoktu (yalnızca okuma).
--  - platform_settings: yalnızca admin_users.super_admin yazabiliyordu; profiles.role
--    tabanlı yöneticiler (is_admin()) de yazabilsin.
-- ==============================================================================

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists platform_settings_admin_write on public.platform_settings;
create policy platform_settings_admin_write on public.platform_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Denetim logu: yönetici yalnızca KENDİ adına kayıt ekleyebilir (başkası adına log
-- düşülemez); okuma is_admin() ile tüm yöneticilere açık. Kayıtlar değiştirilemez/silinemez.
drop policy if exists admin_audit_logs_insert on public.admin_audit_logs;
create policy admin_audit_logs_insert on public.admin_audit_logs
  for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());

drop policy if exists admin_audit_logs_read on public.admin_audit_logs;
create policy admin_audit_logs_read on public.admin_audit_logs
  for select to authenticated
  using (public.is_admin());
