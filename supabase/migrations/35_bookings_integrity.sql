-- ==============================================================================
-- ŞANTİYE GO – 35: REZERVASYON BÜTÜNLÜĞÜ
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Sorunlar:
--  1) Uygulama bookings'e şantiye adresi / not / adet yazıyordu ama sütunlar yoktu ->
--     her rezervasyon talebi veritabanına yazılamıyor, sessizce bellekte kalıyordu.
--  2) check_booking_overlap yalnızca 'pending' ve 'confirmed' sayıyordu; uygulamanın
--     kullandığı 'approved' durumu ve takvimde kapatılan (dolu / bakım) günler sayılmıyordu.
--  3) "Parties can update relevant bookings" politikası alıcının kendi rezervasyonunu
--     'approved' yapmasına, fiyatı / tarihleri / firmayı değiştirmesine izin veriyordu.
--  4) Onaylanan rezervasyonlar firma takvimine (listing_availability) işlenmiyordu.
-- ==============================================================================

alter table public.bookings
  add column if not exists site_address text,
  add column if not exists notes text,
  add column if not exists quantity int not null default 1;

-- ------------------------------------------------------------------------------
-- 2) ÇAKIŞMA KONTROLÜ
-- ------------------------------------------------------------------------------
create or replace function public.check_booking_overlap(
  p_listing_id uuid, p_start_date date, p_end_date date
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock int;
  v_max_booked int;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    return false;
  end if;

  select coalesce(stock_quantity, 1) into v_stock from public.listings where id = p_listing_id;
  if not found then
    return false;
  end if;

  -- Firma takviminde kapatılmış gün varsa müsait değildir.
  if exists (
    select 1 from public.listing_availability a
     where a.listing_id = p_listing_id
       and a.date between p_start_date and p_end_date
       and (a.status = 'maintenance'
            or (a.status = 'booked' and coalesce(a.booked_quantity, 1) >= v_stock))
  ) then
    return false;
  end if;

  select coalesce(max(daily_count), 0) into v_max_booked
    from (
      select d::date as booking_day, sum(coalesce(b.quantity, 1)) as daily_count
        from public.bookings b,
             generate_series(b.start_date, b.end_date, '1 day'::interval) d
       where b.listing_id = p_listing_id
         and b.status in ('pending', 'approved', 'confirmed')
         and d::date between p_start_date and p_end_date
       group by d::date
    ) sub;

  return v_max_booked < v_stock;
end;
$$;

-- ------------------------------------------------------------------------------
-- 3) ALAN VE DURUM KORUMASI
-- ------------------------------------------------------------------------------
create or replace function public.bookings_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_priv boolean := coalesce(auth.role(), '') = 'service_role'
                    or session_user in ('postgres', 'supabase_admin');
  v_is_company boolean;
  v_listing_company uuid;
begin
  if v_priv then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select company_id into v_listing_company from public.listings where id = new.listing_id;
    if v_listing_company is null then
      raise exception 'İlan bulunamadı.' using errcode = '23503';
    end if;
    if new.company_id is distinct from v_listing_company then
      raise exception 'Rezervasyon firması ilanın firmasıyla eşleşmiyor.' using errcode = '42501';
    end if;
    if new.end_date < new.start_date then
      raise exception 'Bitiş tarihi başlangıçtan önce olamaz.' using errcode = '22023';
    end if;
    if new.start_date < current_date then
      raise exception 'Geçmiş tarihli rezervasyon oluşturulamaz.' using errcode = '22023';
    end if;
    if not public.check_booking_overlap(new.listing_id, new.start_date, new.end_date) then
      raise exception 'Seçilen tarihlerde ilan müsait değil.' using errcode = '23P01';
    end if;
    new.status := 'pending';
    new.payment_status := 'disabled';
    new.payment_amount := 0;
    new.rejection_reason := null;
    new.is_demo := false;
    new.total_days := (new.end_date - new.start_date) + 1;
    new.quantity := greatest(coalesce(new.quantity, 1), 1);
    new.expires_at := now() + interval '48 hours';
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE: temel alanlar değiştirilemez.
  if new.buyer_id        is distinct from old.buyer_id
     or new.company_id   is distinct from old.company_id
     or new.listing_id   is distinct from old.listing_id
     or new.quote_id     is distinct from old.quote_id
     or new.start_date   is distinct from old.start_date
     or new.end_date     is distinct from old.end_date
     or new.total_days   is distinct from old.total_days
     or new.quantity     is distinct from old.quantity
     or new.agreed_price is distinct from old.agreed_price
     or new.currency     is distinct from old.currency
     or new.payment_status is distinct from old.payment_status
     or new.payment_amount is distinct from old.payment_amount
     or new.is_demo      is distinct from old.is_demo
     or new.created_at   is distinct from old.created_at
     or new.expires_at   is distinct from old.expires_at then
    raise exception 'Rezervasyonun fiyat, tarih ve taraf bilgileri değiştirilemez.' using errcode = '42501';
  end if;

  new.updated_at := now();
  if new.status = old.status then
    return new;
  end if;

  v_is_company := exists (
    select 1 from public.companies c where c.id = old.company_id and c.user_id = v_uid
  );

  if v_is_company then
    if (old.status = 'pending' and new.status in ('approved', 'confirmed', 'rejected', 'cancelled'))
       or (old.status in ('approved', 'confirmed') and new.status in ('completed', 'cancelled'))
       or (old.status = 'approved' and new.status = 'confirmed') then
      return new;
    end if;
  elsif v_uid = old.buyer_id then
    if old.status in ('pending', 'approved', 'confirmed') and new.status = 'cancelled' then
      return new;
    end if;
  elsif public.is_admin() then
    return new;
  end if;

  raise exception 'Bu durum değişikliğine yetkiniz yok (% -> %).', old.status, new.status
    using errcode = '42501';
end;
$$;

drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- ------------------------------------------------------------------------------
-- 4) ONAYLANAN / İPTAL EDİLEN REZERVASYONU FİRMA TAKVİMİNE İŞLE
-- ------------------------------------------------------------------------------
create or replace function public.bookings_sync_availability() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := 'Rezervasyon #' || left(new.id::text, 8);
begin
  if new.status in ('approved', 'confirmed')
     and old.status not in ('approved', 'confirmed') then
    insert into public.listing_availability (listing_id, date, status, booked_quantity, notes)
    select new.listing_id, d::date, 'booked', coalesce(new.quantity, 1), v_note
      from generate_series(new.start_date, new.end_date, '1 day'::interval) d
    on conflict (listing_id, date) do update
      set booked_quantity = coalesce(public.listing_availability.booked_quantity, 0) + excluded.booked_quantity,
          status = case when public.listing_availability.status = 'maintenance'
                        then public.listing_availability.status else 'booked' end;
  elsif new.status in ('cancelled', 'rejected', 'expired')
        and old.status in ('approved', 'confirmed') then
    update public.listing_availability a
       set booked_quantity = greatest(coalesce(a.booked_quantity, 0) - coalesce(new.quantity, 1), 0),
           status = case when a.status = 'booked'
                          and greatest(coalesce(a.booked_quantity, 0) - coalesce(new.quantity, 1), 0) = 0
                         then 'available' else a.status end
     where a.listing_id = new.listing_id
       and a.date between new.start_date and new.end_date;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_sync_availability on public.bookings;
create trigger bookings_sync_availability
  after update of status on public.bookings
  for each row execute function public.bookings_sync_availability();

revoke all on function public.bookings_guard() from public, anon, authenticated;
revoke all on function public.bookings_sync_availability() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5) İLETİŞİM AÇILIŞI (contact_reveals)
--    RLS açıktı ama hiç politika yoktu: istemciden yapılan açılış kaydı ve okuma
--    sessizce başarısız oluyordu. Açılış ayrıcalıklı bir işlemdir (telefon numarasını
--    açar), bu yüzden istemciye INSERT verilmez; rezervasyon firma tarafından
--    onaylandığında veritabanı tetikleyicisi kaydı oluşturur. Taraflar okuyabilir.
-- ------------------------------------------------------------------------------
create unique index if not exists uq_contact_reveals_pair_booking
  on public.contact_reveals (buyer_id, company_id, booking_id)
  where booking_id is not null;

drop policy if exists contact_reveals_parties_read on public.contact_reveals;
create policy contact_reveals_parties_read on public.contact_reveals
  for select to authenticated using (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
    or public.is_admin()
  );
revoke insert, update, delete, truncate on public.contact_reveals from anon, authenticated;
revoke all on public.contact_reveals from anon;

create or replace function public.bookings_reveal_contact() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'confirmed') and old.status not in ('approved', 'confirmed') then
    insert into public.contact_reveals (buyer_id, company_id, booking_id, trigger_type)
    values (new.buyer_id, new.company_id, new.id, 'teklif_kabul')
    on conflict do nothing;
  end if;
  return new;
exception when others then
  raise warning 'bookings_reveal_contact: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.bookings_reveal_contact() from public, anon, authenticated;

drop trigger if exists bookings_reveal_contact on public.bookings;
create trigger bookings_reveal_contact
  after update of status on public.bookings
  for each row execute function public.bookings_reveal_contact();
