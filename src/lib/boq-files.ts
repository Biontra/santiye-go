export async function readBoqFile(file:File):Promise<string>{
  if(file.size>10*1024*1024)throw new Error('En fazla 10 MB dosya yükleyin.');
  const ext=file.name.split('.').pop()?.toLowerCase();
  if(ext==='xlsx'){
    const {default:read}=await import('read-excel-file/browser');
    const sheets=await read(file);
    return sheets.map(s=>s.data.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join('\t')).join('\n')).join('\n');
  }
  if(ext==='pdf'){
    const pdf=await import('pdfjs-dist');
    pdf.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
    const task=pdf.getDocument({data:await file.arrayBuffer()});
    const doc=await task.promise;
    try{
      const lines:string[]=[];
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i),content=await page.getTextContent();let line='',y=NaN;
        for(const token of content.items){
          if(!('str' in token))continue;
          if(Math.abs(token.transform[5]-y)>3 && line){lines.push(line);line='';}
          y=token.transform[5];line+=' '+token.str;
          if(token.hasEOL){lines.push(line);line='';}
        }
        if(line)lines.push(line);
      }
      const text=lines.join('\n').trim();
      if(!text)throw new Error('PDF metin içermiyor. Taranmış belge için OCR metnini yapıştırın.');
      return text;
    }finally{await task.destroy();}
  }
  if(!['txt','csv','tsv'].includes(ext||''))throw new Error('XLSX, CSV, TSV, TXT veya PDF seçin.');
  return file.text();
}
