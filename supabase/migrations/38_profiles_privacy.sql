-- ==============================================================================
-- ŞANTİYE GO – 38: PROFİL GİZLİLİĞİ VE DOĞRULAMA BAYRAKLARI KORUMASI
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Sorunlar:
--  1) "Public profiles are viewable by everyone" (USING true): giriş yapmamış ziyaretçi
--     dahil herkes TÜM kullanıcıların telefon numarasını, 2FA sırrını, bildirim
--     tercihlerini okuyabiliyordu (KVKK ihlali; platformun "numara gizleme" modelini de
--     tamamen boşa çıkarıyordu).
--  2) Kullanıcı kendi profilinde is_phone_verified / is_email_verified /
--     mask_violation_count alanlarını değiştirebiliyordu (OTP'siz "doğrulanmış" olma,
--     ihlal sayacını sıfırlama).
--
-- Çözüm:
--  - Profil satırını yalnızca sahibi ve yöneticiler okur.
--  - Karşı tarafın görünen adı için get_profile_names() (yalnızca oturum açmış kullanıcı,
--    yalnızca ad + rol) ve değerlendirme sahipleri için maskeli ad döndüren
--    get_reviewer_names() RPC'leri.
--  - Kayıtta telefon mükerrerlik kontrolü için is_phone_registered() RPC'si.
--  - Doğrulama / ihlal alanları yalnızca sunucu (service_role) tarafından değiştirilebilir;
--    e-posta doğrulaması auth.users.email_confirmed_at ile tutarlıysa kabul edilir.
-- ==============================================================================

-- 1) SATIR GÖRÜNÜRLÜĞÜ
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Yöneticiler uyumluluk işlemleri (uyarı / askıya alma / sayaç sıfırlama) için günceller.
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2) GÖRÜNEN AD RPC'LERİ
create or replace function public.get_profile_names(p_ids uuid[])
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name::text, p.role::text
    from public.profiles p
   where auth.uid() is not null
     and p.id = any (p_ids)
   limit 500;
$$;
revoke all on function public.get_profile_names(uuid[]) from public, anon;
grant execute on function public.get_profile_names(uuid[]) to authenticated, service_role;

-- Değerlendirme yazan alıcıların maskeli adı ("Ahmet Y."): yalnızca gerçekten
-- değerlendirme yazmış kullanıcılar için döner.
create or replace function public.get_reviewer_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         coalesce(
           nullif(
             split_part(trim(p.full_name), ' ', 1) ||
             case when position(' ' in trim(coalesce(p.full_name, ''))) > 0
                  then ' ' || upper(left(split_part(trim(p.full_name), ' ', 2), 1)) || '.'
                  else '' end,
             ''),
           'Doğrulanmış Alıcı')
    from public.profiles p
   where p.id = any (p_ids)
     and exists (select 1 from public.reviews r where r.buyer_id = p.id)
   limit 500;
$$;
revoke all on function public.get_reviewer_names(uuid[]) from public;
grant execute on function public.get_reviewer_names(uuid[]) to anon, authenticated, service_role;

create or replace function public.is_phone_registered(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
     where p_phone is not null and length(p_phone) >= 10 and phone = p_phone
  );
$$;
revoke all on function public.is_phone_registered(text) from public;
grant execute on function public.is_phone_registered(text) to anon, authenticated, service_role;

-- 3) DOĞRULAMA / İHLAL ALANLARI KORUMASI (mevcut rol korumasına eklenir)
create or replace function public.profiles_protect_role() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_priv  boolean := coalesce(auth.role(), '') = 'service_role'
                     or session_user in ('postgres', 'supabase_admin');
  v_super boolean := false;
  v_admin boolean := false;
  v_email_confirmed boolean := false;
begin
  if v_priv then
    return new;
  end if;

  select exists (select 1 from auth.users u where u.id = new.id and u.email_confirmed_at is not null)
    into v_email_confirmed;

  if tg_op = 'INSERT' then
    if new.role::text in ('admin', 'super_admin') then
      new.role := 'buyer'::public.user_role;
    end if;
    new.is_phone_verified := false;
    new.phone_verified_at := null;
    new.is_email_verified := coalesce(new.is_email_verified, false) and v_email_confirmed;
    if not new.is_email_verified then new.email_verified_at := null; end if;
    new.mask_violation_count := 0;
    new.two_factor_enabled := false;
    new.two_factor_secret := null;
    return new;
  end if;

  v_admin := public.is_admin();

  if new.role is distinct from old.role and new.role::text in ('admin', 'super_admin') then
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'super_admin')
      into v_super;
    if not v_super then
      raise exception 'Yönetici rolü yalnızca süper yönetici tarafından verilebilir.' using errcode = '42501';
    end if;
  end if;

  -- Telefon doğrulaması yalnızca sunucudaki OTP akışıyla verilir; numara değişirse düşer.
  if new.is_phone_verified is distinct from old.is_phone_verified
     or new.phone_verified_at is distinct from old.phone_verified_at then
    new.is_phone_verified := old.is_phone_verified;
    new.phone_verified_at := old.phone_verified_at;
  end if;
  if new.phone is distinct from old.phone then
    new.is_phone_verified := false;
    new.phone_verified_at := null;
  end if;

  -- E-posta doğrulaması yalnızca auth tarafında onaylıysa true olabilir.
  if new.is_email_verified is distinct from old.is_email_verified then
    if new.is_email_verified and not v_email_confirmed then
      new.is_email_verified := old.is_email_verified;
      new.email_verified_at := old.email_verified_at;
    end if;
  end if;

  -- İhlal sayacı ve 2FA alanları: yalnızca yönetici (sayaç) / sunucu.
  if not v_admin then
    new.mask_violation_count := old.mask_violation_count;
    new.two_factor_secret := old.two_factor_secret;
    new.two_factor_enabled := old.two_factor_enabled;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update on public.profiles
  for each row execute function public.profiles_protect_role();

-- 4) KAYIT TETİKLEYİCİSİ: YÖNETİCİ YÜKSELTME AÇIĞI
--    Eski sürüm kayıt metadata'sındaki role='super_admin' değerini kabul edip kullanıcıyı
--    admin_users tablosuna AKTİF SÜPER YÖNETİCİ olarak ekliyordu (profil rolü kırpılsa
--    bile is_admin() true dönüyordu). Kayıtta yalnızca buyer / company kabul edilir;
--    yöneticiler yalnızca SQL Editor / service_role ile atanır.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_raw_role text;
    v_role public.user_role;
    v_full_name text;
    v_phone text;
    v_company_name text;
    v_tax_number text;
    v_tax_office text;
    v_city_id int;
    v_district_id int;
    v_new_company_id uuid;
begin
    v_raw_role := coalesce(new.raw_user_meta_data->>'role', 'buyer');
    if v_raw_role not in ('buyer', 'company') then
        v_raw_role := 'buyer';
    end if;
    v_role := v_raw_role::public.user_role;

    v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
    v_phone := new.raw_user_meta_data->>'phone';
    v_company_name := new.raw_user_meta_data->>'company_name';
    v_tax_number := new.raw_user_meta_data->>'tax_number';
    v_tax_office := new.raw_user_meta_data->>'tax_office';

    if v_tax_number is not null and length(regexp_replace(v_tax_number, '\D', '', 'g')) = 10 then
        v_tax_number := regexp_replace(v_tax_number, '\D', '', 'g');
    else
        v_tax_number := null;
    end if;

    begin
        v_city_id := (new.raw_user_meta_data->>'city_id')::int;
    exception when others then
        v_city_id := null;
    end;

    begin
        v_district_id := (new.raw_user_meta_data->>'district_id')::int;
    exception when others then
        v_district_id := null;
    end;

    insert into public.profiles (
        id, role, full_name, phone, kvkk_accepted_at, kvkk_version,
        is_email_verified, is_phone_verified
    ) values (
        new.id, v_role, v_full_name, v_phone, now(), 'v1.0',
        (new.email_confirmed_at is not null), false
    )
    on conflict (id) do update
    set
        role = case
            when public.profiles.role in ('admin', 'super_admin') then public.profiles.role
            else excluded.role
        end,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        phone = coalesce(public.profiles.phone, excluded.phone),
        is_email_verified = case when new.email_confirmed_at is not null then true
                                 else public.profiles.is_email_verified end;

    if v_role = 'company' then
        insert into public.companies (
            user_id, name, tax_number, tax_office, phone, city_id, district_id,
            is_verified, is_demo, onboarding_step, accept_online_payments
        ) values (
            new.id,
            coalesce(v_company_name, v_full_name, 'Firma Hesabı'),
            v_tax_number, v_tax_office, coalesce(v_phone, ''), v_city_id, v_district_id,
            false, false, 'pending_documents', false
        )
        on conflict (user_id) do update
        set
            name = coalesce(excluded.name, public.companies.name),
            tax_number = coalesce(excluded.tax_number, public.companies.tax_number),
            tax_office = coalesce(excluded.tax_office, public.companies.tax_office)
        returning id into v_new_company_id;

        if v_new_company_id is not null then
            insert into public.company_subscriptions (
                company_id, plan_id, billing_cycle, status, current_period_start, current_period_end
            ) values (
                v_new_company_id, 'free', 'monthly', 'active', now(), now() + interval '10 years'
            )
            on conflict do nothing;
        end if;
    end if;

    return new;
end;
$$;
