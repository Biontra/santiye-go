-- 30: Şantiyeden Şantiyeye — Artan Malzeme & Boş Dönüş Kamyonu Pazarı
--  * circular_listings : artan malzeme (SURPLUS_MATERIAL) ve boş dönüş araç (BACKHAUL_TRUCK) ilanları
--  * circular_inquiries: ilgilenen alıcıların ilan sahibine bıraktığı talepler (kullanıcı başına ilan başına 1)
--  * circular_market   : herkese açık vitrin görünümü (telefon ve user_id YOK; yalnızca aktif + süresi dolmamış)
--  * circular_listing_contact(): ilan telefonunu yalnızca ilan sahibine veya talep göndermiş kullanıcıya verir
-- Güvenlik:
--  * user_id / requester_id istemciden asla kabul edilmez: kolon default auth.uid(), INSERT kolon yetkisinde yok, RLS with check.
--  * Metin sınırları CHECK ile veritabanında (başlık ≤ 200, açıklama ≤ 1500, talep mesajı ≤ 1000).
--  * Spam: saatlik/günlük ilan ve talep limitleri, aktif ilan tavanı, aynı başlıkla çift aktif ilan yasağı,
--    metinde bağlantı (link) yasağı, ilan başına talep tavanı. Tetikleyiciler security definer'dır.
-- Tekrar çalıştırılabilir.
begin;

create table if not exists public.circular_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  listing_type text not null check (listing_type in ('SURPLUS_MATERIAL','BACKHAUL_TRUCK')),
  title text not null check (length(title) <= 200 and length(trim(title)) >= 3),
  category text not null check (category in
    ('Kaba Yapı & Demir','İskele & Kalıp','Konteyner & Ekipman','Lowbed & Ağır Nakliye','Damperli & Kamyon')),
  quantity_info text not null check (length(quantity_info) <= 120 and length(trim(quantity_info)) >= 1),
  price numeric(14,2) not null check (price > 0 and price <= 1000000000),
  discount_note text not null default '' check (length(discount_note) <= 120),
  origin_city text not null check (length(trim(origin_city)) between 2 and 80),
  origin_district text not null default '' check (length(origin_district) <= 80),
  dest_city text check (dest_city is null or length(trim(dest_city)) between 2 and 80),
  dest_district text check (dest_district is null or length(dest_district) <= 80),
  available_until date not null,
  contact_phone text not null check (
    length(trim(contact_phone)) between 7 and 25 and contact_phone ~ '^[0-9+()\s-]+$'
    and length(regexp_replace(contact_phone, '\D', '', 'g')) between 7 and 15),
  description text not null default '' check (length(description) <= 1500),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SOLD')),
  created_at timestamptz not null default now(),
  constraint circular_type_category_chk check (
    (listing_type = 'SURPLUS_MATERIAL' and category in ('Kaba Yapı & Demir','İskele & Kalıp','Konteyner & Ekipman'))
    or (listing_type = 'BACKHAUL_TRUCK' and category in ('Lowbed & Ağır Nakliye','Damperli & Kamyon'))),
  constraint circular_route_chk check (
    (listing_type = 'BACKHAUL_TRUCK' and dest_city is not null)
    or (listing_type = 'SURPLUS_MATERIAL' and dest_city is null and dest_district is null))
);
create index if not exists circular_listings_browse on public.circular_listings(listing_type, status, available_until, created_at desc);
create index if not exists circular_listings_owner on public.circular_listings(user_id, created_at desc);

create table if not exists public.circular_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.circular_listings on delete cascade,
  requester_id uuid not null default auth.uid() references auth.users on delete cascade,
  message text not null check (length(trim(message)) >= 5 and length(message) <= 1000),
  offered_price numeric(14,2) check (offered_price is null or (offered_price > 0 and offered_price <= 1000000000)),
  requester_phone text not null check (
    length(trim(requester_phone)) between 7 and 25 and requester_phone ~ '^[0-9+()\s-]+$'
    and length(regexp_replace(requester_phone, '\D', '', 'g')) between 7 and 15),
  created_at timestamptz not null default now(),
  constraint circular_inquiries_once unique (listing_id, requester_id)
);
create index if not exists circular_inquiries_inbox on public.circular_inquiries(listing_id, created_at desc);
create index if not exists circular_inquiries_sender on public.circular_inquiries(requester_id, created_at desc);

-- ---------------------------------------------------------------- RLS + kolon yetkileri
alter table public.circular_listings enable row level security;
alter table public.circular_inquiries enable row level security;
revoke all on public.circular_listings from public, anon, authenticated;
revoke all on public.circular_inquiries from public, anon, authenticated;

drop policy if exists circular_listings_select_own on public.circular_listings;
create policy circular_listings_select_own on public.circular_listings for select to authenticated
  using (user_id = auth.uid());
drop policy if exists circular_listings_insert_own on public.circular_listings;
create policy circular_listings_insert_own on public.circular_listings for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists circular_listings_update_own on public.circular_listings;
create policy circular_listings_update_own on public.circular_listings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- user_id, status (insert'te), created_at için insert yetkisi YOK; güncellemede yalnızca status (satıldı işareti). DELETE yok.
grant select on public.circular_listings to authenticated;
grant insert (listing_type, title, category, quantity_info, price, discount_note, origin_city, origin_district,
              dest_city, dest_district, available_until, contact_phone, description)
  on public.circular_listings to authenticated;
grant update (status) on public.circular_listings to authenticated;

create or replace view public.circular_market as
  select id, listing_type, title, category, quantity_info, price, discount_note,
         origin_city, origin_district, dest_city, dest_district, available_until, description, created_at,
         coalesce(user_id = auth.uid(), false) as is_mine
  from public.circular_listings
  where status = 'ACTIVE' and available_until >= (now() at time zone 'Europe/Istanbul')::date;
revoke all on public.circular_market from public, anon, authenticated;
grant select on public.circular_market to anon, authenticated;

drop policy if exists circular_inquiries_select on public.circular_inquiries;
create policy circular_inquiries_select on public.circular_inquiries for select to authenticated using (
  requester_id = auth.uid()
  or exists (select 1 from public.circular_listings l where l.id = listing_id and l.user_id = auth.uid()));
drop policy if exists circular_inquiries_insert on public.circular_inquiries;
create policy circular_inquiries_insert on public.circular_inquiries for insert to authenticated with check (
  requester_id = auth.uid()
  and exists (select 1 from public.circular_market m where m.id = listing_id and not m.is_mine));
grant select on public.circular_inquiries to authenticated;
grant insert (listing_id, message, offered_price, requester_phone) on public.circular_inquiries to authenticated;

-- İlan telefonu: yalnızca ilan sahibi veya o ilana talep göndermiş kullanıcı.
create or replace function public.circular_listing_contact(p_listing uuid) returns text
language sql stable security definer set search_path = '' as $$
  select l.contact_phone from public.circular_listings l
   where l.id = p_listing and auth.uid() is not null
     and (l.user_id = auth.uid()
          or exists (select 1 from public.circular_inquiries i where i.listing_id = l.id and i.requester_id = auth.uid()))
$$;
revoke all on function public.circular_listing_contact(uuid) from public, anon, authenticated;
grant execute on function public.circular_listing_contact(uuid) to authenticated;

-- ---------------------------------------------------------------- Spam / kötüye kullanım korumaları
create or replace function public.circular_listings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'SOLD' and new.status = 'ACTIVE' then
      raise exception 'Satıldı olarak işaretlenen ilan yeniden yayına alınamaz; yeni ilan oluşturun.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  new.title := btrim(new.title);
  new.quantity_info := btrim(new.quantity_info);
  new.discount_note := btrim(new.discount_note);
  new.description := btrim(new.description);
  new.contact_phone := btrim(new.contact_phone);

  if concat_ws(' ', new.title, new.quantity_info, new.discount_note, new.description) ~* '(https?://|www\.|t\.me/|wa\.me/)' then
    raise exception 'İlan metninde bağlantı (link) kullanılamaz; iletişim için telefon alanını kullanın.' using errcode = 'check_violation';
  end if;
  if new.available_until < today or new.available_until > today + 180 then
    raise exception 'Geçerlilik tarihi bugünden itibaren en fazla 180 gün olabilir.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.circular_listings l
              where l.user_id = new.user_id and l.status = 'ACTIVE' and l.available_until >= today
                and lower(btrim(l.title)) = lower(new.title)) then
    raise exception 'Aynı başlıkla yayında bir ilanınız zaten var.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_listings l
        where l.user_id = new.user_id and l.status = 'ACTIVE' and l.available_until >= today) >= 10 then
    raise exception 'En fazla 10 aktif ilanınız olabilir. Satılanları kapatın veya süresinin dolmasını bekleyin.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_listings l
        where l.user_id = new.user_id and l.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Saatte en fazla 3 ilan verebilirsiniz. Lütfen daha sonra tekrar deneyin.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_listings l
        where l.user_id = new.user_id and l.created_at > now() - interval '1 day') >= 8 then
    raise exception 'Günlük ilan sınırına ulaştınız.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.circular_listings_guard() from public, anon, authenticated;
drop trigger if exists circular_listings_guard on public.circular_listings;
create trigger circular_listings_guard before insert or update on public.circular_listings
  for each row execute function public.circular_listings_guard();

create or replace function public.circular_inquiries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.message := btrim(new.message);
  new.requester_phone := btrim(new.requester_phone);
  if exists (select 1 from public.circular_inquiries i where i.listing_id = new.listing_id and i.requester_id = new.requester_id) then
    raise exception 'Bu ilana zaten talep gönderdiniz.' using errcode = 'check_violation';
  end if;
  if new.message ~* '(https?://|www\.|t\.me/|wa\.me/)' then
    raise exception 'Mesajda bağlantı (link) kullanılamaz.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_inquiries i
        where i.requester_id = new.requester_id and i.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Saatte en fazla 5 talep gönderebilirsiniz. Lütfen daha sonra tekrar deneyin.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_inquiries i
        where i.requester_id = new.requester_id and i.created_at > now() - interval '1 day') >= 15 then
    raise exception 'Günlük talep sınırına ulaştınız.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.circular_inquiries i where i.listing_id = new.listing_id) >= 100 then
    raise exception 'Bu ilan şu anda çok sayıda talep aldı. Lütfen başka bir ilana bakın.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.circular_inquiries_guard() from public, anon, authenticated;
drop trigger if exists circular_inquiries_guard on public.circular_inquiries;
create trigger circular_inquiries_guard before insert on public.circular_inquiries
  for each row execute function public.circular_inquiries_guard();

notify pgrst, 'reload schema';
commit;
