-- 29: BOQ dağıtımı için kötüye kullanım koruması (26_boq_distribution.sql üzerine)
--  * submit_boq her çağrıda en fazla 6 talep × 10 tedarikçiyi doldurur; farklı token'larla art arda çağrılırsa
--    tedarikçilere spam gönderilebilirdi. boq_submissions'a created_at eklenir ve alıcı başına
--    saatte en fazla 10, günde en fazla 30 YENİ dağıtım kabul edilir (aynı token tekrarı sayılmaz: idempotent).
--  * Trigger submit_boq'un ilk INSERT'ünde çalıştığı için hata tüm işlemi geri alır; fonksiyon gövdesi değişmez.
-- Tekrar çalıştırılabilir.
begin;
alter table public.boq_submissions add column if not exists created_at timestamptz not null default now();
create index if not exists boq_submissions_buyer_recent on public.boq_submissions(buyer_id, created_at desc);

create or replace function public.boq_submissions_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Aynı (buyer, token) zaten kayıtlıysa bu bir yeniden deneme/replay'dir: submit_boq'un
  -- `on conflict do nothing` yolu kayıtlı sonucu döndürür; limit yüzünden hata verilmez (idempotent kalır).
  if exists(select 1 from public.boq_submissions s where s.buyer_id=new.buyer_id and s.token=new.token) then
    return new;
  end if;
  if (select count(*) from public.boq_submissions s
        where s.buyer_id=new.buyer_id and s.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Saatlik toplu teklif dağıtım sınırına ulaştınız. Lütfen daha sonra tekrar deneyin.' using errcode='check_violation';
  end if;
  if (select count(*) from public.boq_submissions s
        where s.buyer_id=new.buyer_id and s.created_at > now() - interval '1 day') >= 30 then
    raise exception 'Günlük toplu teklif dağıtım sınırına ulaştınız.' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function public.boq_submissions_guard() from public,anon,authenticated;

drop trigger if exists boq_submissions_guard on public.boq_submissions;
create trigger boq_submissions_guard before insert on public.boq_submissions
  for each row execute function public.boq_submissions_guard();
notify pgrst,'reload schema';
commit;
