begin;
create table public.boq_submissions (
 buyer_id uuid not null references public.profiles(id), token uuid not null,
 result jsonb, primary key(buyer_id,token)
);
alter table public.boq_submissions enable row level security;
revoke all on public.boq_submissions from public,anon,authenticated;

create function public.submit_boq(p_token uuid,p_items jsonb,p_city int,p_district int,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 buyer uuid:=auth.uid(); g record; v_parent uuid; request_id_new uuid; summary jsonb:='[]'; cached jsonb;
 slugs text[]; recipients integer;
begin
 if buyer is null then raise exception 'Oturum açın.'; end if;
 insert into public.boq_submissions values(buyer,p_token,null) on conflict do nothing;
 if not found then select s.result into cached from public.boq_submissions s where s.buyer_id=buyer and s.token=p_token; return cached; end if;
 if p_date is null or p_date<(now() at time zone 'Europe/Istanbul')::date or not exists(select from public.districts where id=p_district and city_id=p_city)
 then raise exception 'Teslim tarihi veya konum geçersiz.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 or octet_length(p_items::text)>250000 then raise exception '1–200 kalem seçin.'; end if;
 if exists(select from jsonb_to_recordset(p_items) r(item_name text,quantity numeric,unit text,category text)
 where coalesce(length(trim(item_name)),0)=0 or coalesce(quantity,0)<=0 or coalesce(unit,'') not in ('Ton','m³','m²','Adet','Torba','Kova','Gün')
 or coalesce(category,'') not in ('Beton & Demir','Duvar & Kaba Yapı','Boya & Yalıtım','İş Makinesi Kiralama','Elektrik & Tesisat','Diğer'))
 then raise exception 'Kalem bilgileri eksik.'; end if;
 for g in select v->>'category' cat, string_agg(concat(v->>'item_name',' — ',v->>'quantity',' ',v->>'unit',' ',v->>'notes'), E'\n' order by pos) description
   from jsonb_array_elements(p_items) with ordinality e(v,pos) group by v->>'category' order by 1 loop
   select id into strict v_parent from public.categories where slug=case when g.cat='İş Makinesi Kiralama' then 'is-makineleri' else 'yapi-malzemeleri' end;
   slugs:=case g.cat when 'Beton & Demir' then array['hazir-beton','demir-donati','cimento']
     when 'Duvar & Kaba Yapı' then array['tugla-bims','gazbeton','alci-siva','kum-cakil','kalip']
     when 'Boya & Yalıtım' then array['insaat-boyasi','yalitim-izolasyon']
     when 'Elektrik & Tesisat' then array['elektrik','tesisat','elektrik-malzemeleri','tesisat-malzemeleri'] else null end;
   insert into public.quote_requests(buyer_id,request_type,category_id,title,description,quantity,start_date,city_id,district_id,status)
    values(buyer,'multi_vendor',v_parent,'Keşif · '||g.cat,g.description,1,p_date,p_city,p_district,'sent') returning id into request_id_new;
   insert into public.quote_request_recipients(request_id,company_id)
    select request_id_new,l.company_id from public.listings l join public.categories c on c.id=l.category_id
    join public.companies co on co.id=l.company_id
    where l.status='active' and l.city_id=p_city and co.user_id<>buyer and (c.id=v_parent or c.parent_id=v_parent)
    and (slugs is null or c.slug=any(slugs) or (g.cat='Elektrik & Tesisat' and (c.slug like '%elektrik%' or c.slug like '%tesisat%')))
    group by l.company_id order by bool_or(l.district_id=p_district) desc nulls last,l.company_id limit 10
    on conflict do nothing;
   select count(*) into recipients from public.quote_request_recipients where request_id=request_id_new;
   summary:=summary||jsonb_build_object('category',g.cat,'request_id',request_id_new,'recipients',recipients);
 end loop;
 update public.boq_submissions s set result=summary where s.buyer_id=buyer and s.token=p_token;
 return summary;
end $$;
revoke all on function public.submit_boq(uuid,jsonb,int,int,date) from public,anon;
grant execute on function public.submit_boq(uuid,jsonb,int,int,date) to authenticated;
notify pgrst,'reload schema';
commit;
