// Word / RTF / ODT / old .doc reader and the test-bank parser.
// Taken from Gömrük Akademiyası V1.5 (the offline version) unchanged, only the
// zip reader underneath is now JSZip instead of the hand-written one.
import JSZip from 'jszip';

const fail = (m) => { throw new Error(m); };
async function readZip(blob, limits = {}) {
  if (blob.size > (limits.maxBytes || 100 * 1024 * 1024)) fail('Word faylı həddən böyükdür');
  let zip;
  try { zip = await JSZip.loadAsync(await blob.arrayBuffer()); }
  catch { fail('Fayl etibarlı Word (zip) arxivi deyil'); }
  const maxOutput = limits.maxOutput || 260 * 1024 * 1024;
  let used = 0;
  const take = (n) => { used += n; if (used > maxOutput) fail('Word arxivində həddən böyük məzmun var'); };
  const entry = (p) => zip.file(p) || null;
  return {
    list: () => Object.keys(zip.files),
    bytes: async (p) => { const f = entry(p); if (!f) return null; const b = await f.async('uint8array'); take(b.length); return b; },
    text: async (p) => { const f = entry(p); if (!f) return null; const t = await f.async('string'); take(t.length); return t; }
  };
}


/* Gömrük Akademiyası V1.2. Word DOCX reader and exam-bank converter.
   Offline only. Does not execute Office macros, external links, or embedded code.
   Do not infer correctness: red-font answer or explicit key is required.
*/
const GAWord=(()=>{
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const q=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Ə/g,'E').replace(/ə/g,'e').replace(/ı/g,'i').replace(/İ/g,'I').toUpperCase().replace(/\s+/g,' ').trim();
const child=(node,name)=>Array.from(node?.children||[]).find(c=>c.namespaceURI===W&&c.localName===name)||null;
const children=(node,name)=>Array.from(node?.children||[]).filter(c=>c.namespaceURI===W&&c.localName===name);
const val=node=>node?.getAttributeNS(W,'val')||node?.getAttribute('w:val')||node?.getAttribute('val')||'';
function xml(src,label){const p=new DOMParser().parseFromString(src,'application/xml');if(p.querySelector('parsererror'))throw Error(label+' sənədinin Word XML məzmunu oxunmadı');return p}
function redColor(run){const pr=child(run,'rPr'),c=child(pr,'color'),hex=(val(c)||'').replace('#','');if(!/^[a-fA-F0-9]{6}$/.test(hex))return false;const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);return r>=140&&r>g*1.42&&r>b*1.30&&r-g>=65}
function runText(run){const out=[];function walk(n){for(const c of Array.from(n?.children||[])){if(c.namespaceURI===W){if(['t','delText','instrText'].includes(c.localName)){if(c.localName==='t')out.push(c.textContent||'')}else if(c.localName==='tab')out.push('  ');else if(c.localName==='br'||c.localName==='cr')out.push(c.getAttributeNS(W,'type')==='page'?'\f':'\n');else if(c.localName==='lastRenderedPageBreak')out.push('\f');else if(c.localName==='noBreakHyphen')out.push('‑');else if(c.localName==='softHyphen')out.push('\u00ad');else if(c.localName!=='drawing'&&c.localName!=='pict')walk(c)}else walk(c)}}walk(run);return out.join('')}
function textParts(p){const parts=[];function visit(node){for(const c of Array.from(node?.children||[])){if(c.namespaceURI===W&&c.localName==='r'){const t=runText(c);parts.push({text:t,red:redColor(c),node:c});}else if(c.namespaceURI===W&&c.localName==='hyperlink')visit(c);else if(c.namespaceURI===W&&['ins','smartTag','sdt','sdtContent','fldSimple'].includes(c.localName))visit(c)}}visit(p);return parts}
function numMaps(numXml){const abstract=new Map(),numId=new Map(),counters=new Map();if(!numXml)return {prefix:()=>''};const doc=xml(numXml,'numbering');for(const el of doc.getElementsByTagNameNS(W,'abstractNum')){const id=el.getAttributeNS(W,'abstractNumId');const lvls=new Map();for(const lvl of children(el,'lvl')){const index=Number(lvl.getAttributeNS(W,'ilvl')||0);lvls.set(index,{format:val(child(lvl,'numFmt'))||'decimal',text:val(child(lvl,'lvlText'))||'%1.',start:Number(val(child(lvl,'start'))||1)})}abstract.set(id,lvls)}for(const el of doc.getElementsByTagNameNS(W,'num'))numId.set(el.getAttributeNS(W,'numId'),val(child(el,'abstractNumId')));return {prefix(p){const pr=child(p,'pPr'),np=child(pr,'numPr'),id=val(child(np,'numId'));if(!id)return '';const level=Number(val(child(np,'ilvl'))||0);const levels=abstract.get(numId.get(id));const rule=levels?.get(level);if(!rule)return '• ';if(rule.format==='bullet')return '• ';const key=id+':'+level;const count=(counters.has(key)?counters.get(key)+1:rule.start);counters.set(key,count);for(let deeper=level+1;deeper<9;deeper++)counters.delete(id+':'+deeper);let result=rule.text.replace(/%([1-9])/g,(_,n)=>{const k=id+':'+(Number(n)-1);return String(counters.get(k)||count)});if(rule.format==='lowerLetter')result=result.replace(String(count),String.fromCharCode(96+(count-1)%26+1));return result+' '}}}
function stylesheet(){return `<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{scroll-behavior:smooth}body{font:15px/1.65 Cambria,\"Times New Roman\",serif;color:#26343d;padding:28px 35px;margin:0 auto;max-width:990px;background:#fff;overflow-wrap:anywhere}h1,h2,h3{font-family:Cambria,serif;color:#173f55;line-height:1.4;margin:20px 0 10px}h1{font-size:25px}h2{font-size:21px}h3{font-size:18px}p{white-space:pre-wrap;margin:0 0 10px}table{border-collapse:collapse;max-width:100%;width:100%;margin:15px 0}td,th{border:1px solid #a3aab1;padding:7px;vertical-align:top}td p{margin:0 0 4px}img{max-width:100%;height:auto;display:inline-block}div.docpage{border-bottom:1px dotted #c3cbd1;padding-bottom:22px;margin-bottom:24px}div.docpage:last-child{border:0}@media print{body{padding:0}div.docpage{break-after:page;border:0}}</style></head><body>`}
async function fromDocx(file){
 if(!file||!/\.(docx|docm|dotx|dotm)$/i.test(file.name))throw Error('Seçilmiş fayl DOCX/ DOCM/ DOTX/ DOTM formatında deyil');
 const za=await readZip(file, {maxBytes:100*1024*1024,maxOutput:260*1024*1024});
 const word=await za.text('word/document.xml');if(!word)throw Error('Bu fayl etibarlı .docx Word sənədi deyil');
 const root=xml(word,'Word'),body=root.getElementsByTagNameNS(W,'body')[0];if(!body)throw Error('Word sənədinin əsas mətni yoxdur');
 const numbers=numMaps((await za.text('word/numbering.xml'))||'');const rels=new Map();
 const relsrc=await za.text('word/_rels/document.xml.rels');if(relsrc){const d=xml(relsrc,'Word əlaqələri');for(const r of d.getElementsByTagName('Relationship')){if(r.getAttribute('TargetMode')==='External')continue;const id=r.getAttribute('Id'),target=r.getAttribute('Target');if(id&&target&&!target.includes('..')&&!target.startsWith('/')&&!target.includes(':'))rels.set(id,'word/'+target.replace(/^\.\//,''))}}
 const mediaCache=new Map();let mediaTotal=0;
 async function imageFor(node){const blip=node.getElementsByTagNameNS(A,'blip')[0];if(!blip)return '';const id=blip.getAttributeNS(R,'embed');let path=rels.get(id);if(!path||!/^word\/(media|embeddings)\//.test(path))return '';const ext=path.split('.').pop().toLowerCase();const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'}[ext];if(!mime)return '';if(mediaCache.has(path))return mediaCache.get(path);const b=await za.bytes(path);if(!b||b.length>8*1024*1024||mediaTotal+b.length>22*1024*1024)return '';mediaTotal+=b.length;const blocks=[];for(let i=0;i<b.length;i+=8192)blocks.push(String.fromCharCode(...b.subarray(i,i+8192)));const src=`data:${mime};base64,${btoa(blocks.join(''))}`;mediaCache.set(path,src);return src}
 async function toParagraph(p){let str='',raw='',parts=[];const num=numbers.prefix(p);if(num){str+=esc(num);raw+=num}for(const part of textParts(p)){let t=part.text;raw+=t;parts.push({text:t,red:part.red});let h=esc(t).replace(/\n/g,'<br>').replace(/\f/g,'<hr style="border:0;border-top:1px dashed #a0b4bf">');const pr=child(part.node,'rPr');if(child(pr,'b'))h=`<strong>${h}</strong>`;if(child(pr,'i'))h=`<em>${h}</em>`;if(child(pr,'u'))h=`<u>${h}</u>`;if(child(pr,'vertAlign')&&val(child(pr,'vertAlign'))==='superscript')h=`<sup>${h}</sup>`;if(child(pr,'vertAlign')&&val(child(pr,'vertAlign'))==='subscript')h=`<sub>${h}</sub>`;const col=val(child(pr,'color'));if(/^[a-fA-F0-9]{6}$/.test(col)&&(parseInt(col.slice(0,2),16)*299+parseInt(col.slice(2,4),16)*587+parseInt(col.slice(4,6),16)*114)/1000<215)h=`<span style="color:#${col}">${h}</span>`;const highlight=val(child(pr,'highlight'));if(/^(yellow|green|cyan|magenta|red|blue|gray)$/i.test(highlight))h=`<span style="background-color:${highlight}">${h}</span>`;const sz=Number(val(child(pr,'sz')));if(sz>=12&&sz<=120)h=`<span style="font-size:${sz/2}pt">${h}</span>`;str+=h;for(const d of Array.from(part.node.getElementsByTagNameNS(W,'drawing'))) {const src=await imageFor(d);if(src)str+=`<img loading="lazy" alt="Word sənədində şəkil" src="${src}">`}}
 const ps=val(child(child(p,'pPr'),'pStyle'));const k=q(ps).replace(/ /g,'');const tag=/^(TITLE|BASL1|HEADING1|HEADING2|HEADING3|BASL2|BASL3)/.test(k)?(/(3)$/.test(k)?'h3':/(2)$/.test(k)?'h2':'h1'):'p';const clean=raw.replace(/\f/g,'\n');const redCount=parts.reduce((a,r)=>a+(r.red?r.text.length:0),0);const printable=parts.reduce((a,r)=>a+r.text.length,0);const red=(redCount>0&&redCount/Math.max(1,printable)>=.38);return {html:`<${tag}>${str||'&nbsp;'}</${tag}>`,text:clean,red,parts};
 }
 async function blocksIn(parent){const b=[];for(const el of Array.from(parent.children||[])){if(el.namespaceURI!==W)continue;if(el.localName==='p'){b.push({type:'paragraph',...(await toParagraph(el))})}else if(el.localName==='tbl'){const rows=[];for(const tr of children(el,'tr')){const cells=[];for(const tc of children(tr,'tc'))cells.push(await blocksIn(tc));rows.push(cells)}b.push({type:'table',rows})}else if(el.localName==='sdt'){const c=child(el,'sdtContent');if(c)b.push(...(await blocksIn(c)))}}
 return b}
 const blocks=await blocksIn(body),lines=[],pages=[[]];
 function addLine(txt,red){for(const part of txt.split(/[\n\f]/)){const t=part.trim();if(t)lines.push({text:t,red:!!red})}}
 function renderBlock(block){if(block.type==='paragraph'){addLine(block.text,block.red);const h=block.html;if(block.text.includes('\f')){pages.push([])}pages[pages.length-1].push(h);return}
 if(block.type==='table'){pages[pages.length-1].push('<table>');for(const row of block.rows){pages[pages.length-1].push('<tr>');const values=[];for(const cell of row){pages[pages.length-1].push('<td>');const content=cell.map(c=>c.type==='paragraph'?c.html:'').join('');pages[pages.length-1].push(content||'&nbsp;');pages[pages.length-1].push('</td>');const line=cell.filter(c=>c.type==='paragraph').map(c=>c.text.trim()).filter(Boolean).join(' ');const red=cell.some(c=>c.red);values.push({text:line,red})}
 if(values.length===2&&(/^(?:[A-Ea-e]|\d{1,4})\s*[.)\-:]?$/.test(values[0].text)||/^[A-Za-zƏəĞğİıIÖöŞşÜüÇç ]{2,35}:$/.test(values[0].text)))addLine(values[0].text+' '+values[1].text,values[1].red);
 else for(const v of values)if(v.text)addLine(v.text,v.red);
 pages[pages.length-1].push('</tr>')}pages[pages.length-1].push('</table>')}}
 for(const block of blocks)renderBlock(block);
 const html=stylesheet()+pages.map((p,i)=>`<div class="docpage" id="page=${i+1}">${p.join('\n')}</div>`).join('')+'</body></html>';
 const all=lines.map(x=>x.text).join('\n');const index=pages.length>1?pages.map((p,i)=>({page:i+1,text:all.slice(0,120000)})):[{page:1,text:all.slice(0,1200000)}];
 return {html,index,lines,count:lines.length,filename:file.name};
}
const aliases={'ID':'id','MENBE':'source','SOURCE':'source','MOVZU':'topic','CHAPTER':'topic','FESIL':'topic','DIFFICULTY':'difficulty','CETINLIK':'difficulty','NOV':'type','TYPE':'type','SUAL':'text','QUESTION':'text','DUZGUN CAVAB':'correct_answers','DUZGUN CAVABLAR':'correct_answers','CORRECT':'correct_answers','CORRECT ANSWER':'correct_answers','CAVAB':'correct_answers','ANSWER':'correct_answers','IZAH':'explanation','EXPLANATION':'explanation','HUQUQI ISTINAD':'reference','ISTINAD':'reference','REFERENCE':'reference'};
function parseAnswer(s){const t=q(s).replace(/[.\s]+$/,'').replace(/^(?:VARIANTLAR?|CAVABLAR?|ANSWER|OPTION)\s*[:\-]?\s*/,'').trim();if(!/^[A-E](?:\s*(?:[,;/+&]|VE|AND)\s*[A-E])*$/i.test(t))return [];return [...new Set(t.match(/[A-E]/g)||[])];}
function parseQuestions(lines){
 const out=[];let current=null,field='';
 const fresh=()=>({id:'',source:'',topic:'',difficulty:'',type:'unknown',text:'',options:[],correct_answers:[],explanation:'',reference:'',_red:[],_rawType:''});
 const ensure=()=>{if(!current)current=fresh();return current};
 function flush(){if(!current)return;
   if(current.text){
    if(!current.correct_answers.length&&current._red.length)current.correct_answers=[...new Set(current._red)];
    const kind=q(current._rawType);
    if(kind){if(/MULTI|COX|BIR NECE|BIRDEN/.test(kind))current.type='multiple';else if(/SINGLE|TEK|BIR DUZGUN|BIR CAVAB/.test(kind))current.type='single';else current.type='unknown'}
    else if(current.correct_answers.length>1)current.type='multiple';
    else if(current.correct_answers.length===1)current.type='single';
    delete current._red;delete current._rawType;out.push(current);
   }
   current=null;field='';
 }
 for(const row of lines||[]){
  const line=String(row?.text||'').replace(/\u00a0/g,' ').trim();if(!line)continue;
  // The example supplied by the user contains 'Sual 001 · BİR düzgün cavab' before ID.
  if(/^sual\s*(?:№\s*)?\d{1,5}\s*(?:(?:·|—|-|:)\s*.*)?$/iu.test(line)){
   if(current?.text)flush();ensure();field='';continue;
  }
  // Recognize A:, B:, C:, D:, E: before generic metadata: alternatives must not disappear.
  const opt=/^([A-Ea-e])\s*[).:–-]\s*(.*)$/u.exec(line);
  if(opt&&current?.text){
   const k=opt[1].toUpperCase();
   if(current.options.some(o=>o.key===k)){
    if(k==='A'){flush();ensure();}else {current.options[current.options.length-1].text+=' '+line;continue;}
   }
   current.options.push({key:k,text:opt[2].trim()});if(row.red)current._red.push(k);field='options';continue;
  }
  const label=/^([A-Za-zƏəĞğİıIÖöŞşÜüÇç\s]{2,40})\s*[:：]\s*(.*)$/u.exec(line);
  const key=label?aliases[q(label[1])]:null;
  if(key){
   if(key==='id'&&current?.id&&current.text)flush();
   if(key==='text'&&current?.text&&current.options.length)flush();
   ensure();let value=label[2].trim();
   if(key==='type'){current._rawType=value;field='type'}
   else if(key==='correct_answers'){current.correct_answers=parseAnswer(value);field='correct_answers'}
   else{current[key]+=(current[key]&&value?' ':'')+value;field=key}
   continue;
  }
  // Classic numbered questions in earlier training documents.
  const number=/^(?:SUAL\s*)?(\d{1,5})\s*[.):–-]\s*(.+)$/iu.exec(line);
  if(number&&(current===null||current.text&&current.options.length)){
    flush();ensure();current.text=number[2].trim();field='text';continue;
  }
  if(!current)continue;
  // Word may wrap answer variants into multiple paragraphs.
  if(field==='options'&&current.options.length){current.options[current.options.length-1].text+=' '+line;continue;}
  if(['text','explanation','reference','topic','source','difficulty'].includes(field)){
   current[field]+=(current[field]?' ':'')+line;continue;
  }
 }
 flush();return out;
}
return {fromDocx,parseQuestions};
})();

/* Offline legacy Word/RTF/OpenDocument/XML import, PDF documents. No network use.
   Older binary Word is interpreted as plain text: typography/layout not guaranteed. */
const GACompat=(()=>{
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ext=f=>(String(f?.name||'').split('.').pop()||'').toLowerCase();
 const TYPES='doc,docx,docm,dot,dotx,dotm,rtf,odt,ott,xml,txt';
 const docTypes=TYPES+',pdf';
 const maxSize=95*1024*1024;
 const makeText=(plain,filename)=>{
  const arr=String(plain||'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0006\u0008\u000e-\u001f]/g,'').split('\n');
  const lines=arr.map(x=>({text:x.trim(),red:false})).filter(x=>x.text);
  if(!lines.length)throw Error('Sənəddən oxuna bilən mətn alınmadı. Şifrəli və ya çox köhnə Word faylı ola bilər.');
  const html='<!doctype html><html lang="az"><head><meta charset="UTF-8"><style>body{font:16px/1.65 Cambria,"Times New Roman",serif;color:#173746;max-width:900px;margin:30px auto;padding:12px 25px}p{white-space:pre-wrap;margin:0 0 10px;overflow-wrap:anywhere}</style></head><body>'+lines.map(l=>'<p>'+escape(l.text)+'</p>').join('')+'</body></html>';
  return {html,index:[{page:1,text:lines.map(l=>l.text).join('\n').slice(0,1200000)}],lines,filename,format:'html'};
 };
 async function read(file,kind='document'){
  if(!file||!file.name)throw Error('Fayl seçilməyib');
  if(file.size>maxSize)throw Error('Faylın həcmi 95 MB-dan böyükdür');
  const e=ext(file);
  if(!TYPES.split(',').includes(e)&&!(e==='pdf'&&kind!=='test'))throw Error('Qəbul edilməyən fayl növü: .'+e);
  if(e==='pdf'){
   const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
   const magic=String.fromCharCode(...bytes);
   if(!magic.startsWith('%PDF-'))throw Error('Bu sənəd etibarlı PDF faylı deyil');
   return {format:'pdf',blob:file,sourceBlob:file,filename:file.name,index:[]};
  }
  // Some files are saved with the wrong ending (a modern Word file named .doc,
  // for example). Look at the first bytes instead of trusting the name.
  if(e!=='txt'&&e!=='xml'){
   const head=new Uint8Array(await file.slice(0,8).arrayBuffer());
   if(head[0]===0x50&&head[1]===0x4b&&head[2]===3&&head[3]===4&&!['docx','docm','dotx','dotm','odt','ott'].includes(e)){
    const asDocx=new File([file],String(file.name).replace(/\.[^.]+$/,'')+'.docx',{type:file.type});
    try{const r=await GAWord.fromDocx(asDocx);return {...r,filename:file.name,sourceBlob:kind==='test'?null:file};}
    catch(_e){const r=await fromODT(file).catch(()=>null);if(r)return {...r,sourceBlob:kind==='test'?null:file};throw _e}
   }
   const ole=[0xd0,0xcf,0x11,0xe0].every((b,i)=>head[i]===b);
   if(ole&&!['doc','dot'].includes(e))return {...makeText(fromOLE(new Uint8Array(await file.arrayBuffer())),file.name),sourceBlob:kind==='test'?null:file};
   const rtf=String.fromCharCode(...head.subarray(0,5))==='{\\rtf';
   if(rtf&&!['rtf','doc','dot'].includes(e))return {...makeText(fromRTF(new Uint8Array(await file.arrayBuffer())),file.name),sourceBlob:kind==='test'?null:file};
  }
  if(['docx','docm','dotx','dotm'].includes(e)){const r=await GAWord.fromDocx(file);return {...r,sourceBlob:kind==='test'?null:file};}
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(['doc','dot'].includes(e)){
   const head=new TextDecoder('windows-1252').decode(bytes.subarray(0,50));
   if(head.trimStart().startsWith('{\\rtf'))return {...makeText(fromRTF(bytes),file.name),sourceBlob:kind==='test'?null:file};
   return {...makeText(fromOLE(bytes),file.name),sourceBlob:kind==='test'?null:file};
  }
  if(e==='rtf')return {...makeText(fromRTF(bytes),file.name),sourceBlob:kind==='test'?null:file};
  if(['odt','ott'].includes(e)){const r=await fromODT(file);return {...r,sourceBlob:kind==='test'?null:file};}
  if(e==='xml')return {...fromWordXML(new TextDecoder().decode(bytes),file.name),sourceBlob:kind==='test'?null:file};
  return {...makeText(new TextDecoder('utf-8').decode(bytes),file.name),sourceBlob:kind==='test'?null:file};
 }
 function fromRTF(src){
  const rtf=new TextDecoder('windows-1252').decode(src);
  if(!rtf.trimStart().startsWith('{\\rtf'))throw Error('Bu fayl etibarlı RTF sənədi deyil');
  const cp=Number(/\\ansicpg(\d+)/.exec(rtf)?.[1]||1252);
  const charDecoder=new TextDecoder([1254,1252,1251,65001].includes(cp)?(cp===65001?'utf-8':'windows-'+cp):'windows-1252');
  const skipDest=new Set(['fonttbl','colortbl','stylesheet','pict','object','info','header','footer','footerl','footerr','headerl','headerr','listtable','listoverridetable','themedata','datastore','xmlnstbl','generator']);
  let out='',ignore=false,unicodeSkip=1,skipNext=0;const stack=[];
  for(let i=0;i<rtf.length;i++){
   let c=rtf[i];
   if(c==='{'){stack.push({ignore,unicodeSkip});continue}
   if(c==='}'){const st=stack.pop();if(st){ignore=st.ignore;unicodeSkip=st.unicodeSkip}continue}
   if(c==='\\'){
    const n=rtf[i+1];
    if(n==='\''&&/^[a-fA-F0-9]{2}$/.test(rtf.slice(i+2,i+4))){
      if(!ignore&&!skipNext)out+=charDecoder.decode(new Uint8Array([parseInt(rtf.slice(i+2,i+4),16)]));
      if(skipNext)skipNext--;i+=3;continue;
    }
    if(n==='\\'||n==='{'||n==='}') {if(!ignore&&!skipNext)out+=n;if(skipNext)skipNext--;i++;continue}
    if(n==='*'){ignore=true;i++;continue}
    if(!/[a-zA-Z]/.test(n||'')){if(n==='~'&&!ignore)out+=' ';if(n==='_'&&!ignore)out+='‑';i++;continue}
    const match=/^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i+1));
    if(!match){continue}
    const [full,word,param]=match;i+=full.length;
    if(skipDest.has(word))ignore=true;
    if(word==='uc'&&param)unicodeSkip=Math.min(20,Math.max(0,+param));
    if(ignore)continue;
    if(word==='u'&&param){let point=Number(param);if(point<0)point+=65536;out+=String.fromCharCode(point);skipNext=unicodeSkip;continue}
    if(word==='par'||word==='line'||word==='row')out+='\n';
    else if(word==='tab'||word==='cell')out+='\t';
    else if(word==='emdash')out+='—';else if(word==='endash')out+='–';else if(word==='bullet')out+='•';
    continue;
   }
   if(ignore||c==='\r'||c==='\n')continue;
   if(skipNext){skipNext--;continue}out+=c;
  }
  return out;
 }
 async function fromODT(file){
  const za=await readZip(file,{maxBytes:maxSize,maxOutput:250*1024*1024});
  const src=await za.text('content.xml');if(!src)throw Error('ODT sənədində content.xml yoxdur');
  const doc=new DOMParser().parseFromString(src,'application/xml');if(doc.querySelector('parsererror'))throw Error('ODT XML formatı yanlışdır');
  const blocks=[];
  function walk(el){
   for(const child of el.children){
    if(['p','h'].includes(child.localName)){const s=child.textContent?.trim();if(s)blocks.push(s)}
    else if(child.localName==='table-row'){
     const columns=Array.from(child.children).filter(x=>x.localName==='table-cell').map(c=>c.textContent.trim());
     if(columns.length===2&&/^[A-E]:?$/.test(columns[0]))blocks.push(columns[0]+': '+columns[1]);
     else blocks.push(columns.join('\t'));
    }
    else if(child.localName!=='table-cell')walk(child);
   }
  }
  const text=doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0','text')[0];
  walk(text||doc.documentElement);return makeText(blocks.join('\n'),file.name);
 }
 function fromWordXML(src,name){
  const p=new DOMParser().parseFromString(src,'application/xml');if(p.querySelector('parsererror'))throw Error('Word XML faylı düzgün deyil');
  const text=[];for(const el of Array.from(p.getElementsByTagName('*'))){
   if(el.localName==='p'){
    const runs=Array.from(el.getElementsByTagName('*')).filter(x=>['t','tab','br'].includes(x.localName));
    const s=runs.map(x=>x.localName==='tab'?'\t':x.localName==='br'?'\n':x.textContent).join('').trim();
    if(s)text.push(s);
   }
  }
  return makeText(text.join('\n'),name);
 }
 // Compound File Binary (CFB) reader: Microsoft Word 97-2003 DOC/ DOT files.
 function fromOLE(data){
  const dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(data.length<512||[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].some((b,i)=>data[i]!==b))
   throw Error('Bu .doc faylı standart Word 97–2003 sənədi deyil və ya zədələnib');
  const u16=(a)=>a>=0&&a+2<=data.length?dv.getUint16(a,true):0;
  const u32=(a)=>a>=0&&a+4<=data.length?dv.getUint32(a,true):0xFFFFFFFF;
  const ss=1<<u16(0x1e),ms=1<<u16(0x20);
  if(![512,4096].includes(ss)||ms!==64)throw Error('Köhnə Word faylının sektor formatı dəstəklənmir');
  const sector=(n)=>{const start=(n+1)*ss;if(n>=data.length/ss||start+ss>data.length)throw Error('Word sektorları zədələnib');return data.subarray(start,start+ss)};
  const END=0xFFFFFFFE,FREE=0xFFFFFFFF;
  const sectors=[];for(let i=0;i<109;i++){const n=u32(0x4c+4*i);if(n!==FREE)sectors.push(n)}
  let difat=u32(0x44),difatN=u32(0x48);
  for(let k=0;k<difatN&&k<200&&difat!==END&&difat!==FREE;k++){
   const b=sector(difat),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
   for(let i=0;i<ss/4-1;i++){let n=v.getUint32(i*4,true);if(n!==FREE)sectors.push(n)}
   difat=v.getUint32(ss-4,true);
  }
  const fat=[];for(const n of sectors){const buf=sector(n),v=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);for(let i=0;i<ss;i+=4)fat.push(v.getUint32(i,true))}
  function chain(start,table= fat,limit=20000){const list=[],seen=new Set();let i=start;
   while(i!==END&&i!==FREE&&i!==0xFFFFFFFD&&i<table.length&&list.length<limit){if(seen.has(i))throw Error('Zədələnmiş Word sektor zənciri');list.push(i);seen.add(i);i=table[i]}
   return list;
  }
  function bigStream(start,len){if(len>maxSize)throw Error('DOC məzmunu çox böyükdür');const ids=chain(start,fat,Math.ceil(len/ss)+2),out=new Uint8Array(len);let pos=0;
   for(const id of ids){const b=sector(id),n=Math.min(len-pos,ss);out.set(b.subarray(0,n),pos);pos+=n;if(pos>=len)break}
   if(pos<len)throw Error('Word faylı natamamdır');return out;
  }
  const dir=bigStream(u32(0x30),Math.min(data.length,Math.max(ss,chain(u32(0x30)).length*ss)));
  const dView=new DataView(dir.buffer);
  const entries=new Map();let root=null;
  for(let off=0;off+128<=dir.length;off+=128){const length=dView.getUint16(off+64,true),typ=dir[off+66];if(length<2||length>64||!typ)continue;
   const raw=dir.subarray(off,off+length-2),name=new TextDecoder('utf-16le').decode(raw);
   const start=dView.getUint32(off+116,true),size=dView.getUint32(off+120,true);
   const obj={name,start,size,typ};entries.set(name,obj);if(typ===5)root=obj;
  }
  const word=entries.get('WordDocument');if(!word)throw Error('Bu DOC arxivində WordDocument məzmunu yoxdur');
  const miniFatStart=u32(0x3c),miniFatCount=u32(0x40),miniFAT=[];
  if(miniFatCount&&miniFatStart!==END&&miniFatStart!==FREE){const raw=bigStream(miniFatStart,miniFatCount*ss),v=new DataView(raw.buffer);for(let i=0;i+4<=raw.length;i+=4)miniFAT.push(v.getUint32(i,true))}
  let miniRoot=null;
  function stream(entry){if(!entry)return null;if(entry.size>=u32(0x38)||!root||!miniFAT.length)return bigStream(entry.start,entry.size);
   if(!miniRoot)miniRoot=bigStream(root.start,root.size);
   const ids=chain(entry.start,miniFAT,Math.ceil(entry.size/ms)+2),out=new Uint8Array(entry.size);let p=0;
   for(const id of ids){const start=id*ms,n=Math.min(ms,entry.size-p);if(start+n>miniRoot.length)throw Error('DOC mini sektor xətası');out.set(miniRoot.subarray(start,start+n),p);p+=n;if(p>=entry.size)break}
   if(p<entry.size)throw Error('DOC mini sektor tam deyil');return out;
  }
  const doc=stream(word),d=new DataView(doc.buffer);if(doc.length<128)throw Error('WordDocument qısadır');
  if(d.getUint16(0,true)!==0xA5EC)throw Error('Yalnız Word 97–2003 ikili DOC dəstəklənir');
  const flags=d.getUint16(0x0a,true),table=stream(entries.get(flags&0x0200?'1Table':'0Table'))||stream(entries.get('0Table'))||stream(entries.get('1Table'));
  if(!table)throw Error('DOC üçün cədvəl məlumatları tapılmadı');
  const t=new DataView(table.buffer);
  function pieceAt(offset){
   if(offset<0||offset+5>table.length)return null;
   let i=offset;while(i<table.length){const b=table[i];if(b===0x01){if(i+3>table.length)return null;const n=t.getUint16(i+1,true);i+=3+n;continue}
    if(b!==0x02)return null;if(i+5>table.length)return null;
    const n=t.getUint32(i+1,true),p=i+5;if(n<16||n>10*1024*1024||(n-4)%12||p+n>table.length)return null;
    const count=(n-4)/12;if(count>100000)return null;
    const cps=[];for(let j=0;j<=count;j++)cps.push(t.getUint32(p+4*j,true));
    if(cps[0]!==0||cps.some((c,j)=>j>0&&c<cps[j-1])||!cps[count]||cps[count]>20*1024*1024)return null;
    let text='';const pcd=p+4*(count+1);
    for(let j=0;j<count;j++){
     const chars=cps[j+1]-cps[j],fc=t.getUint32(pcd+j*8+2,true),compressed=(fc&0x40000000)!==0;
     const off=(fc&0x3FFFFFFF)/(compressed?2:1),size=chars*(compressed?1:2);
     if(!Number.isInteger(off)||off<0||off+size>doc.length||size>50*1024*1024)return null;
     const data=doc.subarray(off,off+size);
     text+=new TextDecoder(compressed?'windows-1254':'utf-16le').decode(data);
    }
    return text;
   }
   return null;
  }
  // FIB fcClx/lcbClx entries, for Word 97-2003 index 33; fallback scan when producer differs.
  let text='';
  try{
   const csw=d.getUint16(32,true),cslwOff=34+csw*2,cslw=d.getUint16(cslwOff,true),cbOff=cslwOff+2+cslw*4;
   const pairs=d.getUint16(cbOff,true),start=cbOff+2;
   if(pairs>33&&start+(33*8+8)<=doc.length){const off=d.getUint32(start+33*8,true),len=d.getUint32(start+33*8+4,true);if(off+len<=table.length)text=pieceAt(off)||''}
  }catch(_e){}
  if(!text){for(let i=0;i<table.length-5&&i<10*1024*1024;i++){
    if(table[i]===0x02){const x=pieceAt(i);if(x&&x.length>text.length)text=x}
  }}
  if(!text)throw Error('Bu ikili Word sənədinin mətn hissəsi oxunmadı; müasir Word-də DOCX kimi saxlayın');
  return text.replace(/[\u0007]/g,'\t').replace(/[\u000d\u000b]/g,'\n').replace(/[\u0000-\u0006\u0008\u000e-\u001f]/g,'');
 }
 return {read,ext,types:TYPES,docTypes};
})();

export { GAWord, GACompat };
