-- ==============================================================================
-- ŞANTİYE GO – 34: CANLI ŞEMA TELAFİSİ VE GÜVENLİK KAPATMALARI
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Canlı veritabanı ile kod karşılaştırıldığında (2026-11-24) bulunan sorunlar:
--
-- GÜVENLİK
--  1) system_settings: politikaları var ama RLS KAPALIYDI -> anon anahtarıyla herkes
--     iletişim maskeleme / kredi / mesaj limiti ayarlarını değiştirebiliyordu.
--  2) payments (eski tablo): RLS kapalıydı -> herkes okuyup yazabiliyordu.
--  3) admin_resolve_escrow_dispute: SECURITY DEFINER, p_admin_id parametresine güveniyor
--     ve anon dahil herkese açıktı -> yönetici UUID'sini bilen herkes itirazı
--     "firmaya aktar / iade et" diye kapatabiliyordu. Artık yalnızca service_role.
--  4) Sabit search_path'i olmayan fonksiyonlara search_path atanır.
--
-- KODUN KULLANDIĞI AMA CANLIDA OLMAYAN NESNELER
--  5) listing_availability: RLS açık ama hiç politika yok -> firma takvimi okunamıyor /
--     yazılamıyordu.
--  6) phone_reveal_daily_logs (11), contract_templates + contracts (13),
--     admin_2fa_attempts + check_and_record_admin_2fa (20), request_phone_otp (09).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1-2) RLS'SİZ TABLOLAR
-- ------------------------------------------------------------------------------
alter table if exists public.system_settings enable row level security;

-- Yazma politikası yalnızca super_admin (admin_users) idi; profiles.role tabanlı
-- yöneticiler de (is_admin()) güncelleyebilsin. Okuma herkese açık kalır.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    drop policy if exists system_settings_admin_write on public.system_settings;
    create policy system_settings_admin_write on public.system_settings
      for all to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end
$$;

-- Eski "payments" tablosunu uygulama kullanmıyor (payment_transactions kullanılıyor):
-- istemciye tamamen kapatılır, yalnızca service_role erişir.
alter table if exists public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3) YALNIZCA SUNUCUNUN ÇAĞIRMASI GEREKEN SECURITY DEFINER FONKSİYONLAR
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
       and p.proname = 'admin_resolve_escrow_dispute'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$$;

-- ------------------------------------------------------------------------------
-- 5) LISTING_AVAILABILITY (firma müsaitlik takvimi)
-- ------------------------------------------------------------------------------
alter table if exists public.listing_availability enable row level security;

drop policy if exists listing_availability_read_all on public.listing_availability;
create policy listing_availability_read_all on public.listing_availability
  for select using (true);

drop policy if exists listing_availability_owner_write on public.listing_availability;
create policy listing_availability_owner_write on public.listing_availability
  for all to authenticated
  using (
    exists (
      select 1 from public.listings l
        join public.companies c on c.id = l.company_id
       where l.id = listing_availability.listing_id
         and c.user_id = auth.uid()
    )
    or public.is_admin()
  )
  with check (
    exists (
      select 1 from public.listings l
        join public.companies c on c.id = l.company_id
       where l.id = listing_availability.listing_id
         and c.user_id = auth.uid()
    )
    or public.is_admin()
  );

-- ------------------------------------------------------------------------------
-- 6a) PHONE_REVEAL_DAILY_LOGS (11)
-- ------------------------------------------------------------------------------
create table if not exists public.phone_reveal_daily_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    listing_id uuid not null references public.listings(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    created_at timestamptz default now()
);
create index if not exists idx_phone_reveal_user_daily
  on public.phone_reveal_daily_logs(user_id, created_at desc);

alter table public.phone_reveal_daily_logs enable row level security;
drop policy if exists "Users manage own phone reveal logs" on public.phone_reveal_daily_logs;
drop policy if exists phone_reveal_logs_own_read on public.phone_reveal_daily_logs;
drop policy if exists phone_reveal_logs_own_insert on public.phone_reveal_daily_logs;
-- Kendi kayıtlarını görür ve ekler; silemez/değiştiremez (günlük sınırı sıfırlayamaz).
create policy phone_reveal_logs_own_read on public.phone_reveal_daily_logs
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy phone_reveal_logs_own_insert on public.phone_reveal_daily_logs
  for insert to authenticated with check (user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 6b) SÖZLEŞME ŞABLONLARI VE SÖZLEŞMELER (13)
-- ------------------------------------------------------------------------------
create table if not exists public.contract_templates (
    id uuid primary key default gen_random_uuid(),
    template_type varchar(50) not null,
    version int not null default 1,
    title varchar(200) not null,
    standard_terms text not null,
    is_active boolean default true,
    created_by uuid references public.profiles(id),
    created_at timestamptz default now(),
    unique (template_type, version)
);
create index if not exists idx_contract_templates_type_v
  on public.contract_templates(template_type, version desc);

create table if not exists public.contracts (
    id uuid primary key default gen_random_uuid(),
    contract_number varchar(50) unique not null,
    contract_type varchar(50) not null,
    booking_id uuid references public.bookings(id) on delete set null,
    quote_id uuid references public.quotes(id) on delete set null,
    company_id uuid not null references public.companies(id) on delete cascade,
    buyer_id uuid not null references public.profiles(id) on delete cascade,
    template_id uuid references public.contract_templates(id),
    template_version int not null default 1,
    data_snapshot jsonb not null,
    pdf_sha256 varchar(64) not null,
    pdf_storage_path text,
    status varchar(30) default 'pending_approval',
    company_approved_at timestamptz,
    buyer_approved_at timestamptz,
    company_approved_ip varchar(45),
    buyer_approved_ip varchar(45),
    revision_notes text,
    signed_copy_url text,
    signed_uploaded_by uuid references public.profiles(id),
    signed_uploaded_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
create index if not exists idx_contracts_buyer   on public.contracts(buyer_id);
create index if not exists idx_contracts_company on public.contracts(company_id);
create index if not exists idx_contracts_status  on public.contracts(status);
create index if not exists idx_contracts_booking on public.contracts(booking_id);
create index if not exists idx_contracts_quote   on public.contracts(quote_id);

alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;

drop policy if exists contract_templates_read_all on public.contract_templates;
create policy contract_templates_read_all on public.contract_templates
  for select using (is_active = true or public.is_admin());
drop policy if exists contract_templates_admin_write on public.contract_templates;
create policy contract_templates_admin_write on public.contract_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists contracts_parties_read on public.contracts;
create policy contracts_parties_read on public.contracts
  for select to authenticated using (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists contracts_parties_insert on public.contracts;
create policy contracts_parties_insert on public.contracts
  for insert to authenticated with check (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists contracts_parties_update on public.contracts;
create policy contracts_parties_update on public.contracts
  for update to authenticated
  using (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  )
  with check (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  );

-- Taraflar yalnızca onay / revizyon / imzalı kopya alanlarını değiştirebilir;
-- sözleşmenin içeriği (snapshot, PDF özeti, taraflar) dondurulmuştur.
create or replace function public.contracts_protect_frozen_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if new.contract_number   is distinct from old.contract_number
     or new.contract_type  is distinct from old.contract_type
     or new.booking_id     is distinct from old.booking_id
     or new.quote_id       is distinct from old.quote_id
     or new.company_id     is distinct from old.company_id
     or new.buyer_id       is distinct from old.buyer_id
     or new.template_id    is distinct from old.template_id
     or new.template_version is distinct from old.template_version
     or new.data_snapshot  is distinct from old.data_snapshot
     or new.pdf_sha256     is distinct from old.pdf_sha256
     or new.created_at     is distinct from old.created_at then
    raise exception 'Sözleşme içeriği dondurulmuştur; yalnızca onay/revizyon alanları güncellenebilir.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists contracts_protect_frozen_columns on public.contracts;
create trigger contracts_protect_frozen_columns
  before update on public.contracts
  for each row execute function public.contracts_protect_frozen_columns();

insert into public.contract_templates (template_type, version, title, standard_terms)
values
  ('rental', 1, 'İş Makineleri ve Ekipman Kiralama Sözleşmesi', $$1. TARAFLAR: İşbu sözleşme ŞantiyeGO platformu üzerinden anlaşan Kiralayan (Firma) ile Kiracı (Alıcı) arasında akdedilmiştir.
2. SÖZLEŞMENİN KONUSU: İlanda ve sipariş dökümünde dinamik özellikleri belirtilen ekipmanın, belirtilen süre ve şantiye adresinde kiralanmasıdır.
3. PLATFORMUN KONUMU: ŞantiyeGO (Platform), 6563 sayılı Kanun kapsamında Aracı Hizmet Sağlayıcıdır; sözleşmenin tarafı, garantörü veya kefili değildir.
4. TESLİM VE İADE: Ekipman eksiksiz ve çalışır vaziyette tutanakla teslim edilir ve iade alınır.
5. KULLANIM VE BAKIM: Kiracı, ekipmanı amacına uygun, iş güvenliği mevzuatına riayet ederek kullanmakla yükümlüdür.
6. HASAR VE KAYIP: Kiracının kusurundan doğan hasarlar Kiracı tarafından tazmin edilir.
7. İPTAL VE FESİH: İptal ve cayma hallerinde ŞantiyeGO İptal ve İade Koşulları geçerlidir.
8. MÜCBİR SEBEPLER: Tarafların kontrolü dışındaki doğal afet, yangın, salgın vb. durumlarda yükümlülükler askıya alınır.
9. GİZLİLİK VE KVKK: Taraflar paylaşılan bilgileri işbu sözleşme haricinde kullanamaz.
10. UYUŞMAZLIKLARIN ÇÖZÜMÜ: Uyuşmazlıklarda yetkili icra daireleri ve mahkemeler hukukçular tarafından belirlenecektir.
NOT: İşbu metin TASLAK niteliğinde olup hukuki incelemeden geçirilmelidir.$$),
  ('service', 1, 'Ağır Nakliye ve İnşaat Hizmeti Sözleşmesi', $$1. TARAFLAR: İşbu sözleşme ŞantiyeGO platformu üzerinden anlaşan Hizmet Sağlayıcı (Firma) ile Hizmet Alan (Alıcı) arasında akdedilmiştir.
2. SÖZLEŞMENİN KONUSU: İlanda belirtilen nakliye/hizmetin, belirtilen güzergah veya şantiye sahasında ifa edilmesidir.
3. PLATFORMUN KONUMU: ŞantiyeGO Aracı Hizmet Sağlayıcıdır; hizmetin doğrudan ifacısı veya tarafı değildir.
4. YÜK VE SAHA SORUMLULUĞU: Hizmet alan, yükün niteliği ve yol/saha koşulları hakkında doğru bilgi vermekle yükümlüdür.
5. İFA VE GECİKME: Taşıma ve hizmet süresi mücbir sebepler saklı kalmak üzere kararlaştırılan tarihlerde tamamlanır.
6. İPTAL KOŞULLARI: ŞantiyeGO hizmet iptal politikası geçerlidir.
7. GİZLİLİK: Ticari bilgiler gizli tutulacaktır.
8. UYUŞMAZLIKLAR: Yetkili mahkeme alanı taraflarca belirlenecektir.
NOT: İşbu metin TASLAK niteliğinde olup hukuki incelemeden geçirilmelidir.$$)
on conflict (template_type, version) do nothing;

-- ------------------------------------------------------------------------------
-- 6c) YÖNETİCİ 2FA DENEME KAYDI (20) – yalnızca service_role
-- ------------------------------------------------------------------------------
create table if not exists public.admin_2fa_attempts (
    id uuid primary key default gen_random_uuid(),
    admin_id uuid not null references public.profiles(id) on delete cascade,
    code_hash varchar(64) not null,
    success boolean not null default false,
    ip_address varchar(45),
    details jsonb,
    created_at timestamptz default now()
);
create index if not exists idx_admin_2fa_attempts_rate
  on public.admin_2fa_attempts(admin_id, created_at desc);
create index if not exists idx_admin_2fa_attempts_replay
  on public.admin_2fa_attempts(admin_id, code_hash, created_at desc);

alter table public.admin_2fa_attempts enable row level security;
revoke all on public.admin_2fa_attempts from public, anon, authenticated;
grant all on public.admin_2fa_attempts to service_role;

create or replace function public.check_and_record_admin_2fa(
    p_admin_id uuid,
    p_code_hash varchar(64),
    p_success boolean,
    p_ip_address varchar(45) default null,
    p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_recent_failures int;
    v_replay_exists boolean;
begin
    select count(*) into v_recent_failures
      from public.admin_2fa_attempts
     where admin_id = p_admin_id
       and success = false
       and created_at >= now() - interval '15 minutes';

    if v_recent_failures >= 5 then
        insert into public.admin_2fa_attempts (admin_id, code_hash, success, ip_address, details)
        values (p_admin_id, p_code_hash, false, p_ip_address,
                jsonb_build_object('blocked_reason', 'rate_limit_exceeded'));
        return jsonb_build_object(
            'allowed', false,
            'error_code', 'ADMIN_2FA_LOCKED_OUT',
            'error', 'Güvenlik Uyarısı: Çok fazla hatalı 2FA kodu girildi. Hesabınız 15 dakika boyunca kilitlenmiştir.'
        );
    end if;

    if p_success then
        select exists (
            select 1 from public.admin_2fa_attempts
             where admin_id = p_admin_id
               and code_hash = p_code_hash
               and success = true
               and created_at >= now() - interval '10 minutes'
        ) into v_replay_exists;

        if v_replay_exists then
            insert into public.admin_2fa_attempts (admin_id, code_hash, success, ip_address, details)
            values (p_admin_id, p_code_hash, false, p_ip_address,
                    jsonb_build_object('blocked_reason', 'replay_attack_detected'));
            return jsonb_build_object(
                'allowed', false,
                'error_code', 'ADMIN_2FA_CODE_REUSED',
                'error', 'Bu 2FA onay kodu yakın zamanda zaten kullanılmış. Lütfen yeni bir kod üretilmesini bekleyiniz.'
            );
        end if;
    end if;

    insert into public.admin_2fa_attempts (admin_id, code_hash, success, ip_address, details)
    values (p_admin_id, p_code_hash, p_success, p_ip_address, p_details);

    return jsonb_build_object(
        'allowed', p_success,
        'remaining_attempts', greatest(0, 5 - v_recent_failures - case when p_success then 0 else 1 end)
    );
end;
$$;

revoke all on function public.check_and_record_admin_2fa(uuid, varchar, boolean, varchar, jsonb)
  from public, anon, authenticated;
grant execute on function public.check_and_record_admin_2fa(uuid, varchar, boolean, varchar, jsonb)
  to service_role;

-- ------------------------------------------------------------------------------
-- 6d) TELEFON OTP KAYDI (09) – yalnızca service_role (31'deki kararla aynı)
-- ------------------------------------------------------------------------------
create or replace function public.request_phone_otp(
    p_phone varchar,
    p_code_hash varchar
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_last record;
    v_now timestamptz := now();
begin
    select * into v_last
      from public.phone_verifications
     where phone = p_phone
     order by created_at desc
     limit 1;

    if found and v_last.resend_after > v_now then
        return jsonb_build_object(
            'success', false,
            'error', 'RATE_LIMIT_COOLDOWN',
            'remaining_seconds', extract(epoch from (v_last.resend_after - v_now))::int
        );
    end if;

    insert into public.phone_verifications (
        phone, code_hash, attempts, max_attempts, expires_at, resend_after
    ) values (
        p_phone, p_code_hash, 0, 3, v_now + interval '5 minutes', v_now + interval '60 seconds'
    );

    return jsonb_build_object(
        'success', true,
        'expires_in_seconds', 300,
        'resend_after_seconds', 60
    );
end;
$$;

revoke all on function public.request_phone_otp(varchar, varchar) from public, anon, authenticated;
grant execute on function public.request_phone_otp(varchar, varchar) to service_role;

-- ------------------------------------------------------------------------------
-- 4) SABİT SEARCH_PATH (eklentiye ait olmayan public fonksiyonlar)
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
       and p.prokind = 'f'
       and p.proconfig is null
       and p.proname in (
         'search_listings_by_distance', 'count_listings_by_radii', 'check_booking_overlap',
         'get_company_weighted_rating', 'prevent_credit_ledger_mutation', 'spend_quote_credit',
         'admin_resolve_escrow_dispute', 'search_listings_advanced',
         'get_public_listing_by_id_or_slug', 'handle_new_user', 'mask_contact_info', 'trip_distance'
       )
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end
$$;
