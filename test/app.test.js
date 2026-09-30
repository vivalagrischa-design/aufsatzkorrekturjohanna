import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { fileContent, totals, validateReport, wordReport } from '../correction.js';

const report = { title: 'Ein besonderer Tag', original_text: 'Ich wahr im Wald.', corrected_text: 'Ich war im Wald.', summary: 'Kurze, nachvollziehbare Erzählung.', criteria: [{ name: 'Sprache', assessment: 'Ein Rechtschreibfehler.', evidence: 'Ich wahr', earned: 3, maximum: 4 }], corrections: [{ original: 'wahr', suggestion: 'war', category: 'Rechtschreibung', explanation: 'Präteritum von sein.' }], strengths: ['Klarer Beginn.'], next_steps: ['Zeitformen überprüfen.'], uncertainties: [], grade: null, grade_reason: 'Kein Notenschlüssel vorhanden.' };
const txt = (name, text) => ({ name, data: Buffer.from(text).toString('base64') });
const body = { criteria: txt('kriterien.txt', 'Sprache: maximal 4 Punkte. Kein Notenschlüssel.'), essay: txt('aufsatz.txt', 'Ich wahr im Wald.'), context: '1. Oberstufe', spelling: 'CH' };
async function withApp(options, action) {
  const server = createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, data, password = 'teacher') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` }, body: JSON.stringify(data) });
test('Upload validation and trusted MIME assignment', () => {
  assert.equal(fileContent(body.essay, 'Aufsatz').type, 'input_text');
  assert.throws(() => fileContent(txt('bad.exe', 'a'), 'Aufsatz'), /Bitte PDF/);
  assert.throws(() => fileContent(txt('false.pdf', 'hello'), 'Aufsatz'), /Ungültiges PDF/);
  assert.throws(() => fileContent({ name: 'x.txt', data: '%%%=' }, 'Aufsatz'), /Ungültige Datei/);
  assert.throws(() => fileContent(txt('empty.txt', ''), 'Aufsatz'), /8 MB/);
  assert.equal(fileContent(txt('photo.png', 'image'), 'Aufsatz').image_url.startsWith('data:image/png;base64,'), true);
  assert.equal(fileContent(txt('scan.pdf', '%PDF-1.7'), 'Aufsatz').type, 'input_file');
});
test('Points do not invent a scale and invalid points are rejected', () => {
  assert.deepEqual(totals(report), { earned: 3, maximum: 4 });
  assert.equal(totals({ ...report, criteria: [{ ...report.criteria[0], earned: null, maximum: null }] }), null);
  assert.throws(() => validateReport({ ...report, criteria: [{ ...report.criteria[0], earned: 99 }] }), /Unplausible/);
  assert.throws(() => validateReport({ ...report, criteria: [{ ...report.criteria[0], earned: null }] }), /Unplausible/);
});
test('DOCX export produces an actual Word ZIP container', async () => {
  const result = await wordReport(report);
  assert.equal(result.subarray(0, 2).toString(), 'PK');
  assert.ok(result.includes(Buffer.from('word/document.xml')));
});
test('Server requires password; missing API key is an explicit error', async () => {
  await withApp({ env: { AI_PROVIDER: 'openai', APP_PASSWORD: 'teacher' } }, async url => {
    assert.equal((await post(url + '/api/correct', body, 'wrong')).status, 401);
    const result = await post(url + '/api/correct', body);
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /OPENAI_API_KEY/);
    assert.equal((await fetch(url + '/')).status, 200);
  });
});
test('Production refuses unprotected correction', async () => {
  await withApp({ env: { AI_PROVIDER: 'openai', NODE_ENV: 'production', OPENAI_API_KEY: 'test' } }, async url => {
    assert.equal((await post(url + '/api/correct', body)).status, 503);
  });
});
test('Correction sends rubric and essay separately and exports authenticated DOCX', async () => {
  let sent;
  await withApp({ env: { AI_PROVIDER: 'openai', APP_PASSWORD: 'teacher', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-4.1' }, fetchImpl: async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }] }), { status: 200 });
  } }, async url => {
    const result = await post(url + '/api/correct', body);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).report, report);
    assert.equal(sent.store, false);
    assert.equal(sent.text.format.strict, true);
    assert.match(sent.input[0].content[1].text, /maximal 4 Punkte/);
    assert.match(sent.input[0].content[3].text, /Ich wahr/);
    const exported = await post(url + '/api/export', { report });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /wordprocessingml/);
    assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  });
});
test('Foreign origins, unreadable response and upstream failures', async () => {
  await withApp({ env: { AI_PROVIDER: 'openai', APP_PASSWORD: 'teacher', OPENAI_API_KEY: 'test' }, fetchImpl: async () => new Response('{}', { status: 429 }) }, async url => {
    const rejected = await fetch(url + '/api/correct', { method: 'POST', headers: { Origin: 'https://foreign.example' } });
    assert.equal(rejected.status, 403);
    const failed = await post(url + '/api/correct', body);
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /Kontingent/);
  });
  await withApp({ env: { AI_PROVIDER: 'openai', APP_PASSWORD: 'teacher', OPENAI_API_KEY: 'test' }, fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete' })) }, async url => {
    assert.equal((await post(url + '/api/correct', body)).status, 502);
  });
});
test('Default local AI corrects without any API key and uses a structured schema', async () => {
  let request;
  await withApp({ env: { APP_PASSWORD: 'teacher' }, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.headers.Authorization, undefined);
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(report) } }));
  } }, async url => {
    const result = await post(url + '/api/correct', body);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).report, report);
    assert.equal(request.stream, false);
    assert.equal(request.format.type, 'object');
    assert.match(request.messages[1].content, /maximal 4 Punkte/);
    assert.match(request.messages[2].content, /Ich wahr/);
  });
});
test('Local AI connection failures are explained without asking for an API key', async () => {
  await withApp({ env: { APP_PASSWORD: 'teacher' }, fetchImpl: async () => { throw new Error('Offline'); } }, async url => {
    const result = await post(url + '/api/correct', body);
    assert.match((await result.json()).error, /Ollama starten/);
  });
});
