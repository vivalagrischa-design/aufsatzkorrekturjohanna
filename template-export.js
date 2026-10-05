import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { validateReport, fileContent } from './correction.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(el,name)=>Array.from(el.childNodes).filter(x=>x.nodeType===1&&x.localName===name&&x.namespaceURI===W);
const text=el=>Array.from(el.getElementsByTagNameNS(W,'p')).map(p=>Array.from(p.getElementsByTagNameNS(W,'t')).map(x=>x.textContent).join('')).join(' ').replace(/\s+/g,' ').trim();
const norm=s=>s.replace(/\s+/g,' ').trim();
function fill(doc,cell,value){
 const p=children(cell,'p')[0]||cell.appendChild(doc.createElementNS(W,'w:p'));
 const oldRun=children(p,'r')[0];let props=oldRun&&children(oldRun,'rPr')[0];
 if(!props){const source=cell.parentNode?.getElementsByTagNameNS(W,'rPr')[0];if(source)props=source;}
 for(const node of Array.from(cell.childNodes))if(node.nodeType===1&&node.localName!=='tcPr'&&node!==p)cell.removeChild(node);
 for(const node of Array.from(p.childNodes))if(!(node.nodeType===1&&node.localName==='pPr'))p.removeChild(node);
 const run=doc.createElementNS(W,'w:r');if(props)run.appendChild(props.cloneNode(true));
 const t=doc.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.appendChild(doc.createTextNode(String(value)));run.appendChild(t);p.appendChild(run);
}
export async function templateReport(template,input){
 const report=validateReport(input);
 if(!template||!/\.docx$/i.test(template.name))throw new Error('Für den Export im Originallayout eine Word-Datei als Raster hochladen.');
 fileContent(template,'Word-Vorlage');
 const zip=await JSZip.loadAsync(Buffer.from(template.data,'base64'));
 const part=zip.file('word/document.xml');if(!part)throw new Error('Ungültige Word-Vorlage.');
 const xml=await part.async('string');const doc=new DOMParser().parseFromString(xml,'application/xml');
 const matched=new Set();let group=[];let totalCell;
 for(const table of Array.from(doc.getElementsByTagNameNS(W,'tbl'))){
  group=[];
  for(const row of children(table,'tr')){
   const cells=children(row,'tc');if(cells.length<3)continue;
   const label=text(cells[0]);
   if(/^Gesamtpunktzahl/i.test(label)){totalCell=cells[2];continue;}
   if(/^Erreichte Punkte/i.test(label)){
    const scores=group.map(i=>report.criteria[i].earned);
    fill(doc,cells[2],scores.length&&scores.every(x=>x!==null)?scores.reduce((a,b)=>a+b,0):'?');continue;
   }
   const index=report.criteria.findIndex((c,i)=>!matched.has(i)&&norm(c.name)===norm(label));
   if(index<0)continue;
   matched.add(index);group.push(index);const c=report.criteria[index];
   fill(doc,cells[2],c.earned===null?'?':c.earned);
   if(cells[3])fill(doc,cells[3],c.assessment);
  }
 }
 if(matched.size!==report.criteria.length)throw new Error('Raster und Word-Vorlage stimmen nicht vollständig überein. Keine Kriterien wurden übersprungen. Bitte die unveränderten Kriterien der Vorlage verwenden.');
 if(totalCell)fill(doc,totalCell,report.criteria.every(c=>c.earned!==null)?report.criteria.reduce((s,c)=>s+c.earned,0):'?');
 for(const cell of Array.from(doc.getElementsByTagNameNS(W,'tc'))){
  if(/^Anmerkungen\s*$/.test(text(cell)))fill(doc,cell,'Anmerkungen: '+report.summary);
 }
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
