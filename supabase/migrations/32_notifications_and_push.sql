-- ==============================================================================
-- 32_notifications_and_push.sql
-- Uygulama içi bildirim + Web Push altyapısı (idempotent, tekrar çalıştırılabilir)
--
--  1. notifications tablosu uyumlandı:
--       - `type` enum'dan text'e çevrildi (yeni bildirim tipleri enum hatası vermesin)
--       - `message` + `data` sütunları eklendi: 19_escrow_... içindeki seller_mark_delivered
--         bu sütunlara ve 'delivery_marked' tipine yazıyordu; şema uyumsuzluğundan RPC hata veriyordu
--       - `push_sent_at`: web push'un aynı bildirim için iki kez gönderilmesini engeller
--       - BEFORE INSERT normalizasyonu: başlık/içerik kırpma, yalnızca site içi link kabulü
--  2. GÜVENLİK: 23_messaging_system_repair.sql'deki `notifications_insert_system` politikası
--     (auth.role() = 'authenticated') giriş yapmış HERKESİN başkası adına bildirim yazmasına izin
--     veriyordu. Push ile birlikte bu doğrudan spam/phishing kanalı olurdu; kaldırıldı.
--     İstemci artık yalnızca kendi bildirimlerini OKUYABİLİR ve yalnızca `is_read` güncelleyebilir.
--  3. Olay üreticileri (DB tetikleyicileri; hata verirlerse asıl işlemi ASLA bozmaz):
--       teklif talebi alındı, yeni teklif, teklif kabul/ret, rezervasyon talebi/durum,
--       Şantiyeden Şantiyeye talebi, ilan onay/ret.
--     Mesaj ve escrow bildirimleri zaten kendi RPC'lerinden geliyor.
--  4. Realtime: notifications tablosu yayına eklenir (RLS: herkes yalnızca kendi satırlarını alır).
--
-- Web push gönderimi için Supabase Dashboard > Database > Webhooks bölümünden bir webhook
-- oluşturulmalıdır (adımlar için .env.example ve README'ye bakın).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Şema uyumu
-- ------------------------------------------------------------------------------
alter table public.notifications add column if not exists message text;
alter table public.notifications add column if not exists data jsonb;
alter table public.notifications add column if not exists push_sent_at timestamptz;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'notifications'
                and column_name = 'type' and data_type = 'USER-DEFINED') then
    alter table public.notifications alter column type type text using type::text;
  end if;
end
$$;

-- varchar(200) -> text: değer, BEFORE INSERT tetikleyicisinden ÖNCE kolon tipine zorlandığı için
-- uzun başlık kırpılamadan hata verirdi. Uzunluk sınırını artık notifications_normalize uygular.
alter table public.notifications alter column title type text;

update public.notifications set is_read = false where is_read is null;
alter table public.notifications alter column is_read set default false;
alter table public.notifications alter column is_read set not null;

-- Mevcut (eski) bildirimler için push gönderilmiş sayılır: webhook yeniden oynatılsa bile toplu push çıkmaz.
update public.notifications set push_sent_at = created_at
 where push_sent_at is null and created_at < now() - interval '1 minute';

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id) where is_read = false;

-- ------------------------------------------------------------------------------
-- 1b. BEFORE INSERT normalizasyonu
-- ------------------------------------------------------------------------------
create or replace function public.notifications_normalize()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.type    := left(coalesce(nullif(btrim(new.type), ''), 'info'), 50);
  new.title   := left(coalesce(nullif(btrim(new.title), ''), 'Bildirim'), 200);
  new.content := left(coalesce(nullif(btrim(new.content), ''), nullif(btrim(new.message), ''), new.title), 500);
  new.is_read := coalesce(new.is_read, false);

  -- Eski escrow RPC'si link vermiyor: alıcıyı rezervasyonlarına yönlendir.
  if new.link_url is null and new.type = 'delivery_marked' then
    new.link_url := '/alici-paneli/rezervasyonlar';
  end if;

  -- Yalnızca site içi yol: "//evil.com", "http:", "javascript:" ve kontrol karakterleri reddedilir.
  if new.link_url is not null then
    if new.link_url !~ '^/([^/\\]|$)' or new.link_url ~ '[[:cntrl:]]' then
      new.link_url := null;
    else
      new.link_url := left(new.link_url, 300);
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists notifications_normalize on public.notifications;
create trigger notifications_normalize
  before insert on public.notifications
  for each row execute function public.notifications_normalize();

-- ------------------------------------------------------------------------------
-- 2. RLS ve yetkiler: istemci yalnızca kendi bildirimlerini okur, yalnızca is_read günceller
-- ------------------------------------------------------------------------------
alter table public.notifications enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'notifications'
       and cmd in ('INSERT', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.notifications', p.policyname);
  end loop;
end
$$;

drop policy if exists "Users view own notifications" on public.notifications;
drop policy if exists "Users update own notifications" on public.notifications;
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ------------------------------------------------------------------------------
-- 3. Bildirim üretici yardımcı (yalnızca sunucu/tetikleyici; istemci çağıramaz)
-- ------------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user    uuid,
  p_type    text,
  p_title   text,
  p_content text,
  p_link    text  default null,
  p_data    jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.notifications (user_id, type, title, content, link_url, data)
  values (p_user, p_type, p_title, p_content, p_link, p_data);
exception when others then
  raise warning 'notify_user başarısız (%): %', p_type, sqlerrm;
end
$$;

revoke all on function public.notify_user(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.notify_user(uuid, text, text, text, text, jsonb) to service_role;

-- Para biçimi: 12500 -> "12.500 ₺"
create or replace function public.notif_money(p_amount numeric, p_currency text default 'TRY')
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(to_char(round(p_amount), 'FM999,999,999,990'), ',', '.')
         || ' ' || case when coalesce(p_currency, 'TRY') = 'TRY' then '₺' else p_currency end
$$;

revoke all on function public.notif_money(numeric, text) from public, anon, authenticated;
grant execute on function public.notif_money(numeric, text) to service_role;

-- ------------------------------------------------------------------------------
-- 4. Olay tetikleyicileri
--    Her fonksiyon hatayı yutar: bildirim üretilemese bile asıl INSERT/UPDATE devam eder.
-- ------------------------------------------------------------------------------

-- 4.1 Firmaya teklif talebi ulaştı
create or replace function public.trg_notify_quote_recipient()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_title text;
begin
  select c.user_id into v_owner from public.companies c where c.id = new.company_id;
  select r.title   into v_title from public.quote_requests r where r.id = new.request_id;
  perform public.notify_user(
    v_owner, 'new_quote_request', 'Yeni Teklif Talebi',
    case when v_title is null then 'Size uygun yeni bir teklif talebi var.'
         else left(v_title, 120) || ' talebi için teklif verebilirsiniz.' end,
    '/firma-paneli/talepler',
    jsonb_build_object('request_id', new.request_id));
  return new;
exception when others then
  raise warning 'trg_notify_quote_recipient: %', sqlerrm;
  return new;
end
$$;

-- 4.2 Alıcıya yeni teklif geldi
create or replace function public.trg_notify_new_quote()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_buyer uuid; v_title text; v_company text;
begin
  select r.buyer_id, r.title into v_buyer, v_title from public.quote_requests r where r.id = new.request_id;
  select c.name into v_company from public.companies c where c.id = new.company_id;
  perform public.notify_user(
    v_buyer, 'new_quote', 'Yeni Teklif Aldınız',
    coalesce(v_company, 'Bir firma') || ', "' || left(coalesce(v_title, 'talebiniz'), 80) || '" için '
      || public.notif_money(new.price_total, new.currency) || ' teklif verdi.',
    '/alici-paneli/taleplerim',
    jsonb_build_object('request_id', new.request_id, 'quote_id', new.id));
  return new;
exception when others then
  raise warning 'trg_notify_new_quote: %', sqlerrm;
  return new;
end
$$;

-- 4.3 Firmaya: teklifi kabul/ret edildi
create or replace function public.trg_notify_quote_decision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_title text;
begin
  select c.user_id into v_owner from public.companies c where c.id = new.company_id;
  select r.title   into v_title from public.quote_requests r where r.id = new.request_id;
  if new.status::text = 'accepted' then
    perform public.notify_user(v_owner, 'quote_accepted', 'Teklifiniz Kabul Edildi',
      '"' || left(coalesce(v_title, 'Talep'), 80) || '" için verdiğiniz teklif kabul edildi.',
      '/firma-paneli/talepler', jsonb_build_object('quote_id', new.id));
  elsif new.status::text = 'rejected' then
    perform public.notify_user(v_owner, 'quote_rejected', 'Teklifiniz Seçilmedi',
      '"' || left(coalesce(v_title, 'Talep'), 80) || '" için verdiğiniz teklif seçilmedi.',
      '/firma-paneli/talepler', jsonb_build_object('quote_id', new.id));
  end if;
  return new;
exception when others then
  raise warning 'trg_notify_quote_decision: %', sqlerrm;
  return new;
end
$$;

-- 4.4 Rezervasyon talebi geldi (firmaya)
create or replace function public.trg_notify_booking_new()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_title text;
begin
  select c.user_id into v_owner from public.companies c where c.id = new.company_id;
  select l.title   into v_title from public.listings  l where l.id = new.listing_id;
  perform public.notify_user(
    v_owner, 'booking_requested', 'Yeni Rezervasyon Talebi',
    left(coalesce(v_title, 'İlanınız'), 80) || ' için ' || to_char(new.start_date, 'DD.MM.YYYY')
      || ' – ' || to_char(new.end_date, 'DD.MM.YYYY') || ' arası rezervasyon talebi var.',
    '/firma-paneli/rezervasyonlar',
    jsonb_build_object('booking_id', new.id));
  return new;
exception when others then
  raise warning 'trg_notify_booking_new: %', sqlerrm;
  return new;
end
$$;

-- 4.5 Rezervasyon durumu değişti
create or replace function public.trg_notify_booking_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_title text; v_actor uuid := auth.uid();
begin
  select c.user_id into v_owner from public.companies c where c.id = new.company_id;
  select l.title   into v_title from public.listings  l where l.id = new.listing_id;
  v_title := left(coalesce(v_title, 'İlan'), 80);

  if new.status::text in ('confirmed', 'approved') then
    perform public.notify_user(new.buyer_id, 'booking_confirmed', 'Rezervasyonunuz Onaylandı',
      v_title || ' için rezervasyon talebiniz onaylandı.',
      '/alici-paneli/rezervasyonlar', jsonb_build_object('booking_id', new.id));
  elsif new.status::text = 'rejected' then
    perform public.notify_user(new.buyer_id, 'booking_cancelled', 'Rezervasyon Talebiniz Reddedildi',
      v_title || ' için rezervasyon talebiniz reddedildi.'
        || coalesce(' Neden: ' || left(new.rejection_reason, 120), ''),
      '/alici-paneli/rezervasyonlar', jsonb_build_object('booking_id', new.id));
  elsif new.status::text = 'expired' then
    perform public.notify_user(new.buyer_id, 'booking_cancelled', 'Rezervasyon Talebi Süresi Doldu',
      v_title || ' için rezervasyon talebiniz zamanında yanıtlanmadı.',
      '/alici-paneli/rezervasyonlar', jsonb_build_object('booking_id', new.id));
  elsif new.status::text = 'cancelled' then
    -- İptal alıcıdan geldiyse firmaya, aksi halde alıcıya haber ver.
    if v_actor is not null and v_actor = new.buyer_id then
      perform public.notify_user(v_owner, 'booking_cancelled', 'Rezervasyon İptal Edildi',
        v_title || ' için rezervasyon alıcı tarafından iptal edildi.',
        '/firma-paneli/rezervasyonlar', jsonb_build_object('booking_id', new.id));
    else
      perform public.notify_user(new.buyer_id, 'booking_cancelled', 'Rezervasyon İptal Edildi',
        v_title || ' için rezervasyonunuz iptal edildi.',
        '/alici-paneli/rezervasyonlar', jsonb_build_object('booking_id', new.id));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'trg_notify_booking_status: %', sqlerrm;
  return new;
end
$$;

-- 4.6 Şantiyeden Şantiyeye: ilan sahibine yeni talep
create or replace function public.trg_notify_circular_inquiry()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_title text;
begin
  select l.user_id, l.title into v_owner, v_title from public.circular_listings l where l.id = new.listing_id;
  if v_owner is not null and v_owner <> new.requester_id then
    perform public.notify_user(
      v_owner, 'circular_inquiry', 'İlanınıza Yeni Talep',
      '"' || left(coalesce(v_title, 'İlanınız'), 80) || '" için bir talep bırakıldı'
        || case when new.offered_price is not null
                then ' (teklif: ' || public.notif_money(new.offered_price, 'TRY') || ')' else '' end || '.',
      '/santiyeden-santiyeye',
      jsonb_build_object('listing_id', new.listing_id));
  end if;
  return new;
exception when others then
  raise warning 'trg_notify_circular_inquiry: %', sqlerrm;
  return new;
end
$$;

-- 4.7 İlan onay/ret sonucu (firma sahibine)
create or replace function public.trg_notify_listing_moderation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid;
begin
  select c.user_id into v_owner from public.companies c where c.id = new.company_id;
  if new.status::text = 'active' then
    perform public.notify_user(v_owner, 'listing_approved', 'İlanınız Yayında',
      '"' || left(new.title, 80) || '" ilanınız onaylandı ve yayına alındı.',
      '/firma-paneli', jsonb_build_object('listing_id', new.id));
  elsif new.status::text = 'rejected' then
    perform public.notify_user(v_owner, 'listing_rejected', 'İlanınız Onaylanmadı',
      '"' || left(new.title, 80) || '" ilanınız yayın kurallarına uymadığı için onaylanmadı.',
      '/firma-paneli', jsonb_build_object('listing_id', new.id));
  end if;
  return new;
exception when others then
  raise warning 'trg_notify_listing_moderation: %', sqlerrm;
  return new;
end
$$;

-- Tetikleyici fonksiyonlarına istemci erişimi kapalı
revoke all on function public.trg_notify_quote_recipient()   from public, anon, authenticated;
revoke all on function public.trg_notify_new_quote()         from public, anon, authenticated;
revoke all on function public.trg_notify_quote_decision()    from public, anon, authenticated;
revoke all on function public.trg_notify_booking_new()       from public, anon, authenticated;
revoke all on function public.trg_notify_booking_status()    from public, anon, authenticated;
revoke all on function public.trg_notify_circular_inquiry()  from public, anon, authenticated;
revoke all on function public.trg_notify_listing_moderation() from public, anon, authenticated;

-- Tabloları bağla (tablo yoksa atla: kısmi kurulumlarda migration kırılmaz)
do $$
begin
  if to_regclass('public.quote_request_recipients') is not null
     and to_regclass('public.quote_requests') is not null and to_regclass('public.companies') is not null then
    drop trigger if exists notify_quote_recipient on public.quote_request_recipients;
    create trigger notify_quote_recipient after insert on public.quote_request_recipients
      for each row execute function public.trg_notify_quote_recipient();
  end if;

  if to_regclass('public.quotes') is not null
     and to_regclass('public.quote_requests') is not null and to_regclass('public.companies') is not null then
    drop trigger if exists notify_new_quote on public.quotes;
    create trigger notify_new_quote after insert on public.quotes
      for each row execute function public.trg_notify_new_quote();

    drop trigger if exists notify_quote_decision on public.quotes;
    create trigger notify_quote_decision after update of status on public.quotes
      for each row
      when (old.status is distinct from new.status and new.status::text in ('accepted', 'rejected'))
      execute function public.trg_notify_quote_decision();
  end if;

  if to_regclass('public.bookings') is not null and to_regclass('public.listings') is not null
     and to_regclass('public.companies') is not null then
    drop trigger if exists notify_booking_new on public.bookings;
    create trigger notify_booking_new after insert on public.bookings
      for each row when (new.status::text = 'pending')
      execute function public.trg_notify_booking_new();

    drop trigger if exists notify_booking_status on public.bookings;
    create trigger notify_booking_status after update of status on public.bookings
      for each row when (old.status is distinct from new.status)
      execute function public.trg_notify_booking_status();
  end if;

  if to_regclass('public.circular_inquiries') is not null and to_regclass('public.circular_listings') is not null then
    drop trigger if exists notify_circular_inquiry on public.circular_inquiries;
    create trigger notify_circular_inquiry after insert on public.circular_inquiries
      for each row execute function public.trg_notify_circular_inquiry();
  end if;

  if to_regclass('public.listings') is not null and to_regclass('public.companies') is not null then
    drop trigger if exists notify_listing_moderation on public.listings;
    create trigger notify_listing_moderation after update of status on public.listings
      for each row
      when (old.status::text = 'pending_approval' and new.status::text in ('active', 'rejected'))
      execute function public.trg_notify_listing_moderation();
  end if;
end
$$;

-- ------------------------------------------------------------------------------
-- 5. Push abonelikleri: cihaz bilgisi + RLS zaten 31_security_hardening'de (yalnızca sahibi)
--    Abonelik yazma/silme sunucu rotasından (service_role) yapılır.
-- ------------------------------------------------------------------------------
-- GÜVENLİK: 31_security_hardening'deki "sahibi her şeyi yapar" politikası, kullanıcının kendi satırına
-- keyfi bir `endpoint` yazmasına izin veriyordu. Sunucu bu adrese push isteği attığı için bu bir SSRF
-- yoluydu (iç ağ / metadata adresleri). Artık istemci tabloya hiç dokunamaz: yazma/okuma
-- /api/push/subscribe üzerinden (oturum doğrulanır, endpoint yalnızca bilinen push servislerine izinlidir).
do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    alter table public.push_subscriptions add column if not exists user_agent text;
    alter table public.push_subscriptions add column if not exists updated_at timestamptz not null default now();

    alter table public.push_subscriptions enable row level security;
    revoke all on public.push_subscriptions from public, anon, authenticated;
    grant all on public.push_subscriptions to service_role;
  end if;
end
$$;

-- ------------------------------------------------------------------------------
-- 6. Realtime: zil ikonu anlık güncellensin (RLS gereği herkes yalnızca kendi satırını alır)
-- ------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

notify pgrst, 'reload schema';
