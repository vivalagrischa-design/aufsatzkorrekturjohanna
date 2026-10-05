const $ = id => document.getElementById(id);
const selected = { criteria: [], essay: [] };
let report = null;
let password = '';
const apiUrl = (window.AUFSATZ_CONFIG?.serverUrl || '').replace(/\/+$/, '');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function status(message, error = false) { $('status').hidden = false; $('status').textContent = message; $('status').classList.toggle('error', error); }
function setFiles(id, files) {
  const additions = Array.from(files);
  if (additions.some(file => !/\.(pdf|docx|txt|png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024)) {
    status('Bitte PDF-, DOCX-, TXT- oder Bilddateien mit maximal 8 MB pro Datei auswählen.', true); return;
  }
  const next = [...selected[id], ...additions];
  const total = next.reduce((sum, file) => sum + file.size, 0) + selected[id === 'criteria' ? 'essay' : 'criteria'].reduce((sum, file) => sum + file.size, 0);
  if (total > 64 * 1024 * 1024) return status('Die Dateien dürfen zusammen maximal 64 MB gross sein. Bitte Fotos verkleinern.', true);
  selected[id] = next; if (id === 'criteria') criteriaRead = false; $('reviewedText').checked=false; updateFile(id); invalidateReport();
}
function invalidateReport() { report = null; $('result').hidden = true; }
function updateFile(id) {
  const files = selected[id];
  $(id + 'Name').textContent = files.length ? `${files.length} Datei${files.length === 1 ? '' : 'en'} ausgewählt · weitere hinzufügen` : (id === 'criteria' ? 'Kriterien hochladen' : 'Aufsatz hochladen');
  $(id + 'Zone').classList.toggle('ready', files.length > 0);
  document.querySelector(`[data-clear="${id}"]`).hidden = !files.length;
  const list = $(id + 'List'); list.replaceChildren();
  files.forEach((file, index) => {
    const row = document.createElement('li');
    const name = document.createElement('span'); name.textContent = `${index + 1}. ${file.name}`; row.append(name);
    const actions = document.createElement('div');
    for (const [label, delta] of [['↑', -1], ['↓', 1], ['Entfernen', 0]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet'; button.textContent = label;
      button.setAttribute('aria-label', delta ? `${file.name} nach ${delta < 0 ? 'oben' : 'unten'} verschieben` : `${file.name} entfernen`);
      button.disabled = $('submitButton').disabled || (delta !== 0 && (index + delta < 0 || index + delta >= files.length));
      button.onclick = () => { if ($('submitButton').disabled) return; if (id === 'criteria') criteriaRead=false; $('reviewedText').checked=false; if (delta) [files[index], files[index + delta]] = [files[index + delta], files[index]]; else files.splice(index, 1); updateFile(id); invalidateReport(); };
      actions.append(button);
    }
    row.append(actions); list.append(row);
  });
}
for (const id of ['criteria', 'essay']) {
  $(id).addEventListener('change', () => { setFiles(id, $(id).files); $(id).value = ''; });
  const zone = $(id + 'Zone');
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('drag'); if (!$('submitButton').disabled) setFiles(id, event.dataTransfer.files); });
  document.querySelector(`[data-clear="${id}"]`).addEventListener('click', () => { $(id).value = ''; selected[id] = []; if(id === 'criteria') {criteriaRead=false; $('rubricText').value='';} $('reviewedText').checked=false; updateFile(id); invalidateReport(); });
}
$('settingsButton').onclick = () => $('settings').showModal();
$('closeSettings').onclick = () => $('settings').close();
$('settingsForm').onsubmit = event => {
  event.preventDefault();
  password = $('password').value; $('password').value = '';
  $('settings').close(); status('Schulzugang gespeichert. Du kannst jetzt die Korrektur starten.');
};
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result.split(',')[1] }); reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.')); reader.readAsDataURL(file); }); }
async function prepareFile(file) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return readFile(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1) return readFile(file);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d'); if (!ctx) return readFile(file);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { name: file.name.replace(/\.[^.]+$/, '.jpg'), data: canvas.toDataURL('image/jpeg', 0.92).split(',')[1] };
  } catch { return readFile(file); }
  finally { URL.revokeObjectURL(url); }
}
async function prepareFiles(files) { const result = []; for (const file of files) result.push(await prepareFile(file)); return result; }
async function request(path, body) {
  let response;
  try { response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(360000), ...(activeController ? [activeController.signal] : [])]) }); }
  catch (error) { if (error.name === 'AbortError') throw new Error('Abgebrochen.'); throw new Error(error.name === 'TimeoutError' ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : 'Der Korrekturserver ist nicht erreichbar. Bitte die zuständige Person an deiner Schule über die fehlende Serververbindung informieren.'); }
  if (!response.ok) {
    let data; try { data = await response.json(); } catch {}
    if (response.status === 401) $('settings').showModal();
    throw new Error(data?.error || 'Der Korrekturserver konnte die Anfrage nicht bearbeiten. Die Serververbindung muss vom Betreiber eingerichtet werden.');
  }
  return response;
}
let activeController = null;
let criteriaRead = false;
const previewUrls = [];
function showReview() { $('textReview').hidden = false; $('reviewedText').checked = false; }
function previews() {
  previewUrls.forEach(URL.revokeObjectURL); previewUrls.length = 0; $('pagePreviews').replaceChildren();
  selected.essay.forEach((file,i) => {
    const a = document.createElement('a'); const url = URL.createObjectURL(file); previewUrls.push(url);
    a.href=url; a.target='_blank'; a.rel='noopener'; a.textContent=`Originalseite ${i+1}: ${file.name}`; $('pagePreviews').append(a);
  });
}
$('manualButton').onclick=()=>{showReview();previews();};
for(const id of ['rubricText','essayText','context','visualNotes','spelling']) $(id).addEventListener('input',()=>{invalidateReport();$('reviewedText').checked=false;});
$('nextEssay').onclick=()=>{
  if(activeController) return;
  selected.essay=[]; $('essayText').value=''; $('visualNotes').value=''; $('reviewedText').checked=false; updateFile('essay'); invalidateReport(); previews(); status('Raster und Hinweise bleiben erhalten. Jetzt die nächsten Aufsatzseiten hochladen.'); $('essayZone').scrollIntoView({behavior:'smooth'});
};
function busy(value) {
  for(const id of ['submitButton','assessButton','manualButton','nextEssay','criteria','essay','context','spelling','readingMode','rubricText','essayText','visualNotes','reviewedText']) $(id).disabled=value;
  document.querySelectorAll('[data-clear]').forEach(b=>b.disabled=value);
  $('cancelButton').hidden=!value;
  for(const id of ['criteria','essay']) updateFile(id);
}
$('cancelButton').onclick=()=>activeController?.abort();
async function task(label,fn) {
  activeController=new AbortController(); busy(true); const start=Date.now();
  const timer=setInterval(()=>{status(`${label} · ${Math.floor((Date.now()-start)/1000)} Sekunden. Diese Uhr ist keine Fortschrittsanzeige.`);},1000);
  status(label);
  try { await fn(); } catch(error) { status(error.message,true); }
  finally {clearInterval(timer);activeController=null;busy(false);}
}
$('correctionForm').onsubmit=async event=>{
  event.preventDefault();
  if(!selected.essay.length) return status('Bitte die Aufsatzseiten hochladen oder Text manuell eingeben.',true);
  if(!selected.criteria.length && !$('rubricText').value.trim()) return status('Bitte ein Raster hochladen oder manuell eingeben.',true);
  if(!apiUrl && location.hostname.endsWith('github.io')) return status('Bitte die lokale App auf localhost:3000 öffnen.',true);
  invalidateReport();
  await task('Seiten werden gelesen',async()=>{
    const start=performance.now();
    if(!criteriaRead && selected.criteria.length) {
      const data=await (await request('/api/extract',{files:await Promise.all(selected.criteria.map(readFile))})).json();
      $('rawRubric').textContent=data.pages.map(p=>p.name+'\n'+p.text).join('\n\n');
      $('rubricText').value=data.rubric.length?data.rubric.map(r=>`${r.maximum} | ${r.name}`).join('\n'):data.pages.map(p=>p.text).join('\n\n'); criteriaRead=true;
    }
    // Keep image resolution for OCR; the vision AI no longer receives these images.
    const essayFiles=$('readingMode').value==='vision'?await prepareFiles(selected.essay):await Promise.all(selected.essay.map(readFile));
    const data=await (await request('/api/extract',{files:essayFiles,readingMode:$('readingMode').value})).json();
    $('essayText').value=data.pages.map(p=>p.text).join('\n\n');
    $('ocrWarnings').textContent=data.pages.flatMap(p=>p.warnings.map(w=>p.name+': '+w)).join(' · ');
    $('readingMetrics').textContent=`Lesen: ${((performance.now()-start)/1000).toFixed(1)} Sekunden · ${data.pages.length} Seiten/Dateien. ${data.pages.some(p=>p.ocr)?($('readingMode').value==='vision'?'KI-Abschrift der Handschrift.':'Mac-Texterkennung für Drucktext.'):''}`;
    showReview(); previews(); status('Seiten gelesen. Jetzt Text und Raster mit den Originalen vergleichen.'); $('textReview').scrollIntoView({behavior:'smooth'});
  });
};
$('assessButton').onclick=async()=>{
  if(!$('reviewedText').checked) return status('Bitte zuerst den Text und das Raster prüfen und die Bestätigung setzen.',true);
  if(!$('consent').checked) return status('Bitte die Berechtigung zur Verarbeitung bestätigen.',true);
  invalidateReport();
  await task('Beurteilung wird erstellt',async()=>{
    const data=await (await request('/api/assess',{rubricText:$('rubricText').value,essayText:$('essayText').value,reviewed:true,spelling:$('spelling').value,context:($('context').value+'\nBeobachtungen der Lehrperson zu Schriftbild/Form: '+$('visualNotes').value).trim()})).json();
    report=data.report;render();$('result').hidden=false;
    status(`Beurteilung fertig · ${data.metrics.seconds.toFixed(1)} Sekunden · ${data.metrics.model}${data.metrics.tokensPerSecond?' · '+data.metrics.tokensPerSecond.toFixed(1)+' Tokens/s':''}. Bitte den Vorschlag prüfen.`);
    $('result').scrollIntoView({behavior:'smooth'});
  });
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
  ${r.corrected_text ? block('Sprachlich korrigierter Aufsatz', `<div class="text-block">${escapeHtml(r.corrected_text)}</div>`) : ''}
  <details><summary>Original / Transkription prüfen</summary><div class="text-block">${escapeHtml(r.original_text)}</div></details>`;
}
function render() { $('report').innerHTML = reportHtml(report); }
function download(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
$('downloadWord').onclick = async () => {
  if (!report) return;
  $('downloadWord').disabled = true;
  try { const templates = selected.criteria.filter(file => /\.docx$/i.test(file.name));
    if (templates.length !== 1) throw new Error('Bitte genau eine Word-Vorlage als Bewertungsraster hochladen, damit das Originalformat erhalten bleibt.');
    const response = await request('/api/export', { report, template: await readFile(templates[0]) }); download(await response.blob(), 'Korrekturvorschlag.docx'); }
  catch (error) { status(error.message, true); }
  finally { $('downloadWord').disabled = false; }
};
$('downloadHtml').onclick = () => {
  if (!report) return;
  const html = `<!doctype html><html lang="de-CH"><meta charset="utf-8"><title>Korrekturvorschlag</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:20px;line-height:1.6;color:#172333}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5e2;padding:12px;text-align:left;vertical-align:top}.text-block,p{white-space:pre-wrap}.report-block{margin-top:26px}.old{color:#933c3c}.new{color:#255a47}.notice,small{color:#566276}.metric{margin:12px 0}details{margin-top:20px}</style><h1>Korrekturvorschlag · Deutsch</h1>${reportHtml(report).replace('<details>', '<details open>')}</html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), 'Korrekturvorschlag.html');
};
$('print').onclick = () => { document.querySelectorAll('#report details').forEach(item => item.open = true); window.print(); };
