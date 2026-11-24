-- ==============================================================================
-- ŞANTİYE GO – 36: DOĞRULANMIŞ DEĞERLENDİRMELER
-- Tamamı idempotent; Supabase SQL Editor'de tek seferde çalıştırılabilir.
--
-- Sorunlar:
--  1) Uygulama 3 alt puan (kalite / zamanlama / iletişim) yazıyordu; tabloda yalnızca
--     tek "rating" sütunu vardı -> değerlendirmeler veritabanına hiç yazılmıyordu.
--  2) INSERT politikası değerlendirilen firmanın rezervasyonun firması olduğunu
--     doğrulamıyordu (başka firmanın rezervasyonuyla herhangi bir firmaya puan verilebilirdi).
--  3) UPDATE politikaları alıcının firma/rezervasyon değiştirmesine, firmanın puanı
--     değiştirmesine izin veriyordu.
-- ==============================================================================

alter table public.reviews
  add column if not exists rating_quality int,
  add column if not exists rating_timing int,
  add column if not exists rating_communication int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_sub_ratings_range') then
    alter table public.reviews add constraint reviews_sub_ratings_range check (
      (rating_quality is null or rating_quality between 1 and 5)
      and (rating_timing is null or rating_timing between 1 and 5)
      and (rating_communication is null or rating_communication between 1 and 5)
    );
  end if;
end
$$;

-- Değerlendirilebilir rezervasyon: alıcıya ait, tamamlanmış ya da kiralama süresi bitmiş onaylı.
drop policy if exists "Buyers can insert review for completed booking" on public.reviews;
drop policy if exists reviews_buyer_insert on public.reviews;
create policy reviews_buyer_insert on public.reviews
  for insert to authenticated with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
       where b.id = reviews.booking_id
         and b.buyer_id = auth.uid()
         and b.company_id = reviews.company_id
         and (reviews.listing_id is null or reviews.listing_id = b.listing_id)
         and (b.status = 'completed'
              or (b.status in ('approved', 'confirmed') and b.end_date < current_date))
    )
  );

drop policy if exists "Buyers update own reviews" on public.reviews;
drop policy if exists "Companies reply to own reviews" on public.reviews;
drop policy if exists reviews_parties_update on public.reviews;
create policy reviews_parties_update on public.reviews
  for update to authenticated
  using (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
  )
  with check (
    buyer_id = auth.uid()
    or company_id in (select id from public.companies where user_id = auth.uid())
  );

create or replace function public.reviews_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_priv boolean := coalesce(auth.role(), '') = 'service_role'
                    or session_user in ('postgres', 'supabase_admin');
begin
  if v_priv then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.company_reply := null;
    new.company_replied_at := null;
    new.is_edited := false;
    new.edited_at := null;
    new.is_demo := false;
    new.created_at := now();
    new.updated_at := now();
    -- Genel puan alt puanların ortalamasıdır (verilmişse).
    if new.rating_quality is not null and new.rating_timing is not null
       and new.rating_communication is not null then
      new.rating := round((new.rating_quality + new.rating_timing + new.rating_communication) / 3.0);
    end if;
    return new;
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.buyer_id is distinct from old.buyer_id
     or new.company_id is distinct from old.company_id
     or new.listing_id is distinct from old.listing_id
     or new.is_demo is distinct from old.is_demo
     or new.created_at is distinct from old.created_at then
    raise exception 'Değerlendirmenin tarafları değiştirilemez.' using errcode = '42501';
  end if;

  if v_uid = old.buyer_id then
    if new.company_reply is distinct from old.company_reply
       or new.company_replied_at is distinct from old.company_replied_at then
      raise exception 'Firma yanıtını yalnızca firma yazabilir.' using errcode = '42501';
    end if;
    if new.rating is distinct from old.rating
       or new.rating_quality is distinct from old.rating_quality
       or new.rating_timing is distinct from old.rating_timing
       or new.rating_communication is distinct from old.rating_communication
       or new.comment is distinct from old.comment then
      new.is_edited := true;
      new.edited_at := now();
    end if;
  else
    -- Firma: yalnızca bir kez yanıt yazabilir.
    if new.rating is distinct from old.rating
       or new.rating_quality is distinct from old.rating_quality
       or new.rating_timing is distinct from old.rating_timing
       or new.rating_communication is distinct from old.rating_communication
       or new.comment is distinct from old.comment
       or new.is_edited is distinct from old.is_edited
       or new.edited_at is distinct from old.edited_at then
      raise exception 'Firma değerlendirmenin puanını veya yorumunu değiştiremez.' using errcode = '42501';
    end if;
    if old.company_reply is not null and new.company_reply is distinct from old.company_reply then
      raise exception 'Bu değerlendirmeye zaten yanıt verilmiş.' using errcode = '42501';
    end if;
    if new.company_reply is distinct from old.company_reply then
      new.company_replied_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.reviews_guard() from public, anon, authenticated;

drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard
  before insert or update on public.reviews
  for each row execute function public.reviews_guard();
