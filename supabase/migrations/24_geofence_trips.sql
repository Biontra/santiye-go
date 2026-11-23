begin;
create table public.geofence_trips (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  origin_lat float8 not null check(origin_lat between -90 and 90),
  origin_lng float8 not null check(origin_lng between -180 and 180),
  dest_lat float8 not null check(dest_lat between -90 and 90),
  dest_lng float8 not null check(dest_lng between -180 and 180),
  origin_radius integer not null default 250 check(origin_radius between 1 and 5000),
  dest_radius integer not null default 300 check(dest_radius between 1 and 5000),
  plate text not null check(length(trim(plate)) between 2 and 16),
  target integer not null check(target > 0),
  phase text not null default 'WAITING', revision integer not null default 0,
  origin jsonb, departed timestamptz, receipts jsonb not null default '[]'
);
alter table public.geofence_trips enable row level security;
revoke all on public.geofence_trips from public, anon, authenticated;
grant select on public.geofence_trips to authenticated;
grant insert(booking_id,origin_lat,origin_lng,dest_lat,dest_lng,origin_radius,dest_radius,plate,target)
  on public.geofence_trips to authenticated;
create policy trip_participants on public.geofence_trips for select to authenticated using (
  exists(select 1 from public.bookings b join public.companies c on c.id=b.company_id
    where b.id=booking_id and auth.uid() in (b.buyer_id,c.user_id)));
create function public.trip_distance(a float8,b float8,c float8,d float8) returns float8
language sql immutable strict as $$
  select 12742000 * asin(sqrt(least(1.0, sin(radians(a-c)/2)^2 +
    cos(radians(a))*cos(radians(c))*sin(radians(b-d)/2)^2)))
$$;
create policy trip_company_setup on public.geofence_trips for insert to authenticated with check (
  public.trip_distance(origin_lat,origin_lng,dest_lat,dest_lng)>origin_radius+dest_radius
  and exists(select 1 from public.bookings b join public.companies c on c.id=b.company_id
    where b.id=booking_id and c.user_id=auth.uid() and b.status in ('approved','confirmed')));

create function public.record_trip_point(p_booking uuid,p_revision integer,p_lat float8,p_lng float8)
returns void language plpgsql security definer set search_path='' as $$
declare
  t public.geofence_trips;
  point jsonb := jsonb_build_object('lat',p_lat,'lng',p_lng);
  at_origin boolean;
  at_dest boolean;
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
  at_origin := public.trip_distance(p_lat,p_lng,t.origin_lat,t.origin_lng)<=t.origin_radius;
  at_dest := public.trip_distance(p_lat,p_lng,t.dest_lat,t.dest_lng)<=t.dest_radius;
  if t.phase in ('WAITING','RETURNING') and at_origin then
    t.phase := 'AT_ORIGIN'; t.origin := point;
  elsif t.phase='AT_ORIGIN' and not at_origin then
    t.phase := 'IN_TRANSIT'; t.departed := clock_timestamp();
  elsif t.phase='IN_TRANSIT' and at_dest then
    t.phase := 'AT_DESTINATION';
    t.receipts := t.receipts || jsonb_build_object('departed',t.departed,'arrived',clock_timestamp(),
      'plate',t.plate,'origin',t.origin,'destination',point);
  elsif t.phase='AT_DESTINATION' and not at_dest then
    t.phase := 'RETURNING';
  else return;
  end if;
  update public.geofence_trips set phase=t.phase,origin=t.origin,departed=t.departed,receipts=t.receipts,
    revision=t.revision+1 where booking_id=p_booking;
end $$;
revoke all on function public.record_trip_point(uuid,integer,float8,float8) from public,anon;
grant execute on function public.record_trip_point(uuid,integer,float8,float8) to authenticated;
notify pgrst,'reload schema';
commit;
