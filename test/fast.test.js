import test from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import {parseRubric,rubricFromHtml,extractFiles,fastCorrection,visionRead} from '../fast-correction.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
const file=(text)=>({name:'text.txt',data:Buffer.from(text).toString('base64')});
test('Rubric totals are excluded and points retained',()=>{
 const rows=rubricFromHtml('<table><tr><td>Einleitung</td><td>2</td></tr><tr><td>Erreichte Punkte</td><td>2</td></tr><tr><td>Gesamtpunktzahl</td><td>24</td></tr></table>');
 assert.deepEqual(rows,[{name:'Einleitung',maximum:2}]);
 assert.equal(parseRubric('2 | Einleitung\n- | Stil')[1].maximum,null);
 assert.throws(()=>parseRubric('4 Hauptteil'),/Jede Zeile/);
});
test('Multiple pages are preserved in upload order without spelling changes',async()=>{
 const result=await extractFiles([file('ich finde das Tiere'),file('zweite seite')]);
 assert.deepEqual(result.pages.map(x=>x.text),['ich finde das Tiere','zweite seite']);
});
test('OCR warnings and text are retained without AI',async()=>{
 const result=await extractFiles([{name:'page.jpg',data:Buffer.from('mock').toString('base64')}],{ocr:async()=>({text:'das Tiere',warnings:['Unsicher erkannt: das']})});
 assert.equal(result.pages[0].text,'das Tiere'); assert.equal(result.pages[0].ocr,true);
});
const body={essayText:'Ich finde das Tiere wichtig sind.',rubricText:'3 | Rechtschreibung',reviewed:true,spelling:'CH',context:'',assessmentStrictness:3};
const value={title:'Aufsatz',summary:'Vorschlag',criteria:[{id:0,earned:2,assessment:'dass erforderlich.',evidence:'das Tiere'}],corrections:[{original:'das Tiere',suggestion:'dass Tiere',category:'Rechtschreibung',explanation:'Konjunktion'}],strengths:[{area:'Inhalt',aspect:'Eine klare Meinung wird formuliert.',evidence:'Ich finde'},{area:'Inhalt',aspect:'Das Thema wird direkt genannt.',evidence:'das Tiere'},{area:'Aufbau',aspect:'Der Gedanke ist knapp ausgedrückt.',evidence:'wichtig sind'}],weaknesses:[{area:'Grammatik',aspect:'Die Verbform passt nicht zum Satzsubjekt.',evidence:'das Tiere wichtig sind'},{area:'Rechtschreibung',aspect:'Die Konjunktion ist falsch geschrieben.',evidence:'das Tiere'}],next_steps:[{focus:'Kongruenz',tip:'Prüfe bei jedem Satz, ob Subjekt und Verb in Zahl und Person zusammenpassen.'},{focus:'das oder dass',tip:'Ersetze dass durch dieses; wenn das nicht passt, brauchst du dass.'}],assessment_strictness:3,uncertainties:[]};
const mocked=(v)=>async(url,request)=>{const payload=JSON.parse(request.body);assert.equal(payload.model,'qwen3:4b-instruct');assert.ok(payload.messages.every(m=>!m.images));assert.equal(payload.options.num_ctx,16384);return new Response(JSON.stringify({done:true,message:{content:JSON.stringify(v)},eval_count:100,eval_duration:1e9}));};
test('Text assessment reconstructs fixed rubric and omits repeated essays',async()=>{
 const result=await fastCorrection(body,{},mocked(value));
 assert.equal(result.report.criteria[0].maximum,3);assert.equal(result.report.original_text,body.essayText);assert.equal(result.report.corrected_text,'');assert.equal(result.metrics.tokensPerSecond,100);
 assert.equal(result.report.assessment_strictness,3);assert.equal(result.report.strengths.length,3);assert.equal(result.report.weaknesses.length,2);assert.equal(result.report.next_steps.length,2);
});
test('Strictness is applied to the prompt, accepted only for levels 1–5, and returned for review',async()=>{
 let prompt='';
 const result=await fastCorrection({...body,assessmentStrictness:5},{},async(url,request)=>{
  prompt=JSON.parse(request.body).messages[0].content;
  return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({...value,assessment_strictness:5})}}));
 });
 assert.match(prompt,/Sehr streng/);assert.match(prompt,/keine Kriterien oder Abzüge/);assert.equal(result.report.assessment_strictness,5);
 await assert.rejects(fastCorrection({...body,assessmentStrictness:6},{},mocked(value)),/1 bis 5/);
});
test('Unreviewed OCR cannot be assessed',async()=>{await assert.rejects(fastCorrection({...body,reviewed:false},{},mocked(value)),/zuerst prüfen/);});
test('Fabricated evidence or correction cannot be returned',async()=>{
 await assert.rejects(fastCorrection(body,{},mocked({...value,criteria:[{...value.criteria[0],evidence:'erfunden'}]})),/Textbeleg/);
 await assert.rejects(fastCorrection(body,{},mocked({...value,corrections:[{...value.corrections[0],original:'erfunden'}]})),/Original/);
});
test('Missing criteria and excessive points are rejected',async()=>{
 await assert.rejects(fastCorrection(body,{},mocked({...value,criteria:[]})),/Rasterkriterien/);
 await assert.rejects(fastCorrection(body,{},mocked({...value,criteria:[{...value.criteria[0],earned:4}]})),/Unplausible/);
});
test('Unscored criteria remain unscored',async()=>{
 const result=await fastCorrection({...body,rubricText:'- | Rechtschreibung'},{},mocked(value));
 assert.equal(result.report.criteria[0].earned,null);assert.equal(result.report.criteria[0].maximum,null);
});
test('HTTP extraction and text assessment work with export',async()=>{
 const server=createApp({env:{},fetchImpl:mocked(value)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try {
  const extraction=await post('/api/extract',{files:[file(body.essayText)]});assert.equal(extraction.status,200);assert.equal((await extraction.json()).pages[0].text,body.essayText);
  const response=await post('/api/assess',body);assert.equal(response.status,200);const result=await response.json();assert.equal(result.report.criteria[0].earned,2);
  const word=await post('/api/export',{report:result.report});assert.equal(word.status,200);assert.equal(Buffer.from(await word.arrayBuffer()).subarray(0,2).toString(),'PK');
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Vision reading sends one image and keeps model transcription unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-test-'));
 const path=join(dir,'page.jpg'); await writeFile(path,'image-test');
 const mock=async(url,request)=>{
  const payload=JSON.parse(request.body);assert.equal(payload.model,'qwen3-vl:8b');assert.equal(payload.messages[1].images.length,1);
  assert.ok(payload.messages[0].content.includes('KEINE Sprachkorrektur'));
  assert.ok(!payload.messages.some(m=>m.content.includes('Bewertungskriterien')));
  return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({text:'Ich finde das Tiere\nwichtig sind',uncertain:['Zweite Zeile prüfen.']})}}));
 };
 try {const result=await visionRead(path,{},mock);assert.equal(result.text,'Ich finde das Tiere\nwichtig sind');assert.ok(result.warnings.includes('Zweite Zeile prüfen.'));}
 finally {await rm(dir,{recursive:true,force:true});}
});
test('Incomplete vision transcription is rejected instead of assessed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-test-'));const path=join(dir,'page.jpg');await writeFile(path,'image-test');
 try {await assert.rejects(visionRead(path,{},async()=>new Response(JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}}))),/nicht vollständig/);}
 finally {await rm(dir,{recursive:true,force:true});}
});
