-- 27: Geofence sefer sayacı sağlamlaştırma (24_geofence_trips.sql üzerine)
--  * Işınlanma (teleport) koruması: faz geçişleri arasında, güzergâh mesafesine göre
--    fiziksel olarak mümkün en kısa süre geçmeden "varış"/"dönüş" kabul edilmez.
--    (Önceden origin→dışarı→varış noktaları milisaniye arayla gönderilip sahte sefer fişi üretilebiliyordu.)
--  * Hedef sefer sayısına ulaşılınca yeni kayıt alınmaz (receipts sınırsız büyüyemez).
--  * phase / target / receipts için CHECK kısıtları.
--  * phase_at: son faz geçişinin SUNUCU zamanı (istemci saatine güvenilmez).
-- Tekrar çalıştırılabilir (idempotent).
begin;

alter table public.geofence_trips add column if not exists phase_at timestamptz;

alter table public.geofence_trips drop constraint if exists geofence_trips_phase_chk;
alter table public.geofence_trips add constraint geofence_trips_phase_chk
  check (phase in ('WAITING','AT_ORIGIN','IN_TRANSIT','AT_DESTINATION','RETURNING'));

alter table public.geofence_trips drop constraint if exists geofence_trips_target_max_chk;
alter table public.geofence_trips add constraint geofence_trips_target_max_chk
  check (target <= 1000) not valid;   -- mevcut satırlar etkilenmez, yeni kayıtlar sınırlanır

alter table public.geofence_trips drop constraint if exists geofence_trips_receipts_array_chk;
alter table public.geofence_trips add constraint geofence_trips_receipts_array_chk
  check (jsonb_typeof(receipts) = 'array');

create or replace function public.record_trip_point(p_booking uuid,p_revision integer,p_lat float8,p_lng float8)
returns void language plpgsql security definer set search_path='' as $$
declare
  t public.geofence_trips;
  point jsonb := jsonb_build_object('lat',p_lat,'lng',p_lng);
  now_ts timestamptz := clock_timestamp();
  at_origin boolean;
  at_dest boolean;
  min_leg interval;
begin
  if not exists(select 1 from public.bookings b join public.companies c on c.id=b.company_id
    where b.id=p_booking and c.user_id=auth.uid() and b.status in ('approved','confirmed')) then
    raise exception 'Aktif firma rezervasyonu gerekli.';
  end if;
  select * into strict t from public.geofence_trips where booking_id=p_booking for update;
  if t.revision is distinct from p_revision then return; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Geçersiz koordinat.';
  end if;
  -- Hedef sefer tamamlandıysa yeni kayıt alma
  if jsonb_array_length(t.receipts) >= t.target then return; end if;

  at_origin := public.trip_distance(p_lat,p_lng,t.origin_lat,t.origin_lng)<=t.origin_radius;
  at_dest := public.trip_distance(p_lat,p_lng,t.dest_lat,t.dest_lng)<=t.dest_radius;
  -- Bir bacağı (şantiye↔döküm) bitirmek için gereken en kısa süre: kalan mesafe / 40 m/s (144 km/sa)
  min_leg := make_interval(secs => greatest(
    public.trip_distance(t.origin_lat,t.origin_lng,t.dest_lat,t.dest_lng) - t.origin_radius - t.dest_radius, 0) / 40.0);

  if t.phase in ('WAITING','RETURNING') and at_origin then
    if t.phase='RETURNING' and t.phase_at is not null and now_ts - t.phase_at < min_leg then return; end if;
    t.phase := 'AT_ORIGIN'; t.origin := point; t.phase_at := now_ts;
  elsif t.phase='AT_ORIGIN' and not at_origin then
    t.phase := 'IN_TRANSIT'; t.departed := now_ts; t.phase_at := now_ts;
  elsif t.phase='IN_TRANSIT' and at_dest then
    if now_ts - coalesce(t.phase_at, t.departed, now_ts - min_leg) < min_leg then return; end if;
    t.phase := 'AT_DESTINATION'; t.phase_at := now_ts;
    t.receipts := t.receipts || jsonb_build_object('departed',t.departed,'arrived',now_ts,
      'plate',t.plate,'origin',t.origin,'destination',point);
  elsif t.phase='AT_DESTINATION' and not at_dest then
    t.phase := 'RETURNING'; t.phase_at := now_ts;
  else return;
  end if;
  update public.geofence_trips set phase=t.phase,origin=t.origin,departed=t.departed,receipts=t.receipts,
    phase_at=t.phase_at,revision=t.revision+1 where booking_id=p_booking;
end $$;
revoke all on function public.record_trip_point(uuid,integer,float8,float8) from public,anon;
grant execute on function public.record_trip_point(uuid,integer,float8,float8) to authenticated;
notify pgrst,'reload schema';
commit;
