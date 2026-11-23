-- 28: Operatör havuzu sağlamlaştırma (25_operator_pool.sql üzerine)
--  * license_classes / machine_types / reference_projects için sınır ve izinli-değer kontrolleri
--    (önceden license_classes serbest metin ve sınırsızdı; herkese açık dizinde gösterildiği için kötüye kullanılabilirdi).
--  * Talep spam koruması: aynı kullanıcı aynı operatöre 24 saatte en fazla 3, toplamda en fazla 20 talep gönderebilir.
--  * start_date en fazla 1 yıl ileri tarihli olabilir.
-- CHECK'ler NOT VALID: mevcut satırlar bozulmaz, yeni/güncellenen satırlar denetlenir. Tekrar çalıştırılabilir.
begin;

alter table public.operators drop constraint if exists operators_license_classes_chk;
alter table public.operators add constraint operators_license_classes_chk check (
  cardinality(license_classes) <= 5
  and license_classes <@ array['G Sınıfı','CE','SRC 3/4','MYK Belgeli','Psikoteknik']) not valid;

alter table public.operators drop constraint if exists operators_machine_types_max_chk;
alter table public.operators add constraint operators_machine_types_max_chk
  check (cardinality(machine_types) <= 8) not valid;

alter table public.operators drop constraint if exists operators_reference_projects_len_chk;
alter table public.operators add constraint operators_reference_projects_len_chk
  check (length(reference_projects) <= 2000) not valid;

create or replace function public.operator_requests_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.start_date > (now() at time zone 'Europe/Istanbul')::date + 365 then
    raise exception 'Başlangıç tarihi en fazla 1 yıl ileri olabilir.' using errcode='check_violation';
  end if;
  if (select count(*) from public.operator_requests r
        where r.requester_id=new.requester_id and r.operator_id=new.operator_id
          and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Aynı operatöre günde en fazla 3 talep gönderebilirsiniz.' using errcode='check_violation';
  end if;
  if (select count(*) from public.operator_requests r
        where r.requester_id=new.requester_id and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Günlük talep sınırına ulaştınız.' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function public.operator_requests_guard() from public,anon,authenticated;

drop trigger if exists operator_requests_guard on public.operator_requests;
create trigger operator_requests_guard before insert on public.operator_requests
  for each row execute function public.operator_requests_guard();

notify pgrst,'reload schema';
commit;
