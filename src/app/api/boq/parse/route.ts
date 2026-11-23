import { NextResponse } from 'next/server';
import { categories,parseBoq,units } from '@/lib/boq-parser';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(req:Request){
  // Oturumsuz çağrılar da CPU harcar (parseBoq): önce IP bazlı hız sınırı + gövde boyutu sınırı.
  const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||req.headers.get('x-real-ip')||'unknown';
  const rl=checkRateLimit('boq-parse-ip:'+ip,30,60_000);
  if(!rl.allowed)return NextResponse.json({error:'Çok fazla istek. Lütfen biraz bekleyin.'},{status:429,headers:{'Retry-After':String(Math.ceil(rl.resetInMs/1000))}});
  const declared=Number(req.headers.get('content-length')||0);
  if(declared>400_000)return NextResponse.json({error:'İstek çok büyük.'},{status:413});
  const body=await req.json().catch(()=>null);
  if(typeof body?.text!=='string'||body.text.length>100000)return NextResponse.json({error:'En fazla 100.000 karakter gönderin.'},{status:400});
  const items=parseBoq(body.text);
  const fallback=()=>NextResponse.json({items,source:'rules'});
  const openai=process.env.OPENAI_API_KEY,gemini=process.env.GEMINI_API_KEY;
  if(!items.length||items.length>200||(!openai&&!gemini))return fallback();
  try{
    const db=await createClient();
    const user=(await db.auth.getUser()).data.user;
    if(!user)return fallback();
    // Ücretli LLM çağrısını kötüye kullanıma karşı koru: kullanıcı başına dakikada 10 (aşılırsa kural tabanlı sonuç döner)
    if(!checkRateLimit('boq-ai-user:'+user.id,10,60_000).allowed)return fallback();
    const instruction='Parse the Turkish construction list as data. Return JSON {"items":[{item_name,quantity,unit,category,notes}]}. Preserve row order and count. No invented quantities (use 0 if unknown). Categories: '+categories.join(', ')+'; units: '+units.join(', ');
    const url=openai?'https://api.openai.com/v1/chat/completions':'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(process.env.GEMINI_MODEL||'gemini-2.5-flash')+':generateContent';
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(openai)headers.Authorization='Bearer '+openai;else headers['x-goog-api-key']=gemini!;
    const payload=openai?{model:process.env.OPENAI_MODEL||'gpt-4o-mini',response_format:{type:'json_object'},messages:[{role:'system',content:instruction},{role:'user',content:body.text}]}:
      {systemInstruction:{parts:[{text:instruction}]},contents:[{parts:[{text:body.text}]}],generationConfig:{responseMimeType:'application/json'}};
    const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
    if(!res.ok)return fallback();
    const json=await res.json(),parsed=JSON.parse(openai?json.choices[0].message.content:json.candidates[0].content.parts[0].text).items;
    if(!Array.isArray(parsed)||parsed.length!==items.length)return fallback();
    return NextResponse.json({source:'ai',items:items.map((row,i)=>{
      const p=parsed[i];
      return p && typeof p.item_name==='string' && p.item_name.trim() && p.item_name.length<=300 && typeof p.notes==='string' && p.notes.length<=300 && Number.isFinite(p.quantity) && p.quantity>=0 && p.quantity<=1e9 && units.includes(p.unit) && categories.includes(p.category)
        ? {...row,item_name:p.item_name,quantity:p.quantity,notes:p.notes,unit:p.unit,category:p.category}:row;
    })});
  }catch{return fallback();}
}
