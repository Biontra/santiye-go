-- ==============================================================================
-- ŞANTİYE GO – 40: İLETİŞİM MASKELEME LOGLARI POLİTİKALARI
-- compliance_mask_logs'ta RLS açık ama politika yoktu: yönetim panelindeki güvenlik
-- ekranı hiçbir kaydı göremiyor (yerine sahte istatistik gösteriyordu), kullanıcı da
-- "yanlış alarm" itirazı yapamıyordu. Kayıtları veritabanı fonksiyonları (service
-- definer) ekler; istemci INSERT yetkisi verilmez.
-- ==============================================================================

drop policy if exists compliance_logs_read on public.compliance_mask_logs;
create policy compliance_logs_read on public.compliance_mask_logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists compliance_logs_admin_update on public.compliance_mask_logs;
create policy compliance_logs_admin_update on public.compliance_mask_logs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
