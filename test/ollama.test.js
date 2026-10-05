import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ollamaFetch } from '../ollama-http.js';
import { readOllamaResponse } from '../local-ai.js';

test('Streaming preserves fragmented UTF-8 and all response text', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ message: { content: 'Grüsse, Schüler' }, done: false }) + '\n' + JSON.stringify({ message: { content: '!' }, done: true }) + '\n');
  const response = new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  assert.equal((await readOllamaResponse(response)).message.content, 'Grüsse, Schüler!');
});
test('Streaming errors and missing final event are explicit', async () => {
  const response = event => new Response(JSON.stringify(event) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(readOllamaResponse(response({ error: 'runner crashed' })), /runner crashed/);
  await assert.rejects(readOllamaResponse(response({ done: false, message: { content: 'partial' } })), /vorzeitig abgebrochen/);
});
test('Native transport receives real HTTP stream and honours deadline before headers', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/hang') return;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: 'Grüsse' }, done: false }) + '\n');
    res.end(JSON.stringify({ message: { content: '!' }, done: true }) + '\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await ollamaFetch(url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) });
    assert.equal((await readOllamaResponse(response)).message.content, 'Grüsse!');
    await assert.rejects(ollamaFetch(url + '/hang', { method: 'POST', body: '{}', signal: AbortSignal.timeout(30) }), { name: 'TimeoutError' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
