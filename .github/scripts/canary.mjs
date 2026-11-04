// The AI canary (critique G21, plan §8.2): are the free-model defaults Tramado ships still alive?
// Run daily by .github/workflows/canary.yml with the repository secret OPENROUTER_API_KEY, or by hand:
//   OPENROUTER_API_KEY=… node .github/scripts/canary.mjs [--summary=<file>]
// Reads app/src/core/ai/ai-defaults.json and checks, in this order:
//   1. the catalog (GET /models and /models?output_modalities=transcription, no key, no cost): every model of every
//      chain is listed and free, the default model takes tools, the cloud speech model is listed;
//   2. three tiny requests per privacy level, one per model of the level's chain, sent as the app sends them
//      (streamed, the level's `provider` object, the "title" profile):
//        no-training, standard  pass when at least one model answers (the app falls back along the chain);
//        zdr                    has no free chain; the no-training chain is asked with `zdr: true` and must be refused
//                               with the data-policy 404 the app explains (AI_PRIVACY_BLOCKS), or answer.
// Free models only: nothing here can cost money. The output names models, HTTP statuses and error classes; never the
// key, response bodies, account ids, generation ids, usage or credit figures. Exit 0 = alive, 1 = broken, 2 = no key.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const API = 'https://openrouter.ai/api/v1';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const KEY = (process.env.OPENROUTER_API_KEY ?? '').trim();
if (!KEY) {
  console.error('OPENROUTER_API_KEY is not set: nothing was sent.');
  process.exit(2);
}

const defaults = JSON.parse(readFileSync(join(ROOT, 'app/src/core/ai/ai-defaults.json'), 'utf8'));
const profile = defaults.profiles.title;
const LEVELS = ['no-training', 'standard', 'zdr'];
const PROVIDER = { 'no-training': { data_collection: 'deny' }, zdr: { data_collection: 'deny', zdr: true }, standard: undefined };
const HEADERS = { 'HTTP-Referer': 'https://github.com/feiteira/Tramado', 'X-OpenRouter-Title': 'Tramado canary' };
const problems = [];
const lines = [];
const say = (s = '') => {
  console.log(s);
  lines.push(s);
};

// ---------------------------------------------------------------- 1. the catalog

async function catalog(query = '') {
  const res = await fetch(`${API}/models${query}`, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET /models${query}: HTTP ${res.status}`);
  return new Map(((await res.json()).data ?? []).map((m) => [m.id, m]));
}

const isFree = (m) => Number(m?.pricing?.prompt ?? 1) === 0 && Number(m?.pricing?.completion ?? 1) === 0;
const chainIds = [...new Set([...Object.values(defaults.chains).flat(), ...Object.values(defaults.vision).flat(), ...defaults.trainingOptIn])];
say('## AI canary');
say('');
say(`Defaults \`ai-defaults.json\` updated ${defaults.updated}; checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
say('');
say('### Catalog');
say('');
try {
  const models = await catalog();
  for (const id of chainIds) {
    const m = models.get(id);
    if (!m) problems.push(`catalog: ${id} is no longer listed`);
    else if (id !== 'openrouter/free' && !isFree(m)) problems.push(`catalog: ${id} is no longer free`);
  }
  const top = models.get(defaults.chains['no-training'][0]);
  if (top && !(top.supported_parameters ?? []).includes('tools')) problems.push(`catalog: the default model ${top.id} no longer takes tools`);
  const stt = await catalog('?output_modalities=transcription');
  if (!stt.has(defaults.stt.model)) problems.push(`catalog: the cloud speech model ${defaults.stt.model} is no longer listed`);
  say(`${chainIds.length} models of the chains checked, and the speech model ${defaults.stt.model}: ${problems.length ? problems.length + ' problem(s)' : 'all listed, free where expected'}.`);
} catch (e) {
  problems.push(`catalog: ${e.message}`);
  say(`Could not read the catalog: ${e.message}`);
}

// ---------------------------------------------------------------- 2. three tiny requests per level

/** One streamed request; returns {status, cls, answeredBy, ms}. Reads the stream to its end, keeps no text. */
async function ask(model, level) {
  const started = Date.now();
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    max_tokens: profile.maxTokens,
    temperature: profile.temperature,
    reasoning: profile.reasoning,
    stream: true,
    ...(PROVIDER[level] ? { provider: PROVIDER[level] } : {}),
  };
  let res;
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return { status: 0, cls: e.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_OFFLINE', ms: Date.now() - started };
  }
  if (!res.ok) {
    let err = {};
    try {
      err = (await res.json()).error ?? {};
    } catch {
      // Not JSON.
    }
    const msg = typeof err.message === 'string' ? err.message : '';
    const step = err.metadata?.failed_routing_step ?? '';
    const origin = res.headers.get('x-openrouter-error-origin');
    const s = res.status;
    // The same classes as app/src/core/ai/classify.ts, for the statuses a tiny request can meet.
    const cls =
      s === 401 ? 'AI_AUTH'
      : s === 402 ? 'AI_NO_CREDIT'
      : s === 404 && (step === 'Filter by Data Policy' || /data policy/i.test(msg)) ? 'AI_PRIVACY_BLOCKS'
      : s === 404 && step === 'Filter by Parameters' ? 'AI_UNSUPPORTED'
      : s === 404 ? 'AI_MODEL_UNKNOWN'
      : s === 429 && (err.metadata?.limit_source !== undefined || origin === 'provider') ? 'AI_BUSY'
      : s === 429 ? 'AI_FREE_LIMIT'
      : s === 400 || s === 422 ? 'AI_BAD_REQUEST'
      : s === 408 || s === 504 ? 'AI_TIMEOUT'
      : s === 503 ? 'AI_UNAVAILABLE'
      : 'AI_UPSTREAM';
    return { status: s, cls, ms: Date.now() - started };
  }
  // 200: read the stream. A top-level `error` in it is a mid-stream failure (openrouter-lab §2).
  let answeredBy = null;
  let finished = false;
  let streamError = null;
  let buf = '';
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          finished = true;
          continue;
        }
        try {
          const ev = JSON.parse(data);
          if (ev.error) streamError = ev.error;
          if (typeof ev.model === 'string') answeredBy = ev.model;
          if (ev.choices?.some((c) => c.finish_reason)) finished = true;
        } catch {
          // A partial or foreign line.
        }
      }
    }
  } catch (e) {
    return { status: 200, cls: e.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM', ms: Date.now() - started };
  }
  if (streamError) {
    const busy = String(streamError.code ?? '') === '429' || /rate.?limit/i.test(String(streamError.message ?? ''));
    return { status: 200, cls: busy ? 'AI_BUSY' : 'AI_UPSTREAM', answeredBy, ms: Date.now() - started };
  }
  return { status: 200, cls: finished ? 'ok' : 'AI_UPSTREAM', answeredBy, ms: Date.now() - started };
}

say('');
say('### Requests');
say('');
say('| Level | Model asked | HTTP | Result | Answered by | Time |');
say('|---|---|---|---|---|---|');
const verdicts = {};
const notes = [];
for (const level of LEVELS) {
  const own = defaults.chains[level];
  const models = (own.length ? own : defaults.chains['no-training']).slice(0, 3);
  const results = [];
  for (const model of models) {
    const r = await ask(model, level);
    results.push(r);
    say(`| ${level} | \`${model}\` | ${r.status || '—'} | ${r.cls} | ${r.answeredBy ? `\`${r.answeredBy}\`` : '—'} | ${(r.ms / 1000).toFixed(1)} s |`);
    await new Promise((ok) => setTimeout(ok, 3500)); // well under the free limit of 20 requests a minute
  }
  if (own.length && results[0] && results[0].cls !== 'ok') notes.push(`${level}: the first model, \`${models[0]}\`, did not answer (${results[0].cls}); the app falls back along the chain.`);
  if (results.some((r) => r.cls === 'AI_AUTH')) {
    verdicts[level] = 'the key was refused (AI_AUTH): check the repository secret';
  } else if (own.length) {
    verdicts[level] = results.some((r) => r.cls === 'ok') ? 'ok' : `no model of the chain answered (${[...new Set(results.map((r) => r.cls))].join(', ')})`;
  } else {
    const odd = results.filter((r) => r.cls !== 'AI_PRIVACY_BLOCKS' && r.cls !== 'ok');
    verdicts[level] = odd.length ? `expected the data-policy refusal (AI_PRIVACY_BLOCKS), got ${[...new Set(odd.map((r) => r.cls))].join(', ')}` : 'ok';
    if (results.some((r) => r.cls === 'ok')) notes.push('A free model answered with `zdr: true`: `chains.zdr` could offer it.');
  }
  if (verdicts[level] !== 'ok') problems.push(`${level}: ${verdicts[level]}`);
}

say('');
say('### Verdict');
say('');
for (const n of notes) say(`Note: ${n}`);
if (notes.length) say('');
if (problems.length) {
  for (const p of problems) say(`- ${p}`);
  say('');
  say('Update `app/src/core/ai/ai-defaults.json` (chains per privacy level, critique G21) when a model is gone or stays busy.');
} else {
  say('Every privacy level works with the shipped defaults.');
}
const text = `${lines.join('\n')}\n`;
if (args.summary) writeFileSync(args.summary, text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
process.exit(problems.length ? 1 : 0);
