-- ==============================================================================
-- ŞANTİYE GO – 39: TEKLİF AKIŞI (TALEP -> DAĞITIM -> TEKLİF -> KABUL)
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Sorunlar (canlıda quote_requests tablosu hiç kayıt almamıştı):
--  1) Uygulama quote_requests'e olmayan lat/lng sütunlarını yazıyordu -> her talep
--     yalnızca tarayıcının localStorage'ında kalıyordu.
--  2) Talepler firmalara dağıtılmıyordu (quote_request_recipients'a yalnızca keşif/BOQ
--     akışı yazıyordu) -> firmalar talep göremiyordu.
--  3) Teklif "quote-<zaman>" gibi UUID olmayan kimlikle yazılıyordu -> hiçbir teklif
--     kaydedilmiyordu; ayrıca firma, kendisine gönderilmeyen taleplere de teklif verebilirdi.
--  4) Alıcının teklifi kabul/ret etmesine izin veren politika yoktu.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1) TALEP KORUMASI
-- ------------------------------------------------------------------------------
create or replace function public.quote_requests_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  -- santiye.internal: aynı işlemdeki güvenilir tetikleyicilerin (quotes_after_change) bayrağı;
  -- PostgREST istemcileri set_config çağıramaz.
  v_priv boolean := coalesce(auth.role(), '') = 'service_role'
                    or session_user in ('postgres', 'supabase_admin')
                    or current_setting('santiye.internal', true) = 'on';
begin
  if v_priv then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_uid is null or new.buyer_id is distinct from v_uid then
      raise exception 'Talep yalnızca oturumdaki kullanıcı adına oluşturulabilir.' using errcode = '42501';
    end if;
    if (select count(*) from public.quote_requests q
         where q.buyer_id = v_uid and q.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'Kısa sürede çok fazla teklif talebi gönderdiniz. Lütfen daha sonra tekrar deneyin.'
        using errcode = 'check_violation';
    end if;
    if new.start_date < current_date - 1 then
      raise exception 'Başlangıç tarihi geçmişte olamaz.' using errcode = '22023';
    end if;
    if new.end_date is not null and new.end_date < new.start_date then
      raise exception 'Bitiş tarihi başlangıçtan önce olamaz.' using errcode = '22023';
    end if;
    new.status := 'sent';
    new.is_demo := false;
    new.max_recipients := least(greatest(coalesce(new.max_recipients, 10), 1), 20);
    new.search_radius_km := least(greatest(coalesce(new.search_radius_km, 50), 1), 500);
    new.quantity := least(greatest(coalesce(new.quantity, 1), 1), 100000);
    new.expires_at := now() + interval '7 days';
    new.used_quote_slots := 0;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE: içerik değiştirilemez; kullanılan slot sayacı yalnızca artabilir
  -- (spend_quote_request_credit firma oturumunda bu sayacı artırır); alıcı yalnızca iptal eder.
  if new.buyer_id is distinct from old.buyer_id
     or new.request_type is distinct from old.request_type
     or new.listing_id is distinct from old.listing_id
     or new.category_id is distinct from old.category_id
     or coalesce(new.used_quote_slots, 0) < coalesce(old.used_quote_slots, 0)
     or new.max_quote_slots is distinct from old.max_quote_slots
     or new.credit_cost is distinct from old.credit_cost
     or new.is_demo is distinct from old.is_demo
     or new.created_at is distinct from old.created_at then
    raise exception 'Talebin temel bilgileri değiştirilemez.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and (new.status not in ('rejected', 'expired') or old.buyer_id is distinct from v_uid) then
    raise exception 'Talep durumu yalnızca teklif kabul edilerek ya da iptal edilerek değişir.'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.quote_requests_guard() from public, anon, authenticated;

drop trigger if exists quote_requests_guard on public.quote_requests;
create trigger quote_requests_guard
  before insert or update on public.quote_requests
  for each row execute function public.quote_requests_guard();

-- ------------------------------------------------------------------------------
-- 2) DAĞITIM: talep oluşunca uygun firmalara iletilir
--    - single_listing: ilanın firması
--    - multi_vendor: kategoride (alt kategoriler dahil) aktif ilanı olan, aynı ildeki ya da
--      arama yarıçapındaki firmalar; ilçe eşleşmesi ve yakınlık önceliklidir.
-- ------------------------------------------------------------------------------
create or replace function public.quote_requests_distribute() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.request_type = 'single_listing' and new.listing_id is not null then
    insert into public.quote_request_recipients (request_id, company_id)
    select new.id, l.company_id
      from public.listings l
      join public.companies co on co.id = l.company_id
     where l.id = new.listing_id
       and co.user_id <> new.buyer_id
    on conflict do nothing;
  else
    insert into public.quote_request_recipients (request_id, company_id, distance_km)
    select new.id, x.company_id, x.distance_km
      from (
        select l.company_id,
               min(case when new.location is not null and l.location is not null
                        then st_distance(l.location, new.location) / 1000.0 end) as distance_km,
               bool_or(l.district_id = new.district_id) as same_district
          from public.listings l
          join public.categories c on c.id = l.category_id
          join public.companies co on co.id = l.company_id
         where l.status = 'active'
           and co.user_id <> new.buyer_id
           and (c.id = new.category_id or c.parent_id = new.category_id
                or c.id = (select parent_id from public.categories where id = new.category_id))
           and (l.city_id = new.city_id
                or (new.location is not null and l.location is not null
                    and st_dwithin(l.location, new.location, coalesce(new.search_radius_km, 50) * 1000)))
         group by l.company_id
      ) x
     order by x.same_district desc nulls last, x.distance_km asc nulls last, x.company_id
     limit coalesce(new.max_recipients, 10)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.quote_requests_distribute() from public, anon, authenticated;

drop trigger if exists quote_requests_distribute on public.quote_requests;
create trigger quote_requests_distribute
  after insert on public.quote_requests
  for each row execute function public.quote_requests_distribute();

-- Firma kendine gelen dağıtım kayıtlarını görebilir. (quote_requests politikası bu tabloya
-- baktığı için burada quote_requests'e başvurulmaz: sonsuz özyineleme olur.)
alter table public.quote_request_recipients enable row level security;
drop policy if exists qrr_company_read on public.quote_request_recipients;
create policy qrr_company_read on public.quote_request_recipients
  for select to authenticated using (
    company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  );

-- ------------------------------------------------------------------------------
-- 3) TEKLİF KORUMASI
-- ------------------------------------------------------------------------------
create unique index if not exists uq_quotes_request_company_active
  on public.quotes (request_id, company_id)
  where status in ('submitted', 'accepted');

create or replace function public.quotes_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_priv boolean := coalesce(auth.role(), '') = 'service_role'
                    or session_user in ('postgres', 'supabase_admin');
  v_req record;
  v_is_company boolean;
begin
  if v_priv then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select * into v_req from public.quote_requests where id = new.request_id;
    if not found then
      raise exception 'Talep bulunamadı.' using errcode = '23503';
    end if;
    if not exists (
      select 1 from public.quote_request_recipients r
       where r.request_id = new.request_id and r.company_id = new.company_id
    ) then
      raise exception 'Bu talep firmanıza iletilmemiş.' using errcode = '42501';
    end if;
    if v_req.status not in ('sent', 'quotes_received') or v_req.expires_at < now() then
      raise exception 'Bu talep artık teklif kabul etmiyor.' using errcode = '22023';
    end if;
    if new.price_total is null or new.price_total <= 0 then
      raise exception 'Geçerli bir teklif tutarı giriniz.' using errcode = '22023';
    end if;
    new.status := 'submitted';
    new.is_demo := false;
    new.currency := coalesce(new.currency, 'TRY');
    if new.valid_until is null or new.valid_until > now() + interval '30 days' then
      new.valid_until := now() + interval '3 days';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if new.request_id is distinct from old.request_id
     or new.company_id is distinct from old.company_id
     or new.is_demo is distinct from old.is_demo
     or new.created_at is distinct from old.created_at then
    raise exception 'Teklifin tarafları değiştirilemez.' using errcode = '42501';
  end if;

  v_is_company := exists (select 1 from public.companies c where c.id = old.company_id and c.user_id = v_uid);
  new.updated_at := now();

  if v_is_company then
    -- Firma: yalnızca bekleyen teklifini düzenleyebilir ya da geri çekebilir.
    if old.status <> 'submitted' then
      raise exception 'Yanıtlanmış teklif değiştirilemez.' using errcode = '42501';
    end if;
    if new.status not in ('submitted', 'withdrawn') then
      raise exception 'Teklifi yalnızca alıcı kabul veya reddedebilir.' using errcode = '42501';
    end if;
    return new;
  end if;

  if exists (select 1 from public.quote_requests q where q.id = old.request_id and q.buyer_id = v_uid) then
    -- Alıcı: yalnızca durum (kabul / ret) ve geri bildirim.
    if new.price_total is distinct from old.price_total
       or new.price_unit is distinct from old.price_unit
       or new.listing_id is distinct from old.listing_id
       or new.notes is distinct from old.notes
       or new.valid_until is distinct from old.valid_until
       or new.is_operator_included is distinct from old.is_operator_included
       or new.is_fuel_included is distinct from old.is_fuel_included
       or new.is_transport_included is distinct from old.is_transport_included then
      raise exception 'Teklif içeriğini yalnızca firma değiştirebilir.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'submitted' or new.status not in ('accepted', 'rejected') then
        raise exception 'Bu teklif artık yanıtlanamaz.' using errcode = '42501';
      end if;
      if new.status = 'accepted' and old.valid_until < now() then
        raise exception 'Teklifin geçerlilik süresi dolmuş.' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;
  raise exception 'Bu teklif üzerinde yetkiniz yok.' using errcode = '42501';
end;
$$;
revoke all on function public.quotes_guard() from public, anon, authenticated;

drop trigger if exists quotes_guard on public.quotes;
create trigger quotes_guard
  before insert or update on public.quotes
  for each row execute function public.quotes_guard();

-- Teklif sonrası talep durumu ve iletişim açılışı (alıcı/firma talebi doğrudan güncelleyemez).
create or replace function public.quotes_after_change() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
begin
  perform set_config('santiye.internal', 'on', true);
  if tg_op = 'INSERT' then
    update public.quote_requests
       set status = 'quotes_received', updated_at = now()
     where id = new.request_id and status = 'sent';
    perform set_config('santiye.internal', 'off', true);
    return new;
  end if;

  if new.status = 'accepted' and old.status <> 'accepted' then
    select buyer_id into v_buyer from public.quote_requests where id = new.request_id;
    update public.quote_requests
       set status = 'accepted', updated_at = now()
     where id = new.request_id;
    insert into public.contact_reveals (buyer_id, company_id, quote_id, trigger_type)
    values (v_buyer, new.company_id, new.id, 'teklif_kabul')
    on conflict do nothing;
  end if;
  perform set_config('santiye.internal', 'off', true);
  return new;
end;
$$;
revoke all on function public.quotes_after_change() from public, anon, authenticated;

drop trigger if exists quotes_after_change on public.quotes;
create trigger quotes_after_change
  after insert or update of status on public.quotes
  for each row execute function public.quotes_after_change();

create unique index if not exists uq_contact_reveals_pair_quote
  on public.contact_reveals (buyer_id, company_id, quote_id)
  where quote_id is not null;

-- Alıcı kendi talebine gelen teklifleri yanıtlayabilir (alan kısıtları quotes_guard'da).
drop policy if exists quotes_buyer_respond on public.quotes;
create policy quotes_buyer_respond on public.quotes
  for update to authenticated
  using (request_id in (select id from public.quote_requests where buyer_id = auth.uid()))
  with check (request_id in (select id from public.quote_requests where buyer_id = auth.uid()));

-- Firma yalnızca kendisine iletilen taleplere teklif verebilir (guard ile birlikte).
drop policy if exists "Companies can insert quotes" on public.quotes;
drop policy if exists quotes_company_insert on public.quotes;
create policy quotes_company_insert on public.quotes
  for insert to authenticated
  with check (company_id in (select id from public.companies where user_id = auth.uid()));
