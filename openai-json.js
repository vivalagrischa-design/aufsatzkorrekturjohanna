// Server-only: credentials never reach the browser.
export async function openaiJSON(env, fetchImpl, { instructions, content, schema, signal, maxTokens = 7000 }) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY fehlt in den Render-Einstellungen.');
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
    body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-6.1-sol', store: false,
      reasoning: { effort: 'low' }, instructions,
      input: [{ role: 'user', content }], max_output_tokens: maxTokens,
      text: { format: { type: 'json_schema', name: 'atelier_result', strict: true, schema } } })
  });
  if (!response.ok) {
    throw new Error(({401:'OpenAI-Schlüssel ungültig.',429:'OpenAI-Kontingent oder Anfragelimit erreicht. API-Abrechnung prüfen.',400:'OpenAI-Anfrage oder Modell nicht unterstützt. Serverkonfiguration prüfen.'})[response.status] || `OpenAI nicht verfügbar (${response.status}).`);
  }
  const data = await response.json();
  if (data.status !== 'completed') throw new Error('OpenAI hat das Ergebnis nicht vollständig erzeugt. Keine Teilbewertung übernommen.');
  const parts = (data.output || []).flatMap(item => item.content || []);
  if (parts.some(part => part.type === 'refusal')) throw new Error('Das Modell konnte diese Anfrage nicht bearbeiten.');
  const text = parts.filter(part => part.type === 'output_text').map(part => part.text).join('');
  let value; try { value = JSON.parse(text); } catch { throw new Error('OpenAI lieferte kein gültiges Ergebnis.'); }
  return { value, tokens: data.usage?.output_tokens || null };
}
