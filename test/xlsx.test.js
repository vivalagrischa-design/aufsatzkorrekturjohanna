import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractXlsx, excelReport } from '../excel-support.js';

async function workbook() {
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kriterien" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Argumentation</t></is></c><c r="B1"><v>5</v></c><c r="C1" s="1"/><c r="D1" s="1"/></row></sheetData></worksheet>');
  return {name:'Raster.xlsx',data:(await zip.generateAsync({type:'nodebuffer'})).toString('base64')};
}
const evidence='Das ist ein Aufsatz';
const item=(area,aspect)=>({area,aspect,evidence});
const report={title:'Erörterung',original_text:'Das ist ein Aufsatz mit mehreren Sätzen.',corrected_text:'',summary:'Klarer Aufbau.',criteria:[{name:'Argumentation',assessment:'Gut begründet.',evidence,earned:4,maximum:5}],corrections:[],strengths:[item('Aufbau','Klar gegliedert.'),item('Inhalt','Thema getroffen.'),item('Stil','Verständlich.')],weaknesses:[item('Inhalt','Noch ausbauen.'),item('Stil','Variieren.')],next_steps:[{focus:'Belege',tip:'Belege ergänzen.'},{focus:'Satzbau',tip:'Satzanfänge variieren.'}],uncertainties:[],assessment_strictness:3,grade:null,grade_reason:'Kein Notenschlüssel.'};

test('reads Excel rubric and fills the existing worksheet without changing workbook layout',async()=>{
  const file=await workbook();
  const extracted=await extractXlsx(file);
  assert.equal(extracted.rubric[0].name,'Argumentation');
  assert.equal(extracted.rubric[0].maximum,5);
  const output=await excelReport(file,report),zip=await JSZip.loadAsync(output);
  const workbookXml=await zip.file('xl/workbook.xml').async('string');
  assert.match(workbookXml,/name="Kriterien"/);
  assert.doesNotMatch(workbookXml,/name="Beurteilung"/);
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet,/Argumentation/);
  assert.match(sheet,/<c r="C1"[^>]*t="inlineStr"/);
  assert.match(sheet,/<c r="D1"[^>]*><v>4<\/v><\/c>/);
});

test('writes not-assessable results into the existing score cell',async()=>{
  const file=await workbook();
  const notAssessable={...report,criteria:[{name:'Argumentation',assessment:'Ohne Grundlage nicht beurteilbar.',evidence:'',earned:null,maximum:null}]};
  const output=await excelReport(file,notAssessable),zip=await JSZip.loadAsync(output);
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet,/<c r="D1"[^>]*t="inlineStr"[^>]*><is><t[^>]*>n\. b\.<\/t><\/is><\/c>/);
  assert.match(sheet,/Ohne Grundlage nicht beurteilbar\./);
});
