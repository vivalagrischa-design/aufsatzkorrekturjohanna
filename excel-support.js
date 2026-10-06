import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { validateReport, fileContent } from './correction.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const parseXml = xml => new DOMParser({ errorHandler: { warning() {}, error(message) { throw new Error(`Ungültige Excel-Struktur: ${message}`); }, fatalError(message) { throw new Error(`Ungültige Excel-Struktur: ${message}`); } } }).parseFromString(xml, 'application/xml');
const xmlText = el => Array.from(el.getElementsByTagNameNS(MAIN, 't')).map(x => x.textContent).join('');
const colNumber = ref => { let n=0; for (const c of ref.toUpperCase().match(/^[A-Z]+/)?.[0] || '') n=n*26+c.charCodeAt(0)-64; return n; };
const colName = number => { let n=number,s=''; while(n>0){const rem=(n-1)%26;s=String.fromCharCode(65+rem)+s;n=Math.floor((n-1)/26);} return s; };
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

function writeCell(doc,row,ref,value){
  const cells=Array.from(row.getElementsByTagNameNS(MAIN,'c'));
  let cell=cells.find(x=>x.getAttribute('r')===ref);
  if(!cell){cell=doc.createElementNS(MAIN,'c');cell.setAttribute('r',ref);const col=colNumber(ref);const next=cells.find(x=>colNumber(x.getAttribute('r'))>col);row.insertBefore(cell,next||null);}
  for(const child of Array.from(cell.childNodes)) cell.removeChild(child);
  if(typeof value==='number'&&Number.isFinite(value)){cell.removeAttribute('t');const v=doc.createElementNS(MAIN,'v');v.appendChild(doc.createTextNode(String(value)));cell.appendChild(v);}
  else {cell.setAttribute('t','inlineStr');const is=doc.createElementNS(MAIN,'is'),t=doc.createElementNS(MAIN,'t');t.setAttribute('xml:space','preserve');t.appendChild(doc.createTextNode(String(value??'')));is.appendChild(t);cell.appendChild(is);}
}
function fillTemplateSheet(doc,shared,report){
  const rowElements=Array.from(doc.getElementsByTagNameNS(MAIN,'row'));
  const rowByNumber=new Map(rowElements.map(row=>[Number(row.getAttribute('r')),row]));
  const cellsByRow=new Map();
  for(const row of rowElements){
    const cells=Array.from(row.getElementsByTagNameNS(MAIN,'c')).map(cell=>({cell,col:colNumber(cell.getAttribute('r')),value:cellValue(cell,shared),formula:cell.getElementsByTagNameNS(MAIN,'f')[0]?.textContent||''}));
    cellsByRow.set(Number(row.getAttribute('r')),cells);
  }
  const normalized=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('de');
  const matches=new Map();
  for(const [rowNum,cells] of cellsByRow) for(const item of cells){const value=normalized(item.value);if(value)matches.set(value,{rowNum,cells,labelCol:item.col});}
  const usedLeafScores=[];
  for(const criterion of report.criteria){
    if(/^(minuten prüfungsdauer|mögliche \/ erreichte punkte|unterschrift)/i.test(criterion.name.trim())) continue;
    const match=matches.get(normalized(criterion.name)); if(!match) continue;
    const row=rowByNumber.get(match.rowNum);if(!row)continue;
    const maxima=match.cells.filter(x=>x.col>match.labelCol&&(x.formula||(/^\d+(?:[.,]\d+)?$/.test(x.value.trim())&&(criterion.maximum===null||Number(x.value.replace(',','.'))===criterion.maximum))));
    if(!maxima.length) continue;
    const maximumCell=maxima.sort((a,b)=>a.col-b.col).at(-1);
    const maxCol=maximumCell.col;
    const scoreCandidates=match.cells.filter(x=>x.col>maxCol&&!x.value.trim()&&!x.formula&&x.cell.getAttribute('s'));
    const scoreCell=scoreCandidates.sort((a,b)=>a.col-b.col).at(-1);
    const feedbackCandidates=match.cells.filter(x=>x.col>match.labelCol&&x.col<maxCol&&!x.value.trim()&&!x.formula&&x.cell.getAttribute('s'));
    const feedbackCell=feedbackCandidates.sort((a,b)=>a.col-b.col).at(-1);
    const scoreRef=scoreCell?.cell.getAttribute('r')||`${colName(maxCol+2)}${match.rowNum}`;
    const feedbackRef=feedbackCell?.cell.getAttribute('r')||`${colName(maxCol+1)}${match.rowNum}`;
    writeCell(doc,row,scoreRef,criterion.earned===null?'n. b.':criterion.earned);
    if(criterion.assessment) writeCell(doc,row,feedbackRef,criterion.assessment);
    if(match.labelCol>1) usedLeafScores.push(criterion.earned);
  }
  // Put the student-facing feedback into the original template's existing + / - fields.
  const positive=report.strengths.slice(0,3), growth=report.weaknesses.slice(0,3);
  positive.forEach((item,i)=>{const row=rowByNumber.get(50+i);if(row)writeCell(doc,row,`B${50+i}`,`${item.area}: ${item.aspect} [${item.evidence}]`);});
  growth.forEach((item,i)=>{const row=rowByNumber.get(50+i);if(row)writeCell(doc,row,`E${50+i}`,`${item.area}: ${item.aspect} [${item.evidence}]`);});
  const totalRow=rowByNumber.get(45); if(totalRow&&usedLeafScores.length){
    const complete=report.criteria.filter(c=>! /^(minuten prüfungsdauer|mögliche \/ erreichte punkte|unterschrift)/i.test(c.name.trim())).every(c=>c.earned!==null);
    const earned=usedLeafScores.filter(x=>x!==null).reduce((a,b)=>a+b,0);
    writeCell(doc,totalRow,'H45',earned);
    if(!complete){const gradeRow=rowByNumber.get(46);if(gradeRow)writeCell(doc,gradeRow,'H46','');}
    else if(report.grade!==null){const gradeRow=rowByNumber.get(46);if(gradeRow)writeCell(doc,gradeRow,'H46',report.grade);}
    else {const gradeRow=rowByNumber.get(46);if(gradeRow)writeCell(doc,gradeRow,'H46','');}
  }
  return new XMLSerializer().serializeToString(doc);
}

export async function excelReport(template, input) {
  const report=validateReport(input); fileContent(template,'Excel-Vorlage');
  if(!/\.xlsx$/i.test(template.name)) throw new Error('Für den Excel-Download bitte eine XLSX-Datei mit Bewertungskriterien hochladen.');
  const zip=await JSZip.loadAsync(Buffer.from(template.data,'base64')); safeZip(zip);
  const {workbook,rels}=await workbookParts(zip);
  const targets=worksheetTargets(workbook,rels); if(!targets.length)throw new Error('Die Excel-Arbeitsmappe enthält keine Tabellenblätter.');
  const shared=parseShared(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const original=zip.file(targets[0].path);if(!original)throw new Error('Das erste Tabellenblatt der Vorlage fehlt.');
  zip.file(targets[0].path,fillTemplateSheet(parseXml(await original.async('string')),shared,report));
  // Only cell contents in the original first sheet are changed; its layout, tabs and styles remain untouched.
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
