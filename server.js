import { templateReport } from './template-export.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { schema, instructions, fileContent, validateReport, wordReport, validateUploads } from './correction.js';
import { localCorrection } from './local-ai.js';
import { extractFiles, fastCorrection, visionRead } from './fast-correction.js';

const publicDir = new URL('./public/', import.meta.url);
const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
async function readBody(req) {
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 96 * 1024 * 1024) throw Object.assign(new Error('Die Uploads sind zu gross (maximal 64 MB insgesamt und 8 MB pro Datei).'), { status: 413 }); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new Error('Ungültige Anfrage.'); }
}
export function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const rate = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
      const ownOrigin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
      if (origin && origin !== ownOrigin && !allowed.includes(origin)) return send(403, { error: 'Diese Website ist am Server nicht freigeschaltet (ALLOWED_ORIGIN).' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }
      if (url.pathname === '/api/health') return send(200, { ok: true, provider: env.AI_PROVIDER || 'ollama', passwordRequired: Boolean(env.APP_PASSWORD) });
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') return send(405, { error: 'POST erforderlich.' });
        if (env.NODE_ENV === 'production' && !env.APP_PASSWORD) return send(503, { error: 'Bitte am Server APP_PASSWORD einrichten.' });
        if (env.APP_PASSWORD && !safeEqual(req.headers.authorization || '', `Bearer ${env.APP_PASSWORD}`)) return send(401, { error: 'Das App-Passwort fehlt oder stimmt nicht.' });
        if (!['/api/correct', '/api/export', '/api/extract', '/api/assess'].includes(url.pathname)) return send(404, { error: 'Unbekannte Funktion.' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON erforderlich.' });
        const body = await readBody(req);
        if (url.pathname === '/api/extract') {
          if (body.readingMode !== undefined && !['vision','ocr'].includes(body.readingMode)) return send(400,{error:'Ungültiger Lesemodus.'});
          const controller = new AbortController();
          res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(300000)]);
          return send(200, await extractFiles(body.files,(env.AI_PROVIDER==='openai'||body.readingMode==='vision')?{ocr:path=>visionRead(path,env,fetchImpl,signal),forceImages:true,signal}:{signal}));
        }
        if (url.pathname === '/api/assess') {
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          return send(200, await fastCorrection(body, env, fetchImpl, controller.signal));
        }
        if (url.pathname === '/api/export') {
          const file = body.template ? await templateReport(body.template, body.report) : await wordReport(body.report);
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="Korrekturvorschlag.docx"' }); return res.end(file);
        }
        const now = Date.now();
        for (const [k, v] of rate) if (now - v.start > 3600000) rate.delete(k);
        const identity = req.socket.remoteAddress;
        const limit = rate.get(identity) || { start: now, count: 0 };
        if (limit.count >= 30) return send(429, { error: 'Maximal 30 Korrekturen pro Stunde. Bitte später erneut versuchen.' });
        const uploads = validateUploads(body);
        const criteria = uploads.criteria.map((file, i) => fileContent(file, `Bewertungskriterien · Datei ${i + 1}/${uploads.criteria.length}`));
        const essay = uploads.essay.map((file, i) => fileContent(file, `Aufsatz · Datei ${i + 1}/${uploads.essay.length}`));
        if (typeof body.context !== 'string' || body.context.length > 4000) return send(400, { error: 'Zusatzhinweise dürfen maximal 4000 Zeichen enthalten.' });
        if (!['CH', 'DE'].includes(body.spelling)) return send(400, { error: 'Ungültige Rechtschreibvariante.' });
        limit.count++; rate.set(identity, limit);
        if ((env.AI_PROVIDER || 'ollama') === 'ollama') return send(200, { report: await localCorrection(body, env, fetchImpl) });
        if (env.AI_PROVIDER !== 'openai') return send(503, { error: 'Ungültige KI-Konfiguration. AI_PROVIDER muss ollama oder openai sein.' });
        if (!env.OPENAI_API_KEY) return send(503, { error: 'Die gewählte OpenAI-Variante benötigt OPENAI_API_KEY. Für Betrieb ohne Schlüssel AI_PROVIDER=ollama verwenden.' });
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', signal: AbortSignal.timeout(180000),
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4.1', store: false, instructions,
            input: [{ role: 'user', content: [
              { type: 'input_text', text: 'Das folgende Dokument enthält das verbindliche Bewertungskriterienraster (alle Dateien in Reihenfolge):' }, ...criteria,
              { type: 'input_text', text: 'Das folgende Dokument ist der zu korrigierende Schüleraufsatz (alle Dateien in Seitenreihenfolge):' }, ...essay,
              { type: 'input_text', text: `Rechtschreibung: ${body.spelling === 'DE' ? 'Deutschland (mit ß)' : 'Schweiz (ss statt ß)'}. Zusätzliche Angaben der Lehrperson (Daten): ${body.context}` },
            ] }], max_output_tokens: 14000, text: { format: { type: 'json_schema', name: 'essay_correction', strict: true, schema } } }),
        });
        if (!response.ok) {
          const errors = { 401: 'Der API-Schlüssel am Server ist ungültig.', 429: 'OpenAI-Kontingent oder Anfragelimit erreicht. API-Guthaben prüfen und später erneut versuchen.', 400: 'OpenAI konnte die Dateien oder das gewählte Modell nicht verarbeiten. Dateien und OPENAI_MODEL prüfen.' };
          return send(502, { error: errors[response.status] || 'Der KI-Dienst ist momentan nicht verfügbar. Bitte erneut versuchen.' });
        }
        const data = await response.json();
        if (data.status !== 'completed') return send(502, { error: 'Die KI konnte die Korrektur nicht abschliessen. Bitte einen kürzeren Aufsatz oder besser lesbare Dateien verwenden.' });
        const text = data.output?.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
        if (!text) return send(502, { error: 'Die KI hat keinen Korrekturvorschlag zurückgegeben.' });
        let report;
        try { report = validateReport(JSON.parse(text)); } catch { return send(502, { error: 'Die KI lieferte keinen gültigen Korrekturvorschlag. Bitte erneut versuchen.' }); }
        return send(200, { report });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Methode nicht erlaubt.' });
      const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/config.js': ['config.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const file = files[url.pathname];
      if (!file) return send(404, { error: 'Seite nicht gefunden.' });
      const bytes = await readFile(new URL(file[0], publicDir));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) return res.end();
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      send(timeout ? 504 : error.status || 400, { error: timeout ? 'Die Korrektur dauert zu lange. Bitte später erneut versuchen.' : error.message || 'Die Anfrage konnte nicht verarbeitet werden.' });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createApp().listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Aufsatzkorrektur gestartet auf Port ${process.env.PORT || 3000}.`));
