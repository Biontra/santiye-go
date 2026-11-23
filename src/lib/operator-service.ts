import { createClient } from '@/lib/supabase/client';

export const machines = ['Ekskavatör','Beko Loder (JCB)','Kule Vinç','Greyder','Finişer','Telehandler','Forklift','Mobil Vinç'] as const;
export const licenses = ['G Sınıfı','CE','SRC 3/4','MYK Belgeli','Psikoteknik'] as const;
export interface OperatorCard {
  id:string; full_name:string; city:string; district:string; machine_types:string[]; license_classes:string[];
  experience_years:number; daily_rate:number; is_available:boolean; reference_projects:string; rating:number|null; verified:boolean;
}
export interface Operator extends OperatorCard { user_id:string; phone:string; lat:number|null; lng:number|null }
export interface OperatorRequest { id:string; site:string; start_date:string; days:number; note:string }
export const examples:OperatorCard[] = [
  {id:'demo-1',full_name:'Murat Kaya',city:'İstanbul',district:'Pendik',machine_types:[machines[0],machines[1]],license_classes:[licenses[0],licenses[3]],experience_years:12,daily_rate:3500,is_available:true,reference_projects:'Konut temeli ve altyapı kazıları',rating:4.8,verified:true},
  {id:'demo-2',full_name:'Selin Aras',city:'Ankara',district:'Çankaya',machine_types:[machines[2],machines[7]],license_classes:[licenses[0],licenses[3]],experience_years:8,daily_rate:4200,is_available:false,reference_projects:'Hastane şantiyesinde vinç operasyonları',rating:4.9,verified:true},
  {id:'demo-3',full_name:'Ali Deniz',city:'İzmir',district:'Aliağa',machine_types:[machines[5],machines[6]],license_classes:[licenses[0],licenses[4]],experience_years:5,daily_rate:2800,is_available:true,reference_projects:'Liman deposunda yükleme ve istif',rating:null,verified:false}
];
export async function directory():Promise<OperatorCard[]> {
  const db=createClient(), rows:OperatorCard[]=[];
  for(let offset=0;;offset+=200){
    const {data,error}=await db.from('operator_directory').select('*').order('id').range(offset,offset+199);
    if(error)throw new Error(error.message);
    rows.push(...data);
    if(data.length<200)return rows.length?rows:examples;
  }
}
export function fold(value:string){return value.trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');}
export function today(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});}
export async function sendRequest(id:string,values:Omit<OperatorRequest,'id'>){
  const db=createClient();
  if(!(await db.auth.getUser()).data.user)throw new Error('Talep göndermek için giriş yapın.');
  const {error}=await db.from('operator_requests').insert({...values,operator_id:id});
  if(error)throw new Error('Talep kaydedilemedi. Operatörün müsaitliğini ve tarihi kontrol edin.');
}
