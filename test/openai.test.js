import test from 'node:test';
import assert from 'node:assert/strict';
import { openaiJSON } from '../openai-json.js';
import { visionRead } from '../fast-correction.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const completed=value=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{output_tokens:12}}));
test('OpenAI vision uses server key and retains original spelling',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vision-test-')); const path=join(dir,'page.png');await writeFile(path,'test');
 try {const result=await visionRead(path,{AI_PROVIDER:'openai',OPENAI_API_KEY:'test-secret'},async(url,opts)=>{
  const body=JSON.parse(opts.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.store,false);assert.equal(opts.headers.Authorization,'Bearer test-secret');assert.equal(body.input[0].content[1].detail,'high');
  return completed({text:'Ich finde das Tiere',uncertain:['Wort am Rand']});
 });assert.equal(result.text,'Ich finde das Tiere');assert.ok(result.warnings.includes('Wort am Rand'));}finally{await rm(dir,{recursive:true});}
});
test('Incomplete cloud response and missing credentials fail explicitly',async()=>{
 await assert.rejects(openaiJSON({},async()=>{throw Error('must not call');},{}),/OPENAI_API_KEY/);
 await assert.rejects(openaiJSON({OPENAI_API_KEY:'test'},async()=>new Response(JSON.stringify({status:'incomplete',output:[]})),{content:[],schema:{}}),/vollständig/);
});
