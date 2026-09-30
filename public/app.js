const $ = id => document.getElementById(id);
const selected = { criteria: null, essay: null };
let report = null;
let password = '';
const apiUrl = (window.AUFSATZ_CONFIG?.serverUrl || '').replace(/\/+$/, '');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function status(message, error = false) { $('status').hidden = false; $('status').textContent = message; $('status').classList.toggle('error', error); }
function setFile(id, file) {
  if (file && (!/\.(pdf|docx|txt|png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024)) {
    $(id).value = ''; selected[id] = null; updateFile(id); status('Bitte eine PDF-, DOCX-, TXT- oder Bilddatei mit maximal 8 MB auswählen.', true); return;
  }
  selected[id] = file; updateFile(id);
  // Ein vorhandener Bericht gehört zu den vorherigen Dateien.
  report = null; $('result').hidden = true;
}
function updateFile(id) {
  $(id + 'Name').textContent = selected[id]?.name || (id === 'criteria' ? 'Kriterien hochladen' : 'Aufsatz hochladen');
  $(id + 'Zone').classList.toggle('ready', Boolean(selected[id]));
  document.querySelector(`[data-clear="${id}"]`).hidden = !selected[id];
}
for (const id of ['criteria', 'essay']) {
  $(id).addEventListener('change', () => setFile(id, $(id).files[0]));
  const zone = $(id + 'Zone');
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('drag');
    if ($('submitButton').disabled) return;
    if (event.dataTransfer.files.length !== 1) return status('Bitte genau eine Datei pro Uploadfeld wählen. Mehrseitige Aufsätze als ein PDF hochladen.', true);
    const file = event.dataTransfer.files[0];
    const transfer = new DataTransfer(); transfer.items.add(file); $(id).files = transfer.files; setFile(id, file);
  });
  document.querySelector(`[data-clear="${id}"]`).addEventListener('click', () => { $(id).value = ''; setFile(id, null); });
}
$('settingsButton').onclick = () => $('settings').showModal();
$('closeSettings').onclick = () => $('settings').close();
$('settingsForm').onsubmit = event => {
  event.preventDefault();
  password = $('password').value; $('password').value = '';
  $('settings').close(); status('Schulzugang gespeichert. Du kannst jetzt die Korrektur starten.');
};
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result.split(',')[1] }); reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.')); reader.readAsDataURL(file); }); }
async function request(path, body) {
  let response;
  try { response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(660000) }); }
  catch (error) { throw new Error(error.name === 'TimeoutError' ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : 'Der Korrekturserver ist nicht erreichbar. Bitte die zuständige Person an deiner Schule über die fehlende Serververbindung informieren.'); }
  if (!response.ok) {
    let data; try { data = await response.json(); } catch {}
    if (response.status === 401) $('settings').showModal();
    throw new Error(data?.error || 'Der Korrekturserver konnte die Anfrage nicht bearbeiten. Die Serververbindung muss vom Betreiber eingerichtet werden.');
  }
  return response;
}
$('correctionForm').onsubmit = async event => {
  event.preventDefault();
  if (!selected.criteria || !selected.essay) return status('Bitte Kriterien und Aufsatz hochladen.', true);
  if (!apiUrl && location.hostname.endsWith('github.io')) { return status('Die Oberfläche ist bereit. Der Betreiber muss den KI-Server in public/config.js hinterlegen, bevor Korrekturen möglich sind.', true); }
  $('submitButton').disabled = true; $('submitButton').textContent = 'Korrektur wird erstellt …';
  $('result').hidden = true; report = null;
  for (const id of ['criteria', 'essay', 'context', 'spelling']) $(id).disabled = true;
  document.querySelectorAll('[data-clear]').forEach(button => button.disabled = true);
  status('Kriterien und Aufsatz werden geprüft. Je nach Länge und Lesbarkeit kann das einige Minuten dauern.');
  try {
    const [criteria, essay] = await Promise.all([readFile(selected.criteria), readFile(selected.essay)]);
    const response = await request('/api/correct', { criteria, essay, context: $('context').value, spelling: $('spelling').value });
    const data = await response.json();
    if (!data.report) throw new Error('Der Server hat keinen Korrekturvorschlag geliefert.');
    report = data.report; render(); $('status').hidden = true; $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { status(error.message, true); }
  finally { $('submitButton').disabled = false; $('submitButton').textContent = 'Korrekturvorschlag erstellen'; for (const id of ['criteria', 'essay', 'context', 'spelling']) $(id).disabled = false; document.querySelectorAll('[data-clear]').forEach(button => button.disabled = false); }
};
const block = (title, content, className = '') => `<section class="report-block ${className}"><h3>${title}</h3>${content}</section>`;
const list = items => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
function reportHtml(r) {
  const scored = r.criteria.length && r.criteria.every(c => c.earned !== null && c.maximum !== null);
  const total = scored ? r.criteria.reduce((sum, c) => ({ earned: sum.earned + c.earned, maximum: sum.maximum + c.maximum }), { earned: 0, maximum: 0 }) : null;
  return `<h3>${escapeHtml(r.title)}</h3><p class="notice">KI-Vorschlag: Bitte Belege, Transkription und Bewertung vor der Verwendung prüfen.</p>${total || r.grade !== null ? `<div class="metrics">${total ? `<div class="metric"><strong>${total.earned} / ${total.maximum}</strong><span>Gesamtpunkte</span></div>` : ''}${r.grade !== null ? `<div class="metric"><strong>${escapeHtml(r.grade)}</strong><span>Notenvorschlag nach Raster</span></div>` : ''}</div>` : ''}
  ${block('Gesamtbeurteilung', `<p>${escapeHtml(r.summary)}</p><p class="notice">${escapeHtml(r.grade_reason)}</p>`)}
  ${r.uncertainties.length ? block('Bitte prüfen', list(r.uncertainties), 'uncertainties') : ''}
  ${block('Bewertung nach deinen Kriterien', r.criteria.length ? `<div class="table-wrap"><table><thead><tr><th>Kriterium</th><th>Beurteilung und Textbeleg</th><th>Punkte</th></tr></thead><tbody>${r.criteria.map(c => `<tr><td><strong>${escapeHtml(c.name)}</strong></td><td><p>${escapeHtml(c.assessment)}</p><small>${escapeHtml(c.evidence)}</small></td><td>${c.earned === null ? 'Ohne Punkteskala' : `${c.earned} / ${c.maximum}`}</td></tr>`).join('')}</tbody></table></div>` : '<p>Die Dokumente erlauben keine Bewertung.</p>')}
  ${block('Sprachliche Korrekturen', r.corrections.length ? r.corrections.map(c => `<div class="correction-item"><span class="category">${escapeHtml(c.category)}</span><p class="old">Original: ${escapeHtml(c.original)}</p><p class="new">Vorschlag: ${escapeHtml(c.suggestion)}</p><small>${escapeHtml(c.explanation)}</small></div>`).join('') : '<p>Keine konkreten sprachlichen Korrekturen aufgeführt.</p>')}
  ${block('Stärken', list(r.strengths))}${block('Nächste Lernschritte', list(r.next_steps))}
  ${block('Sprachlich korrigierter Aufsatz', `<div class="text-block">${escapeHtml(r.corrected_text)}</div>`)}
  <details><summary>Original / Transkription prüfen</summary><div class="text-block">${escapeHtml(r.original_text)}</div></details>`;
}
function render() { $('report').innerHTML = reportHtml(report); }
function download(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
$('downloadWord').onclick = async () => {
  if (!report) return;
  $('downloadWord').disabled = true;
  try { const response = await request('/api/export', { report }); download(await response.blob(), 'Korrekturvorschlag.docx'); }
  catch (error) { status(error.message, true); }
  finally { $('downloadWord').disabled = false; }
};
$('downloadHtml').onclick = () => {
  if (!report) return;
  const html = `<!doctype html><html lang="de-CH"><meta charset="utf-8"><title>Korrekturvorschlag</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:20px;line-height:1.6;color:#172333}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5e2;padding:12px;text-align:left;vertical-align:top}.text-block,p{white-space:pre-wrap}.report-block{margin-top:26px}.old{color:#933c3c}.new{color:#255a47}.notice,small{color:#566276}.metric{margin:12px 0}details{margin-top:20px}</style><h1>Korrekturvorschlag · Deutsch</h1>${reportHtml(report).replace('<details>', '<details open>')}</html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), 'Korrekturvorschlag.html');
};
$('print').onclick = () => { document.querySelectorAll('#report details').forEach(item => item.open = true); window.print(); };
