export const categories = ['Beton & Demir','Duvar & Kaba Yapı','Boya & Yalıtım','İş Makinesi Kiralama','Elektrik & Tesisat','Diğer'] as const;
export const units = ['Ton','m³','m²','Adet','Torba','Kova','Gün'] as const;
export type Category = typeof categories[number];
export interface Item { id:string; item_name:string; category:Category; quantity:number; unit:typeof units[number]; notes:string; selected:boolean }
export const sample = [
  "12'lik Nervürlü İnşaat Demiri — 10 ton",
  'Hazır beton 45 m³ (C30)', 'Gazbeton blok 800 adet', 'İç cephe boyası 6 kova (Filli Boya)',
  'Ekskavatör kiralama 3 gün', 'Elektrik panosu 2 adet'
].join('\n');
export function blank():Item {
  return {id:crypto.randomUUID(),item_name:'',category:'Diğer',quantity:0,unit:'Adet',notes:'',selected:true};
}
export const fold=(s:string)=>s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
const rules=[/demir|celik|hazir beton|beton|cimento/,/tugla|gazbeton|bims|alci|duvar|kalip|kum|cakil/,/boya|yalitim|izolasyon|mantolama/,/kiralama|ekskavator|vinc|loder|jcb|forklift|greyder/,/elektrik|pano|kablo|tesisat|boru|priz/];
function category(name:string):Category {
  const s=fold(name);
  if(/gazbeton/.test(s))return categories[1];
  const i=rules.findIndex(r=>r.test(s));return categories[i<0?5:i];
}
const aliases:Record<string,Item['unit']>={ton:'Ton',t:'Ton',m3:'m³','m³':'m³',metrekup:'m³',m2:'m²','m²':'m²',metrekare:'m²',adet:'Adet',ad:'Adet',torba:'Torba',kova:'Kova',gun:'Gün'};
const number=(s:string)=>Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s.replace(/^(\d{1,3})\.(\d{3})$/,'$1$2'));
// ReDoS koruması: aşağıdaki regex'ler (rakam/boşluk/parantez dizileri) uzun tek satırda O(n²) çalışır;
// 100 KB'lık tek bir satır sunucuyu ~34 sn kilitleyebiliyordu. Satır/hücre/kolon/satır sayısı sınırlanır.
// (Sayfa zaten en fazla 200 kalem kabul eder; 250 satırdan fazlası okunmaz.)
export const BOQ_LIMITS={maxRows:250,maxCols:20,maxCell:400,maxTitle:600,maxFirstLine:2000} as const;
// CSV escaping also covers multiline quoted fields exported by Excel.
function records(text:string,delimiter:string){
  const {maxRows,maxCols,maxCell}=BOQ_LIMITS;
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  const endCell=()=>{if(row.length<maxCols)row.push(cell.trim());cell='';};
  for(let i=0;i<text.length&&rows.length<maxRows;i++){
    const c=text[i];
    if(c==='"' && (quoted || cell==='')){
      if(quoted && text[i+1]==='"'){if(cell.length<maxCell)cell+='"';i++;}else quoted=!quoted;
    }else if(!quoted && c===delimiter){endCell();}
    else if(!quoted && c==='\n'){endCell();rows.push(row);row=[];}
    else if(cell.length<maxCell)cell+=c;
  }
  if(rows.length<maxRows){endCell();rows.push(row);}
  return rows;
}
export function parseBoq(raw:string):Item[]{
  const text=raw.replace(/\r\n?/g,'\n').replace(/^\uFEFF/,'').trim();
  const first=text.split('\n',1)[0].slice(0,BOQ_LIMITS.maxFirstLine);
  const delim=first.includes('\t')?'\t':first.includes(';')?';':/,(?!\d)|,\d+(?:[.,]\d+)?,/.test(first)?',':'\0';
  const rows=records(text,delim), headers=rows[0].map(fold);
  const find=(r:RegExp)=>headers.findIndex(h=>r.test(h));
  const qty=find(/^(miktar|quantity|metraj)$/), name=find(/^(malzeme.*|kalem.*|is kalemi.*|urun.*|item_name|tanim|aciklama)$/);
  const unit=find(/^(birim|unit)$/), note=find(/^(not.*|marka|teknik detay)$/);
  const hasHeader=qty>=0 && name>=0;
  return (hasHeader?rows.slice(1):rows).filter(r=>r.some(Boolean)).map(c=>{
    const item=blank();
    let title=c.join(' ').slice(0,BOQ_LIMITS.maxTitle).replace(/^\s*(?:[-•*]|\d+[.)]\s)\s*/,'').trim();
    if(hasHeader){
      title=c[name]||'';item.quantity=number(c[qty]||'');item.unit=aliases[fold(c[unit]||'')]||'Adet';item.notes=c[note]||'';
      if(c[unit] && !aliases[fold(c[unit])]){item.notes+=' · Kaynak birim: '+c[unit];item.quantity=0;}
    }else{
      const pattern=/(\d+(?:[.,]\d+)*)\s*(ton|t|m[³3²2]|metreküp|metrekare|adet|ad|torba|kova|gün)(?![\p{L}\d])/iu;
      const match=title.match(pattern);
      if(match){item.quantity=number(match[1]);item.unit=aliases[fold(match[2])];title=title.replace(match[0],'');}
      else if(c.length>=3 && aliases[fold(c[1])] && Number.isFinite(number(c[2]))){
        title=c[0];item.quantity=number(c[2]);item.unit=aliases[fold(c[1])];item.notes=c.slice(3).join(' ');
      }
      title=title.replace(/\(([^)]+)\)/g,(_,n)=>{item.notes=[item.notes,n].filter(Boolean).join('; ');return '';});
    }
    item.item_name=title.replace(/^[\s—–:,-]+|[\s—–:,-]+$/g,'').replace(/\s+/g,' ');
    item.category=category(item.item_name);if(!Number.isFinite(item.quantity))item.quantity=0;
    return item;
  });
}
