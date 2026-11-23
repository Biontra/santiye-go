begin;
create table public.operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade default auth.uid(),
  full_name text not null check(length(trim(full_name)) between 2 and 100),
  phone text not null check(length(trim(phone)) between 7 and 25),
  city text not null check(length(trim(city)) between 1 and 80),
  district text not null check(length(trim(district)) between 1 and 80),
  lat float8 check(lat between -90 and 90), lng float8 check(lng between -180 and 180),
  machine_types text[] not null check(cardinality(machine_types)>0 and machine_types <@ array['Ekskavatör','Beko Loder (JCB)','Kule Vinç','Greyder','Finişer','Telehandler','Forklift','Mobil Vinç']),
  license_classes text[] not null default '{}',
  experience_years integer not null check(experience_years between 0 and 80),
  daily_rate numeric(12,2) not null check(daily_rate>=0),
  is_available boolean not null default true, reference_projects text not null default '',
  rating numeric(2,1) check(rating between 0 and 5), verified boolean not null default false,
  check ((lat is null)=(lng is null))
);
alter table public.operators enable row level security;
create policy operator_owner on public.operators for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.operators from public, anon, authenticated;
grant select on public.operators to authenticated;
grant insert(full_name,phone,city,district,lat,lng,machine_types,license_classes,experience_years,daily_rate,is_available,reference_projects),
 update(full_name,phone,city,district,lat,lng,machine_types,license_classes,experience_years,daily_rate,is_available,reference_projects)
 on public.operators to authenticated;
create view public.operator_directory as select id,full_name,city,district,machine_types,license_classes,
 experience_years,daily_rate,is_available,reference_projects,rating,verified from public.operators;
revoke all on public.operator_directory from public,anon,authenticated;
grant select on public.operator_directory to anon,authenticated;

create table public.operator_requests (
 id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators on delete cascade,
 requester_id uuid not null default auth.uid() references auth.users on delete cascade,
 site text not null check(length(trim(site)) between 2 and 300), start_date date not null,
 days integer not null check(days between 1 and 365), note text not null default '' check(length(note)<=2000),
 created_at timestamptz not null default now()
);
create index operator_requests_inbox on public.operator_requests(operator_id,created_at desc);
alter table public.operator_requests enable row level security;
revoke all on public.operator_requests from public,anon,authenticated;
grant select,insert(operator_id,site,start_date,days,note) on public.operator_requests to authenticated;
create policy read_requests on public.operator_requests for select to authenticated using(
 requester_id=auth.uid() or exists(select 1 from public.operators o where o.id=operator_id and o.user_id=auth.uid()));
create policy send_requests on public.operator_requests for insert to authenticated with check(
 requester_id=auth.uid() and start_date >= (now() at time zone 'Europe/Istanbul')::date
 and exists(select 1 from public.operator_directory o where o.id=operator_id and o.is_available)
 and not exists(select 1 from public.operators o where o.id=operator_id and o.user_id=auth.uid()));
notify pgrst,'reload schema';
commit;
