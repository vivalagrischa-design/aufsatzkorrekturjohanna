import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { validateReport, fileContent } from './correction.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const parseXml = xml => new DOMParser({ errorHandler: { warning() {}, error(message) { throw new Error(`Ungültige Excel-Struktur: ${message}`); }, fatalError(message) { throw new Error(`Ungültige Excel-Struktur: ${message}`); } } }).parseFromString(xml, 'application/xml');
const xmlText = el => Array.from(el.getElementsByTagNameNS(MAIN, 't')).map(x => x.textContent).join('');
const colNumber = ref => { let n=0; for (const c of ref.toUpperCase().match(/^[A-Z]+/)?.[0] || '') n=n*26+c.charCodeAt(0)-64; return n; };
function safeZip(zip) {
  const total = Object.values(zip.files).reduce((sum, f) => sum + (f._data?.uncompressedSize || 0), 0);
  if (total > 40 * 1024 * 1024) throw new Error('Die entpackte Excel-Datei ist zu gross (maximal 40 MB).');
}
function workbookParts(zip) {
  const workbookFile=zip.file('xl/workbook.xml'), relFile=zip.file('xl/_rels/workbook.xml.rels');
  if(!workbookFile||!relFile) throw new Error('Die Excel-Datei enthält keine lesbare Arbeitsmappe.');
  return Promise.all([workbookFile.async('string'),relFile.async('string')]).then(([w,r])=>({workbook:parseXml(w),rels:parseXml(r)}));
}
function worksheetTargets(workbook, rels) {
  const relById=new Map(Array.from(rels.getElementsByTagNameNS(PACKAGE_REL,'Relationship')).map(x=>[x.getAttribute('Id'),x.getAttribute('Target')]));
  return Array.from(workbook.getElementsByTagNameNS(MAIN,'sheet')).map(sheet=>{
    const target=relById.get(sheet.getAttributeNS(DOC_REL,'id'));
    if(!target) throw new Error('Ein Tabellenblatt kann nicht gelesen werden.');
    const path=target.startsWith('/')?target.slice(1):`xl/${target}`;
    if(!path.startsWith('xl/worksheets/')||path.includes('..')) throw new Error('Nicht unterstützter Pfad im Excel-Dokument.');
    return {name:sheet.getAttribute('name')||'Tabelle',path};
  });
}
function parseShared(xml) {
  if(!xml) return [];
  const doc=parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS(MAIN,'si')).map(xmlText);
}
function cellValue(cell, shared) {
  const type=cell.getAttribute('t');
  if(type==='inlineStr') return xmlText(cell);
  const v=cell.getElementsByTagNameNS(MAIN,'v')[0]?.textContent||'';
  if(type==='s') return shared[Number(v)]||'';
  return v;
}
export async function extractXlsx(file) {
  fileContent(file,'Excel-Datei');
  const zip=await JSZip.loadAsync(Buffer.from(file.data,'base64')); safeZip(zip);
  const {workbook,rels}=await workbookParts(zip);
  const shared=parseShared(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const pages=[];
  for(const sheet of worksheetTargets(workbook,rels)){
    const sheetFile=zip.file(sheet.path); if(!sheetFile) throw new Error(`Das Tabellenblatt «${sheet.name}» fehlt in der Excel-Datei.`);
    const doc=parseXml(await sheetFile.async('string'));
    const rows=[];
    for(const row of Array.from(doc.getElementsByTagNameNS(MAIN,'row'))){
      const cells=Array.from(row.getElementsByTagNameNS(MAIN,'c')).map(cell=>({column:colNumber(cell.getAttribute('r')),value:cellValue(cell,shared).replace(/\s+/g,' ').trim()}));
      const last=Math.max(0,...cells.map(x=>x.column));
      const values=Array(last).fill(''); for(const cell of cells) if(cell.column>0) values[cell.column-1]=cell.value;
      if(values.some(Boolean)) rows.push({values,text:values.join(' | ').trim()});
    }
    const text=rows.map(r=>r.text).join('\n');
    if(text) pages.push({name:sheet.name,text,ocr:false,warnings:[]});
  }
  if(!pages.length) throw new Error('Die Excel-Datei enthält keinen auslesbaren Tabelleninhalt.');
  const rubric=[];
  for(const page of pages) for(const line of page.text.split('\n')){
    const parts=line.split('|').map(x=>x.trim()).filter(Boolean);
    if(parts.length<2) continue;
    const numeric=parts.map((x,i)=>({i,value:Number(x.replace(',','.'))})).filter(x=>Number.isFinite(x.value)&&x.value>0&&x.value<=1000);
    const name=parts.find(x=>!Number.isFinite(Number(x.replace(',','.')))&&! /^(kriterium|bewertungskriterium|kriterien|punkte|max(?:imal)?punkte?)$/i.test(x));
    if(name&&numeric.length) rubric.push({name,maximum:numeric[0].value});
  }
  return {pages,rubric};
}

const excelCell=(ref,value)=>{
  const safe=String(value??'');
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${safe.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</t></is></c>`;
};
function reportWorksheet(report) {
  const rows=[];
  const row=(n,cells)=>`<row r="${n}">${cells.join('')}</row>`;
  rows.push(row(1,[excelCell('A1','Beurteilung des Aufsatzes')]));
  rows.push(row(2,[excelCell('A2',report.title)]));
  rows.push(row(4,[excelCell('A4','Gesamtbeurteilung'),excelCell('B4',report.summary)]));
  rows.push(row(5,[excelCell('A5','Notenvorschlag'),excelCell('B5',report.grade===null?'Keine Note':report.grade),excelCell('C5',report.grade_reason)]));
  rows.push(row(6,[excelCell('A6','Beurteilungsstrenge'),excelCell('B6',`${report.assessment_strictness} / 5`)]));
  rows.push(row(8,[excelCell('A8','Bewertungskriterium'),excelCell('B8','Punkte'),excelCell('C8','Beurteilung'),excelCell('D8','Textbeleg')]));
  report.criteria.forEach((c,i)=>rows.push(row(9+i,[excelCell(`A${9+i}`,c.name),excelCell(`B${9+i}`,c.earned===null?'Nicht beurteilbar':`${c.earned} / ${c.maximum}`),excelCell(`C${9+i}`,c.assessment),excelCell(`D${9+i}`,c.evidence)])));
  let n=10+report.criteria.length;
  const section=(title,items,render)=>{rows.push(row(n,[excelCell(`A${n}`,title)]));n++; for(const item of items){rows.push(row(n,[excelCell(`A${n}`,render(item))]));n++;}};
  section('Sprachliche Korrekturen',report.corrections,x=>`${x.category}: ${x.original} → ${x.suggestion} — ${x.explanation}`);
  section('Stärken',report.strengths,x=>`${x.area}: ${x.aspect} [Beleg: ${x.evidence}]`);
  section('Entwicklungsfelder',report.weaknesses,x=>`${x.area}: ${x.aspect} [Beleg: ${x.evidence}]`);
  section('Nächste Schritte',report.next_steps,x=>`${x.focus}: ${x.tip}`);
  section('Bitte prüfen',report.uncertainties,x=>x);
  const last=n;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}" xmlns:r="${DOC_REL}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="65" customWidth="1"/><col min="4" max="4" width="55" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A8:D${8+report.criteria.length}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
export async function excelReport(template, input) {
  const report=validateReport(input); fileContent(template,'Excel-Vorlage');
  if(!/\.xlsx$/i.test(template.name)) throw new Error('Für den Excel-Download bitte eine XLSX-Datei mit Bewertungskriterien hochladen.');
  const zip=await JSZip.loadAsync(Buffer.from(template.data,'base64')); safeZip(zip);
  const {workbook,rels}=await workbookParts(zip);
  const sheets=workbook.getElementsByTagNameNS(MAIN,'sheets')[0]; if(!sheets) throw new Error('Die Excel-Arbeitsmappe enthält keine Tabellenblätter.');
  const existing=Array.from(sheets.getElementsByTagNameNS(MAIN,'sheet'));
  let name='Beurteilung',suffix=2; while(existing.some(s=>s.getAttribute('name')===name)) name=`Beurteilung ${suffix++}`;
  const sheetIds=existing.map(x=>Number(x.getAttribute('sheetId'))||0), sheetId=Math.max(0,...sheetIds)+1;
  const relsList=Array.from(rels.getElementsByTagNameNS(PACKAGE_REL,'Relationship'));
  let ridNum=1; while(relsList.some(x=>x.getAttribute('Id')===`rId${ridNum}`)) ridNum++;
  const sheetNums=Object.keys(zip.files).map(x=>Number(x.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]||0));
  const sheetPath=`xl/worksheets/sheet${Math.max(0,...sheetNums)+1}.xml`;
  const sheetEl=workbook.createElementNS(MAIN,'sheet'); sheetEl.setAttribute('name',name); sheetEl.setAttribute('sheetId',String(sheetId)); sheetEl.setAttributeNS(DOC_REL,'r:id',`rId${ridNum}`); sheets.appendChild(sheetEl);
  const relEl=rels.createElementNS(PACKAGE_REL,'Relationship'); relEl.setAttribute('Id',`rId${ridNum}`); relEl.setAttribute('Type',`${DOC_REL}/worksheet`); relEl.setAttribute('Target',sheetPath.slice(3)); rels.documentElement.appendChild(relEl);
  const contentFile=zip.file('[Content_Types].xml'); if(!contentFile) throw new Error('Die Excel-Datei ist unvollständig.');
  const contentDoc=parseXml(await contentFile.async('string'));
  const override=contentDoc.createElementNS(CONTENT_TYPES,'Override'); override.setAttribute('PartName',`/${sheetPath}`); override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); contentDoc.documentElement.appendChild(override);
  zip.file('xl/workbook.xml',new XMLSerializer().serializeToString(workbook));
  zip.file('xl/_rels/workbook.xml.rels',new XMLSerializer().serializeToString(rels));
  zip.file('[Content_Types].xml',new XMLSerializer().serializeToString(contentDoc));
  zip.file(sheetPath,reportWorksheet(report));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
