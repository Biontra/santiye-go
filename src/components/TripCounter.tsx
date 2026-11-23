'use client';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { distances, nextPhase, type Point, type Route, type Trip } from '@/lib/geofence-trip-service';

const labels = { WAITING: 'Şantiyeye giriş bekleniyor', AT_ORIGIN: 'Şantiyede yüklendi', IN_TRANSIT: 'Döküm sahasına gidiyor', AT_DESTINATION: 'Döküm sahasında', RETURNING: 'Şantiyeye dönüyor' };
const fields = [
  ['origin_lat','Şantiye enlemi'], ['origin_lng','Şantiye boylamı'], ['origin_radius','Şantiye yarıçapı (m)'],
  ['dest_lat','Döküm enlemi'], ['dest_lng','Döküm boylamı'], ['dest_radius','Döküm yarıçapı (m)'],
  ['target','Hedef sefer'], ['plate','Plaka']
] as const;
const button = 'min-h-12 rounded-lg bg-orange-600 px-4 font-bold text-white disabled:opacity-50';
const demoRoute: Route = {origin_lat:39.9,origin_lng:32.8,dest_lat:39.91,dest_lng:32.81,origin_radius:250,dest_radius:300,target:20,plate:'DEMO'};
const formatTime = (s: string) => new Date(s).toLocaleString('tr-TR');

export default function TripCounter({ id, driver = false }: {id: string; driver?: boolean}) {
  const [open,setOpen] = useState(false);
  return <section className="rounded-lg border border-slate-200 p-3 text-navy-900">
    <button type="button" aria-expanded={open} className="min-h-11 font-bold" onClick={()=>setOpen(!open)}>Canlı Sefer Sayacı {open?'▴':'▾'}</button>
    {open && <TripPanel id={id} driver={driver}/>}
  </section>;
}

function TripPanel({id,driver}:{id:string;driver:boolean}) {
  const [db] = useState(()=>createClient());
  const [live,setLive] = useState<Trip|null>(null);
  const [demo,setDemo] = useState<Trip|null>(null);
  const [gps,setGps] = useState<(Point & {time:number})|null>(null);
  const [sim,setSim] = useState<Point|null>(null);
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [gpsError,setGpsError] = useState('');
  const trip = demo || live;
  const demoMode = !!demo;
  const load = useCallback(async ()=>{
    const res = await db.from('geofence_trips').select('*').eq('booking_id',id).maybeSingle();
    if(res.error) {setError(res.error.message);return;}
    setLive(old=>old && res.data && old.revision>res.data.revision ? old : res.data);
    setReady(true);
  },[db,id]);
  useEffect(()=>{if(demoMode)return; void load(); const timer=setInterval(load,5000);return ()=>clearInterval(timer);},[load,demoMode]);
  useEffect(()=>{
    if(!driver || !live || demoMode)return;
    if(!navigator.geolocation){setGpsError('Bu cihaz GPS erişimini desteklemiyor.');return;}
    const watch=navigator.geolocation.watchPosition(p=>{
      setGps({lat:p.coords.latitude,lng:p.coords.longitude,time:p.timestamp});setGpsError('');
    },e=>{setGps(null);setGpsError(e.message);},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    return ()=>navigator.geolocation.clearWatch(watch);
  },[driver,!!live,demoMode]);
  const point = demo ? sim : gps;
  const next = trip && point ? nextPhase(trip,point) : null;
  const advance = async ()=>{
    if(!trip || !point || !next || next===trip.phase || busy)return;
    if(!demo && (!gps || Date.now()-gps.time>60000)){setError('Güncel GPS konumu bekleniyor.');return;}
    setBusy(true);setError('');
    try {
      if(demo){
        const now=new Date().toISOString();
        setDemo({...demo,phase:next,revision:demo.revision+1,
          origin:next==='AT_ORIGIN'?point:demo.origin,departed:next==='IN_TRANSIT'?now:demo.departed,
          receipts:next==='AT_DESTINATION'?[...demo.receipts,{departed:demo.departed!,arrived:now,plate:demo.plate,origin:demo.origin!,destination:point}]:demo.receipts});
      } else {
        const res=await db.rpc('record_trip_point',{p_booking:id,p_revision:trip.revision,p_lat:point.lat,p_lng:point.lng});
        if(res.error)throw res.error;
        await load();
      }
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  };
  useEffect(()=>{
    if((next==='IN_TRANSIT'||next==='RETURNING') && next!==trip?.phase)void advance();
    // A fresh fix or phase change may establish an exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[point,next,trip?.phase]);
  const ranges=trip && point ? distances(trip,point) : null;
  return <div className="grid gap-3 text-sm">
    {error && !demo && <p role="alert">{error}</p>}
    {!trip && ready && (driver ? <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e=>{
      e.preventDefault();const data=new FormData(e.currentTarget);
      const route=Object.fromEntries(fields.map(([key])=>[key,key==='plate'?String(data.get(key)).trim().toLocaleUpperCase('tr'):Number(data.get(key))]));
      setBusy(true);setError('');
      try {const res=await db.from('geofence_trips').insert({...route,booking_id:id});if(res.error)throw res.error;await load();}
      catch(err){setError((err as Error).message);}finally{setBusy(false);}
    }}>
      {fields.map(([key,label])=><label key={key}>{label}<input required name={key} type={key==='plate'?'text':'number'} step={key.endsWith('lat')||key.endsWith('lng')?'any':1}
        defaultValue={key==='origin_radius'?250:key==='dest_radius'?300:undefined} className="block w-full rounded border p-2"/></label>)}
      <button disabled={busy} className={button}>Güzergâhı kaydet</button>
    </form>:<p>Firma henüz sefer güzergâhı tanımlamadı.</p>)}
    {trip && <>
      <strong>Onaylı Sefer: {trip.receipts.length} / Hedef: {trip.target} Sefer</strong>
      <p>{trip.plate} · {labels[trip.phase]}</p>
      {driver && <>
        <p>{point ? 'GPS: '+point.lat.toFixed(5)+', '+point.lng.toFixed(5) : gpsError || 'GPS konumu bekleniyor…'}</p>
        {ranges && <div className="flex flex-wrap gap-3">{ranges.map((m,i)=><span key={i} className={m<=(i?trip.dest_radius:trip.origin_radius)?'font-bold text-green-700':''}>{i?'Döküm sahası':'Şantiye'}: {Math.round(m)} m</span>)}</div>}
        <button className={button} disabled={busy || next===trip.phase || (next!=='AT_ORIGIN' && next!=='AT_DESTINATION')} onClick={advance}>
          {next==='AT_DESTINATION' && trip.phase==='IN_TRANSIT'?'Konum Doğrulandı — Seferi Kaydet':next==='AT_ORIGIN' && next!==trip.phase?'Konum Doğrulandı — Yüklemeyi Kaydet':'Konum doğrulaması bekleniyor'}</button>
      </>}
      <ul aria-label="Dijital sefer fişleri">{trip.receipts.map((r,i)=><li key={i} className="border-t py-2">Fiş {i+1} · {r.plate} · Çıkış {formatTime(r.departed)} · Varış {formatTime(r.arrived)}</li>)}</ul>
    </>}
    {driver && <div className="space-x-2 border-t pt-2"><label><input type="checkbox" checked={demoMode} onChange={e=>{setSim(null);setGps(null);setDemo(e.target.checked?{...(live||demoRoute),phase:'WAITING',receipts:[],revision:0}:null);}}/> Demo / Konum Simüle Et</label>
      {demo && <>{['Şantiye','Döküm sahası'].map((s,i)=><button key={s} className="min-h-11 underline" onClick={()=>setSim({lat:i?demo.dest_lat:demo.origin_lat,lng:i?demo.dest_lng:demo.origin_lng})}>{s}</button>)}</>}
    </div>}
  </div>;
}
