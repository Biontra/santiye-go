-- ==============================================================================
-- ŞANTİYE GO – 31: GÜVENLİK SERTLEŞTİRME
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- 1) Rol yükseltme açığı: kayıt metadata'sı / profil UPDATE'i ile admin olunabiliyordu.
-- 2) Firma güven sütunları (is_verified, verification_status...) sahibi tarafından
--    değiştirilebiliyordu (kendini "doğrulanmış firma" yapma).
-- 3) 17_escrow_payment_guarantee.sql içindeki eski SECURITY DEFINER escrow RPC'leri
--    anon dahil herkese açıktı (ödemeyi "ödendi" yapma, parayı serbest bırakma, iade).
-- 4) request_phone_otp / verify_phone_otp anon'a açıktı (kendi kod hash'ini kaydedip
--    herhangi bir telefonu "doğrulayabiliyordu").
-- 5) RLS'siz kalan tablolar (welcome_credit_grants: vergi no + telefon anon'a açıktı;
--    commission_rules / membership_plans / ad_products: herkes yazabiliyordu).
--
-- Not: Uygulama bu eski escrow RPC'lerini çağırmıyor (grep ile doğrulandı); yeni akış
-- 17_escrow_marketplace_settlements / 19 / 20'deki fonksiyonları kullanıyor.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1) PROFILES.ROLE KORUMASI
--    Ayrıcalıklı çağıran: service_role JWT'si veya SQL Editor / migration (postgres,
--    supabase_admin). GoTrue (supabase_auth_admin) KASITLI olarak ayrıcalıklı DEĞİLDİR:
--    kayıt sırasındaki user_metadata.role kullanıcı kontrolündedir.
-- ------------------------------------------------------------------------------
create or replace function public.profiles_protect_role() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_priv  boolean := coalesce(auth.role(), '') = 'service_role'
                     or session_user in ('postgres', 'supabase_admin');
  v_super boolean := false;
begin
  if v_priv then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role::text in ('admin', 'super_admin') then
      new.role := 'buyer'::public.user_role;
    end if;
    return new;
  end if;

  if new.role is distinct from old.role and new.role::text in ('admin', 'super_admin') then
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'super_admin')
      into v_super;
    if not v_super then
      raise exception 'Yönetici rolü yalnızca süper yönetici tarafından verilebilir.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_protect_role() from public, anon, authenticated;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before insert or update on public.profiles
  for each row execute function public.profiles_protect_role();

-- ------------------------------------------------------------------------------
-- 2) COMPANIES GÜVEN SÜTUNLARI KORUMASI
--    Yönetici (is_admin) ve ayrıcalıklı çağıranlar serbest; firma sahibi yalnızca
--    kendi bilgilerini değiştirebilir. Sütun adları jsonb ile okunur: şemada olmayan
--    bir sütun hata üretmez.
-- ------------------------------------------------------------------------------
create or replace function public.companies_protect_trust_columns() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_priv boolean := coalesce(auth.role(), '') = 'service_role'
                    or session_user in ('postgres', 'supabase_admin');
  v_keys text[] := array['is_verified', 'verification_status', 'verification_notes',
                         'verified_at', 'verified_by', 'is_demo'];
  v_new  jsonb;
  v_old  jsonb;
  k      text;
begin
  if v_priv or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object(
      'is_verified', false,
      'verification_status', 'unverified',
      'verification_notes', null,
      'verified_at', null,
      'verified_by', null,
      'is_demo', false
    ));
    return new;
  end if;

  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach k in array v_keys loop
    if (v_new -> k) is distinct from (v_old -> k) then
      raise exception 'Firma doğrulama alanları yalnızca yönetici tarafından değiştirilebilir (%).', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.companies_protect_trust_columns() from public, anon, authenticated;
drop trigger if exists companies_protect_trust_columns on public.companies;
create trigger companies_protect_trust_columns before insert or update on public.companies
  for each row execute function public.companies_protect_trust_columns();

-- ------------------------------------------------------------------------------
-- 3) ESKİ ESCROW RPC'LERİ + OTP RPC'LERİ: yalnızca service_role
--    İmzaya bağımlı olmamak için pg_proc üzerinden döngü; fonksiyon yoksa atlanır.
--    SECURITY DEFINER fonksiyonlara search_path sabitlenir (arama yolu kaçırma).
-- ------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'confirm_escrow_payment_paid',
         'buyer_confirm_and_release_escrow',
         'open_escrow_dispute',
         'cron_auto_release_expired_escrow',
         'refund_escrow_payment',
         'request_phone_otp',
         'verify_phone_otp'
       ])
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$$;

-- ------------------------------------------------------------------------------
-- 4) RLS'SİZ TABLOLAR
-- ------------------------------------------------------------------------------
-- 4.1 Yalnızca sunucu/RPC erişimi: politika yok = istemciye kapalı (service_role ve
--     SECURITY DEFINER sahibi RLS'yi atlar).
alter table if exists public.welcome_credit_grants       enable row level security;
alter table if exists public.message_email_notifications enable row level security;
revoke all on public.welcome_credit_grants       from anon, authenticated;
revoke all on public.message_email_notifications from anon, authenticated;

-- 4.2 Herkese okunur katalog, yalnızca yönetici yazar
do $$
declare
  t text;
begin
  foreach t in array array['commission_rules', 'membership_plans', 'ad_products'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_read_all', t);
      execute format('create policy %I on public.%I for select using (true)', t || '_read_all', t);
      execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        t || '_admin_write', t);
    end if;
  end loop;
end
$$;

-- 4.3 Push abonelikleri: yalnızca sahibi
do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    alter table public.push_subscriptions enable row level security;
    drop policy if exists push_subscriptions_owner on public.push_subscriptions;
    create policy push_subscriptions_owner on public.push_subscriptions
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end
$$;
