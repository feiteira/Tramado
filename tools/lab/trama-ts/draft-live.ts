// Live check: Trama's draftMessages (numbered sources) against OpenRouter free models.
// The key is read from ~/.openrouter.key and never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { draftMessages, DRAFT_MAX_TOKENS } from './src/core/service/prompt';

const key = readFileSync(`${homedir()}/.openrouter.key`, 'utf8').trim();
const question = 'Um estudante reprovou na época normal. Pode ir a recurso e quanto paga?';
const passages = [
  { document: 'Regulamento Académico, p. 1, art. 2.º', text: 'Artigo 2.º Época de recurso O estudante reprovado na época normal pode inscrever-se na época de recurso, mediante requerimento apresentado nos serviços académicos.' },
  { document: 'Aula 1, 00:04', text: 'Quem chumbar na época normal pode ir à época de recurso, mas tem de pagar uma taxa.' },
  { document: 'Regulamento Académico, p. 2, art. 2.º', text: 'A inscrição na época de recurso está sujeita ao pagamento de uma taxa fixada anualmente pelo conselho de gestão.' },
  { document: 'Regulamento Académico, p. 2, art. 3.º', text: 'Artigo 3.º Melhoria de nota O estudante aprovado pode requerer melhoria de nota uma única vez.' },
];
const messages = draftMessages(question, passages);

async function ask(label: string, extra: Record<string, unknown>) {
  const body = {
    models: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free'],
    messages,
    max_tokens: 4000, // reasoning models spend tokens before content; DRAFT_MAX_TOKENS (900) can be too few
    ...extra,
  };
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/tramado', 'X-Title': 'Tramado (lab)' },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as any;
  console.log(`== ${label}: HTTP ${res.status} in ${Date.now() - t0} ms; model=${j.model ?? '-'}; finish=${j.choices?.[0]?.finish_reason ?? '-'}; usage=${JSON.stringify(j.usage ?? null)}`);
  if (j.error) console.log('error:', JSON.stringify(j.error).slice(0, 400));
  const c = j.choices?.[0]?.message?.content;
  if (c !== undefined) console.log('content:', String(c).slice(0, 1200));
}

console.log('DRAFT_MAX_TOKENS in Trama =', DRAFT_MAX_TOKENS);
await ask('fallback array, no provider prefs', {});
await ask('fallback array + Trama routing {zdr:true, data_collection:deny}', { provider: { zdr: true, data_collection: 'deny' } });
