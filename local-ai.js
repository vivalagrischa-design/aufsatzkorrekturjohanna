import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import { fileContent, instructions, schema, validateReport } from './correction.js';

const run = promisify(execFile);
export async function localDocument(file, label) {
  const input = fileContent(file, label); // Limits and format validation also apply locally.
  const bytes = Buffer.from(file.data, 'base64');
  const ext = file.name.split('.').pop().toLowerCase();
  if (input.type === 'input_image') return { role: 'user', content: `${label}: ${file.name}`, images: [file.data] };
  if (ext === 'txt') {
    if (input.text.length > 80000) throw new Error(`${label}: Der Text ist zu lang (maximal 80’000 Zeichen).`);
    return { role: 'user', content: input.text };
  }
  if (ext === 'docx') {
    const text = (await mammoth.extractRawText({ buffer: bytes })).value;
    if (!text.trim()) throw new Error(`${label}: Die Word-Datei enthält keinen lesbaren Text. Eingebettete Scans zuerst als PDF exportieren.`);
    if (text.length > 80000) throw new Error(`${label}: Der Text ist zu lang (maximal 80’000 Zeichen).`);
    return { role: 'user', content: `${label}:\n${text}` };
  }
  const directory = await mkdtemp(join(tmpdir(), 'aufsatz-'));
  try {
    const path = join(directory, 'input.pdf');
    await writeFile(path, bytes, { mode: 0o600 });
    const info = await run('pdfinfo', [path], { timeout: 20000, maxBuffer: 1024 * 1024 });
    const pages = Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
    if (!pages || pages > 12) throw new Error(`${label}: Bitte ein PDF mit höchstens 12 Seiten verwenden.`);
    const text = await run('pdftotext', ['-layout', path, '-'], { timeout: 20000, maxBuffer: 1024 * 1024 });
    if (text.stdout.length > 80000) throw new Error(`${label}: Der PDF-Text ist zu lang (maximal 80’000 Zeichen).`);
    // Page images preserve scans, handwriting and the rubric's table layout.
    await run('pdftoppm', ['-jpeg', '-scale-to', '1600', '-r', '120', path, join(directory, 'page')], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const files = (await readdir(directory)).filter(name => /^page-\d+\.jpg$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const images = await Promise.all(files.map(async name => (await readFile(join(directory, name))).toString('base64')));
    return { role: 'user', content: `${label}: ${file.name}\n${text.stdout}\nDie beigefügten Bilder zeigen die PDF-Seiten in der Originalreihenfolge.`, images };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('PDF-Verarbeitung benötigt Poppler (pdfinfo, pdftotext, pdftoppm). Siehe Installationsanleitung oder Docker.');
    if (error.message.includes('höchstens') || error.message.includes('zu lang')) throw error;
    throw new Error(`${label}: Das PDF konnte nicht gelesen werden. Ein unverschlüsseltes, gültiges PDF verwenden.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function localCorrection(body, env, fetchImpl) {
  const criteria = await localDocument(body.criteria, 'Bewertungskriterien');
  const essay = await localDocument(body.essay, 'Schüleraufsatz');
  let response;
  try {
    response = await fetchImpl(`${(env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/chat`, {
      method: 'POST', signal: AbortSignal.timeout(600000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.OLLAMA_MODEL || 'qwen3-vl:8b', stream: false, format: schema,
        messages: [{ role: 'system', content: instructions }, criteria, essay, { role: 'user', content: `Rechtschreibung: ${body.spelling === 'DE' ? 'Deutschland (mit ß)' : 'Schweiz (ss statt ß)'}. Angaben der Lehrperson: ${body.context}` }],
        options: { temperature: 0.1, num_ctx: 32768, num_predict: 14000 },
      }),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw error;
    throw new Error('Der lokale KI-Server ist nicht erreichbar. Ollama starten und OLLAMA_URL prüfen.');
  }
  if (!response.ok) throw new Error('Das lokale KI-Modell ist nicht verfügbar. Ollama-Modell herunterladen und OLLAMA_MODEL prüfen.');
  const data = await response.json();
  if (!data.done || data.done_reason === 'length') throw new Error('Die lokale KI konnte den Vorschlag nicht vollständig erstellen. Einen kürzeren Aufsatz verwenden.');
  try { return validateReport(JSON.parse(data.message.content)); }
  catch { throw new Error('Die lokale KI lieferte keinen gültigen Korrekturvorschlag. Bitte erneut versuchen oder ein stärkeres Modell einsetzen.'); }
}
