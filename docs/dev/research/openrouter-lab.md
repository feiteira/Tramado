# OpenRouter lab: how Tramado should call OpenRouter

Date of lab: 2026-11-03 (≈15:45–16:20 UTC). Total requests sent: **58** (8 metadata GETs + 50 inference/embedding POSTs), **free models only**. Key spend was the same before and after (`usage` <redacted> USD both times, from `GET /api/v1/key`), so **no credit was spent**.

- Test scripts: `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/openrouter/` (`orlib.py` is the stdlib client; `t00_…`–`t9_…` are the tests; `corpus.py` is the fake class corpus)
- Raw request/response JSON for every call (key redacted): `…/lab/openrouter/out/<test>.json`. The ordered request log is in `out/count.log`.
- Model catalogs as fetched: `…/lab/openrouter/dl/models.json` (419 models), `dl/models_stt.json`, `dl/embeddings_models.json`
- Speech clips: `…/lab/openrouter/audio/` (`speech_pt.wav` 16.8 s, `speech_en.wav` 9.3 s, `long.mp3` 209 s), made with gTTS 2.5.4 in an isolated venv because no espeak/flite/pico2wave is installed.

Trama (read-only) already talks to OpenRouter. The parts worth reusing are at `/home/feiteira/Trama/desktop/src-tauri/src/service/mod.rs` (ureq client, `answer()` status→code mapping, `routing()`, hand-built `Multipart`) and `/home/feiteira/Trama/desktop/src-tauri/src/speech/remote.rs` (`/audio/transcriptions` with base64 `input_audio`, `verbose_json`→`json` downgrade, pieces of ≤30 s, 4 workers, 2^n backoff). **Two Trama behaviours must NOT be copied as defaults:**
1. Trama always sends `provider: {zdr: true, data_collection: "deny"}`. With that, **every free model either returns 404 or is unreachable** (§9).
2. Trama maps 404 to `NO_MODEL`. In practice an unknown model id comes back as **400**, and 404 means "routing filters left no endpoint" (§8).

---

## 0. Executive summary (decisions)

| Topic | Decision for Tramado |
|---|---|
| Default model | `google/gemma-4-31b-it:free` as the user asked, but **always sent with a fallback chain** `models: [gemma-4-31b-it:free, gemma-4-26b-a4b-it:free, nvidia/nemotron-3.5-super-vl:free]` (max 3 entries). In the lab gemma-4-31b:free answered **0 of 7** attempts (4 direct, 3 as chain primary; all upstream 429 "shared pool"). gemma-4-26b answered 1 of 2 direct attempts. The chain always answered, through `nvidia/nemotron-3.5-super-vl:free`. |
| Show which model answered | Read `response.model` (and `provider`) and show it in the UI ("answered by Nemotron 3.5 Super (free)"). |
| Privacy | Two modes. **Free mode** (default): no provider filters, with a clear disclosure that free providers may log or train on prompts. **Private mode**: `provider: {data_collection: "deny", zdr: true}` and paid models only. Free NVIDIA endpoints fail both `deny` and `zdr` (404). Gemma free passes `deny` but fails `zdr`. |
| Reasoning | Keep reasoning on, with a large `max_tokens`, for exam answers. Without reasoning, nemotron got a weighted average **wrong** (15.1 instead of 15.4). Turn it off (`reasoning: {enabled: false}`) for transcription, titles, classification and short rewrites. Never use `max_tokens < 1000` while reasoning is on. |
| Streaming | SSE parser: skip `:` comment lines (heartbeat every ~0.42 s), stop at `data: [DONE]`, accept `error` at the top level, take `finish_reason` from the first chunk that has it, and read `usage` from the final chunk (always present). |
| Tools | Tool calling works on nemotron-3.5-super-vl:free, nemotron-3-ultra:free and openrouter/free (it routed to ultra). Use ≤ 8 turns. On the last turn send `tool_choice: "none"` plus a nudge (verified to produce a cited answer). Expect parallel tool calls. |
| Structured output | Do not trust `response_format` alone. Put the schema in the prompt **and** send `response_format` when the model lists `structured_outputs`, then parse tolerantly, validate, normalise, and allow one repair retry. Gemma free **ignored** `json_schema` (returned fenced JSON of its own design). NVIDIA strict decoding produced valid JSON with corrupted fields (`"number": ", "`). |
| Cloud STT | No free STT model exists. Use the dedicated `POST /api/v1/audio/transcriptions` (paid, ≈ US$0.018 per 90-min lecture with `openai/whisper-large-v3-turbo`), reusing Trama's `remote.rs`. The free audio-LLM `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` is only "experimental": it is OK on clips ≤ 30 s with reasoning off, its timestamps are invented, and it **looped and hallucinated on a 3.5-min clip**. |
| Embeddings | Free embeddings exist (`nvidia/llama-nemotron-embed-vl-1b-v2:free` worked: 2048-d, 0.56 s for 6 inputs). Still, **local BM25 should be the default** (offline, private, no rate limits), with free embeddings as an opt-in re-ranker. |
| Limits | 20 req/min for `:free` models. 50 per day if the account bought < 10 credits, otherwise 1000 per day. `GET /api/v1/key` → `free_model_daily_requests {used, limit, remaining}` lets the app show "{used}/{limit} free requests today". |
| Attribution | `HTTP-Referer: https://github.com/<org>/tramado` and `X-OpenRouter-Title: Tramado` (`X-Title` is legacy). |
| Where HTTP runs | In Rust, so the key never enters the webview. Stream events to React through a Tauri `Channel`. CORS is `*`, so a TS-only client would work too, but it would expose the key to the webview. |

---

## 1. Chat completions + `models` fallback array

### Request (exact, `out/t1_fallback_a.json`)
```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer sk-or-…
Content-Type: application/json
HTTP-Referer: https://github.com/tramado-app/tramado
X-Title: Tramado (lab)
```
```json
{
  "model": "google/gemma-4-31b-it:free",
  "models": ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"],
  "messages": [
    {"role": "system", "content": "You are Tramado, a study assistant. Answer in European Portuguese, briefly."},
    {"role": "user", "content": "Em uma frase: o que é o princípio da separação de poderes?"}
  ],
  "max_tokens": 1024,
  "temperature": 0.3
}
```
### Response (200, 4.39 s wall time including the two failed gemma attempts)
```json
{
  "id": "<redacted>",
  "object": "chat.completion",
  "created": 1793720857,
  "model": "nvidia/nemotron-3.5-super-vl:free",
  "provider": "Nvidia",
  "system_fingerprint": null,
  "service_tier": null,
  "choices": [{
    "index": 0, "logprobs": null,
    "finish_reason": "stop", "native_finish_reason": "stop",
    "message": {
      "role": "assistant",
      "content": "O princípio da separação de poderes consiste na divisão do Estado em três órgãos independentes — legislativo, executivo e judicial — para evitar a concentração de poder.",
      "refusal": null,
      "reasoning": "*   Role: Tramado, a study assistant.\n …",
      "reasoning_details": [{"type": "reasoning.text", "text": "…", "format": "unknown", "index": 0}]
    }
  }],
  "usage": {
    "prompt_tokens": 47, "completion_tokens": 247, "total_tokens": 294,
    "cost": 0, "is_byok": false,
    "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0, "audio_tokens": 0, "video_tokens": 0},
    "cost_details": {"upstream_inference_cost": 0, "upstream_inference_prompt_cost": 0, "upstream_inference_completions_cost": 0},
    "completion_tokens_details": {"reasoning_tokens": 210, "image_tokens": 0, "audio_tokens": 0}
  }
}
```
Response headers worth reading: `X-Generation-Id: gen-…`. `access-control-expose-headers` lists `X-Generation-Id, x-openrouter-error-origin, X-Provider-Name, request-id, cf-ray`, and `Access-Control-Allow-Origin` is `*`. Successful responses carry **no** `X-RateLimit-*` headers.

Notes:
- The response does **not** say which fallbacks failed. Only `model` and `provider` identify the winner. `GET /api/v1/generation?id=…` returned 404 "Generation … not found" right after the call (free and very recent generations are not queryable), so it is not useful.
- `reasoning` and `reasoning_details` come back even when they were not asked for (nemotron reasons by default; gemma's `default_enabled` is false).
- gemma-4-31b-it:free and gemma-4-26b-a4b-it:free each have **exactly one endpoint**, "Google AI Studio" (`GET /api/v1/models/google/gemma-4-31b-it:free/endpoints`): context 262144, max completion 32768. nemotron-3.5-super-vl:free has one endpoint, "Nvidia": context 1,000,000, max completion 131072. Free models have no provider redundancy, so redundancy has to come from the **model** chain.

### Gemma availability during the lab
| # | Model | Result |
|---|---|---|
| 9, 17, 35, 51 | gemma-4-31b-it:free (direct) | 429 upstream (Google AI Studio shared pool) |
| 53 | gemma-4-31b-it:free (chain + deny) | 429 |
| 34 | gemma-4-26b-a4b-it:free | **200** (30.9 s, structured-output test) |
| 36 | gemma-4-26b-a4b-it:free | 429 |
| 7, 10 | chain [31b, 26b, super] | 200, served by nemotron-3.5-super-vl:free |

---

## 2. Streaming (SSE)

Request: the same as above plus `"stream": true` (`out/t2_stream_a.json`). OpenRouter forwards `stream_options: {include_usage: true}` upstream by itself (seen in the debug echo, §5), so **usage always arrives**; Tramado does not need to send `stream_options`.

### Wire format observed
```
data: {"id":"<redacted>","object":"chat.completion.chunk","created":1793720888,"model":"nvidia/nemotron-3.5-super-vl:free","provider":"Nvidia","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"O","reasoning_details":[{"type":"reasoning.text","text":"O","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}

… (reasoning deltas: content "" + reasoning "…")
data: {…"choices":[{"index":0,"delta":{"content":")","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}

data: {…"choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":null},"finish_reason":"stop","native_finish_reason":"stop"}]}

data: {…"service_tier":null,"choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"stop","native_finish_reason":"stop"}],"usage":{"prompt_tokens":31,"completion_tokens":479,"total_tokens":510,"cost":0,"is_byok":false,…,"completion_tokens_details":{"reasoning_tokens":418,…}}}

data: [DONE]

```
- Every event is one `data:` line followed by a blank line (148 events → 296 lines).
- **Reasoning streams first**, as `delta.reasoning` (plain string) plus `delta.reasoning_details[]` (`type: "reasoning.text"`), while `delta.content` is `""`. Then content streams. With `reasoning: {exclude: true}`, no reasoning deltas arrive, and the wait shows up as heartbeats instead (see the `t4_stream_toolcalls` row).
- `finish_reason` appears **twice**: in the last content chunk and again in the usage chunk. Take the first one and treat the usage chunk as accounting only.
- Timings: super-vl (via the chain) first chunk 0.77 s, first visible content 2.85 s (2 s of reasoning), done 3.17 s. ultra first chunk 0.59 s, content 0.73 s, done 1.45 s.

### `: OPENROUTER PROCESSING` heartbeats
They are seen whenever the upstream is slow to produce its first token:
- 99,031-token prompt (370,669 chars of PT) to nemotron-3.5-super-vl:free: 12 heartbeats from t=2.52 s to 7.12 s, **one every ~0.42 s**. First token at 7.36 s. Answer correct ("4"). (`out/t2_stream_bigprompt.json`)
- Tool-call stream with `reasoning.exclude`: 3 heartbeats while the model reasoned silently. (`out/t4_stream_toolcalls.json`)

Use them as an "AI is thinking…" signal and as a **stall watchdog**: no byte (heartbeat or data) for 30 s means abort and retry.

### Streamed tool calls (`out/t4_stream_toolcalls.json`)
```
{"tool_calls":[{"index":0,"id":"call-f690…","type":"function","function":{"name":"search_materials","arguments":""}}]}
{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":\"artigo 18 restrições\",\"limit\":6}"}}]}
{"tool_calls":[{"index":1,"id":"call-c95e…","type":"function","function":{"name":"search_materials","arguments":""}}]}
{"tool_calls":[{"index":1,"function":{"arguments":"{\"query\":\"artigo 13 restrições\",\"limit\":6}"}}]}
finish_reason: "tool_calls" (twice)
```
The first fragment for an `index` carries `id`, `type`, `name` and empty `arguments`. Later fragments append to `arguments`. Accumulate by `index`.

### Errors and streams
- **Before** the stream starts (e.g. every model in the chain 429s, bad key, context too long), the response is a plain JSON error with a non-2xx status and `Content-Type: application/json`. Check `res.ok` and the content type before parsing SSE.
- **Mid-stream** errors (docs; not reproducible on demand): HTTP status stays 200, and a final event has a top-level `error` object plus `choices:[{"index":0,"delta":{"content":""},"finish_reason":"error"}]`, e.g. `"error":{"code":"server_error","message":"Provider disconnected unexpectedly"}`. Mid-stream rate limits arrive the same way instead of as a 429. Treat a 200 stream that ends with `finish_reason:"error"`, or with no content and no tool calls, as a failure.
- Cancelling = abort the connection. Nvidia and Google AI Studio are **not** in OpenRouter's "cancellation stops billing" list. Free models cost nothing anyway, but for paid models remember that aborting may still bill.

---

## 3. Reasoning controls (`out/t3_*.json`, model nvidia/nemotron-3.5-super-vl:free)

Prompt: weighted average question; the correct answer is 15.4.

| Request extra | max_tokens | Latency | finish | content | reasoning tokens |
|---|---|---|---|---|---|
| (default: reasoning on) | 150 | 1.15 s | **length** | **"" (empty)** | 150 (all of the budget) |
| `reasoning: {enabled: false}` | 150 | 0.45 s | stop | "A média final é 15,1." **(wrong)** | 0 |
| `reasoning: {effort: "none"}` | 150 | 0.61 s | stop | "A média final é 15,1." **(wrong)** | 0 |
| `reasoning: {effort: "low"}` | 600 | 1.25 s | stop | "A média final do aluno é 15,4." | 169 |
| `reasoning: {exclude: true}` | 1500 | 1.75 s | stop | "A média final do aluno é 15,4." (no `reasoning` field) | 215, still generated and still counted |

Further observations:
- Reasoning used: 210–580 tokens in chat/tool turns, **906–2,747 tokens** in structured extraction (super-vl strict: 2,747 reasoning tokens out of 3,351), and **3,000 of 3,000** when omni was asked for a timestamped transcript.
- `effort` is mapped per model. For ultra (`supported_efforts: high, medium, none`), `effort: "low"` went upstream as `reasoning_effort: "medium"` plus `chat_template_kwargs: {thinking: true, enable_thinking: true}` (debug echo, §5).
- The model catalog says what each model supports: `reasoning: {mandatory, default_enabled, supported_efforts, default_effort, supports_max_tokens}`. `liquid/lfm-2.5-2.6b:free` and `recursive/flint-v1.0:free` have `mandatory: true`, so reasoning cannot be turned off for them.

**Recommendation (per task):**
| Task | reasoning | max_tokens |
|---|---|---|
| Exam answer, tool loop, "explain" | `{effort: "medium"}` (or the model default), `exclude: true` unless "show working" is on | 8000 (or `min(8000, top_provider.max_completion_tokens)`) |
| Question extraction (JSON) | `{effort: "low"}` | 6000–8000 |
| Summaries / notes / flashcards | `{effort: "low"}` | 4000 |
| Titles, tags, classification, translation of short text | `{enabled: false}` (skip if `reasoning.mandatory`) | 300–500 |
| Audio → text via chat | `{enabled: false}` | ≈ 8 × seconds + 64 (with a repetition guard, §6) |

Detection rule: `finish_reason === "length" && !content && !tool_calls` means **reasoning exhausted the budget**. Do not resend the same request. Retry once with `max_tokens × 2` (capped) and/or one effort level lower. If that also fails, show "The model ran out of room. Try a shorter question or another model."

Multi-turn: pass `reasoning` and `reasoning_details` back unchanged on the assistant message, as the docs require. The tool loops did this with nemotron and it was accepted. If the next turn may go to a **different** model (fallback), strip `reasoning` and `reasoning_details` from the history.

---

## 4. Tool calling: full loop with a fake corpus and citations

Corpus (`lab/openrouter/corpus.py`, written for the lab; fictional study text): Art. 13.º igualdade (p. 4), Art. 18.º força jurídica/restrições (p. 6), Art. 37.º liberdade de expressão (p. 9), Art. 64.º saúde (p. 20, distractor), and a lecture-transcript excerpt `[00:12:05]…[00:13:58]` about proportionality and "regulamento municipal não pode restringir sozinho".

Exam question: *"Pergunta 2 (4 valores): Um município aprova um regulamento que proíbe a distribuição de panfletos de um partido da oposição, mantendo permitidos os dos restantes partidos. Analise a constitucionalidade da medida."*

### Tools (exact)
```json
[
 {"type": "function", "function": {"name": "search_materials",
   "description": "Search this class's documents and lecture transcripts. Returns passages with a ref (S1, S2…) to cite, an id, source and location (page/article or timestamp).",
   "parameters": {"type": "object", "properties": {
      "query": {"type": "string", "description": "Keywords or a question, in the language of the materials."},
      "limit": {"type": "integer", "description": "Max results (1-6). Default 4."}},
     "required": ["query"]}}},
 {"type": "function", "function": {"name": "read_passage",
   "description": "Read the full text of one passage returned by search_materials, by its id or ref.",
   "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}}
]
```
System prompt (PT-PT): "És o Tramado, um assistente de estudo. Responde a perguntas de exame usando APENAS os materiais da turma, que consultas com as ferramentas search_materials e read_passage. Cita cada afirmação com a ref da passagem entre parênteses retos, ex.: [S1]. Se os materiais não chegarem, diz o que falta. Responde em português europeu, de forma estruturada e concisa (máx. 200 palavras)."

Request body per turn: `{model, messages, tools, tool_choice: "auto", max_tokens: 4000, temperature: 0.2, reasoning: {effort: "low"}}`.

Tool result message:
```json
{"role":"tool","tool_call_id":"call-7556be41-…","content":"{\"results\": [{\"ref\": \"S1\", \"id\": \"doc:constituicao-apontamentos.pdf#p9\", \"source\": \"Constituição — apontamentos.pdf\", \"location\": \"p. 9, art. 37.º\", \"snippet\": \"Artigo 37.º (Liberdade de expressão e informação). 1. Todos têm o direito …\"}, …]}"}
```
Assistant tool-call message as received:
```json
{"role":"assistant","content":null,"tool_calls":[{"type":"function","index":0,"id":"call-7556be41-0b6c-4b58-8f5a-65b552b448fe","function":{"name":"search_materials","arguments":"{\"query\":\"liberdade de expressão distribuição panfletos partidos políticos igualdade regulamento municipal\",\"limit\":6}"}}],"reasoning":"O utilizador está a fazer…","reasoning_details":[…]}
```
It was passed back with the null keys omitted, keeping `reasoning` and `reasoning_details`. That worked.

### Results
| Model | Turns | Behaviour | Latency per turn | Outcome |
|---|---|---|---|---|
| google/gemma-4-31b-it:free | 0 | 429 upstream on turn 0 (twice, at different times) | – | not testable |
| google/gemma-4-26b-a4b-it:free | 0 | 429 on turn 0 | – | not testable |
| **nvidia/nemotron-3.5-super-vl:free** | 4 | search → **2 parallel searches** → **4 parallel read_passage** → answer | 2.05 / 6.89 / 1.76 / 5.32 s (16 s) | Correct, cited answer. Refs mapped correctly (art. 37 [S1], art. 13 [S3], transcript [S2], art. 18 [S4, n.º 3]). Two PT typos ("Igurança", "singula"). Final turn prompt tokens 3,185, reasoning 579. |
| **nvidia/nemotron-3-ultra-550b-a55b:free** | 6 + 1 | Strictly sequential: one tool call per turn (search, read, search, read, search, read). **Hit MAX_STEPS=6.** Then one extra turn with `tool_choice: "none"` plus the nudge | 5.2 / 2.2 / 3.3 / 1.9 / 2.1 / 2.0 / **22.6** s (39 s) | Best answer: four numbered arguments (art. 37 [S3], art. 13 [S2], art. 18 n.º 3 [S1, S4], proportionality test [S1, S4]) and a conclusion, clean PT-PT. |
| openrouter/free | 1 (single-turn probe) | Router chose nvidia/nemotron-3-ultra-550b-a55b:free and returned a proper tool call | 3.46 s | Works as an "any free tools-capable model" fallback, but the model is random. |

Final-turn nudge (verified, `out/t4_ultra_final_toolchoice_none.json`). Append this user message and send `tool_choice: "none"` **while keeping `tools` in the request**, because the history contains tool calls:
```json
{"role":"user","content":"[Tramado] Limite de pesquisas atingido. Responde agora à pergunta com o que já leste, citando as refs [S#]. Não chames mais ferramentas."}
```

### Citation formats the models produced
`[S1]`, `[S1, S4]` and `[S4, n.º 3]`. The citation parser must accept a list and trailing pin-point text:
```ts
const CITE = /\[(S\d+(?:\s*,\s*S\d+)*)(?:\s*,\s*([^\]]{1,40}))?\]/g; // group1: refs, group2: pin-point ("n.º 3")
```
Then validate. A ref that was never returned by a tool is a **hallucinated citation**: render it struck-through and say "source not found". The ref→anchor map (`S2 → rec:aula-05#t=00:12:05`) is kept client-side for the whole conversation, so citations become clickable (PDF page / article / transcript timestamp).

### Tool-loop limits (recommended)
- `MAX_TURNS = 8` model calls per question. The last one is forced to `tool_choice: "none"` with the nudge.
- `MAX_TOOL_CALLS = 16` in total and at most 6 per turn (super-vl issued 4 in parallel). Run them concurrently.
- Answer duplicate `search_materials` queries (normalised) from cache and tell the model "already searched".
- Tool results: search returns ≤ 6 hits × snippet ≤ 300 chars. `read_passage` returns ≤ 3,000 chars (≈ 800 tokens) with `has_more`/offset paging for long articles.
- History budget: when prompt tokens (from `usage.prompt_tokens` of the previous turn) exceed 24k, replace old tool results with "[result elided; refs S3–S7 still valid]".
- Pin the model inside a loop. After turn 0, send `model: <response.model>` with the remaining chain models after it, so a loop does not hop between models every turn.
- Timeouts: 120 s per turn (ultra's final turn took 22.6 s, structured outputs up to 46 s) and a 30 s idle-stream watchdog.

---

## 5. Structured outputs (exam → questions JSON) (`out/t5_*.json`)

Exam text: 5 questions in 2 groups, sub-questions 2a/2b, points as "(N valores)", a true/false item and a multiple-choice item (A/B/C).

Schema: flat list with `parent` (recursive schemas are poorly supported):
```json
{"type":"object","additionalProperties":false,"required":["title","questions"],"properties":{
  "title":{"type":["string","null"]},
  "questions":{"type":"array","items":{"type":"object","additionalProperties":false,
    "required":["number","parent","group","text","points","kind","options"],
    "properties":{
      "number":{"type":"string","description":"Label as printed: '1', '2', '2a', '2b'"},
      "parent":{"type":["string","null"]},
      "group":{"type":["string","null"]},
      "text":{"type":"string"},
      "points":{"type":["number","null"]},
      "kind":{"type":"string","enum":["open","multiple_choice","true_false","short","container"]},
      "options":{"type":"array","items":{"type":"string"}}}}}}}
```
Request: `response_format: {"type":"json_schema","json_schema":{"name":"exam_questions","strict":true,"schema":<above>}}`, `temperature: 0`, `max_tokens: 6000`, `reasoning: {effort:"low"}`.

| Case | Model / setup | Status / latency | Result |
|---|---|---|---|
| A | nemotron-3.5-super-vl:free (`structured_outputs` listed), strict schema | 200 / **23.9 s** (2,747 reasoning tokens) | Valid JSON in the schema shape, but **content corrupted**: every top-level `number` is `", "`, `parent` of 2a/2b is `", "`, sub-labels are "a)", text keeps the "1." prefix and "(3 valores)", Q2 is `kind: multiple_choice`. |
| B | nemotron-3-ultra:free (does **not** list `response_format`), strict schema | 200 / 11.6 s | OpenRouter **still forwarded** `response_format` upstream (confirmed via `debug.echo_upstream_body`). Valid JSON in the schema shape. Q1 `number` was again `", "`, `parent` was set to the group name, and a streamed re-run also produced the typo "Distinta" for "Distinga". Otherwise correct (2a/2b, points, options). |
| C | ultra + `provider: {require_parameters: true}` | **404** / 0.07 s | `{"error":{"message":"No endpoints found that can handle the requested parameters. …","code":404,"metadata":{"routing_funnel":[{"step":"Initial Endpoints","endpoint_count":1}],"failed_routing_step":"Filter by Parameters"}}}` |
| D | ultra, **schema in the prompt, no response_format** ("Return ONLY a JSON object … matching this JSON Schema: …") | 200 / 45.9 s | **Perfect**: numbers 1, 2, 2a, 2b, 3, 4, 5, parents correct, Q2 `kind: container`, points correct, 3 options, verbatim text. |
| E | gemma-4-26b-a4b-it:free, strict schema (lists `response_format` but not `structured_outputs`) | 200 / 30.9 s (906 reasoning tokens) | **Schema ignored**: returned a markdown ```json fence with its own structure (`exam_metadata`, `groups[].questions[].sub_questions[]`, `value: "3 valores"`). |
| F | xingchen-agi/xing4.0-29b-a4b:free | 429 upstream (provider Phala) | – |

Debug echo of what went upstream for case B (stream + `debug: {echo_upstream_body: true}`, first chunk has `choices: []` and a `debug` field):
```json
{"model":"private/nvidia/nemotron-3-ultra-550b-a55b","stream":true,"stream_options":{"include_usage":true},"user":"<included to upstream but not in debug info>","temperature":0,"max_tokens":3000,"top_p":0.95,"reasoning_effort":"medium","chat_template_kwargs":{"thinking":true,"enable_thinking":true},"messages":[…],"response_format":{"type":"json_schema","json_schema":{"name":"exam_questions","strict":true,"schema":{…}}}}
```

**Fallback strategy (recommended):**
1. Always put a compact description of the schema in the system/user prompt, plus 1 tiny example. This is what made case D perfect.
2. Also send `response_format` json_schema **only** when `supported_parameters` includes `structured_outputs`. Never send `require_parameters: true` for free models: with a single endpoint per free model it just turns into a 404.
3. Parse tolerantly. Strip code fences, take the first `{` to the last `}`, `JSON.parse`, and on failure try a light repair (trailing commas, smart quotes).
4. Validate with zod (TS) or serde (Rust), then **normalise deterministically**. Re-derive `number` from a leading `^\s*(\d+)[.)]` or `^\s*([a-z])\)` in `text` when `number` fails `/^\d+[a-z]?$/`. Strip a trailing `\((\d+(?:[.,]\d+)?)\s*valor(?:es)?\)` / `points?` / `puntos?` from text into `points`. Map `kind` heuristics (options present → multiple_choice; "Verdadeiro ou falso"/"True or false"/"Verdadero o falso" → true_false; has children → container).
5. If validation still fails, do **one** repair call: "Fix this JSON to match the schema: errors: …". Then show the editable result to the student, who confirms the questions before the AI answers them.
6. Check that the points add up (Σ children = parent, Σ groups = total) as a sanity badge, not a blocker.

---

## 6. Audio

### 6a. Audio-in-chat with `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
Request shape (works):
```json
{"model":"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","max_tokens":3000,"temperature":0,
 "reasoning":{"enabled":false},
 "messages":[{"role":"user","content":[
   {"type":"text","text":"Transcribe this audio verbatim in its original language (European Portuguese if Portuguese). Output only the transcript text, no commentary."},
   {"type":"input_audio","input_audio":{"data":"<base64 of the raw file, NOT a data: URI>","format":"wav"}}]}]}
```
Both `wav` (16 kHz mono PCM16) and `mp3` were accepted. Reference text of the PT clip: "Aula cinco de Direito Constitucional. Hoje vamos estudar o artigo dezoito: as restrições aos direitos, liberdades e garantias têm de respeitar o princípio da proporcionalidade, e nunca podem afetar o conteúdo essencial do direito."

| Test | Clip | reasoning | Latency | Output |
|---|---|---|---|---|
| PT wav | 16.8 s | exclude (on) | 21.3 s (714 reasoning tokens) | "A Lei 5 do direito constitucional hoje vamos estudar o artigo 8 as restrições aos direitos liberdade e garantias estão enquadradas no princípio da proporcionalidade e nunca podem afetar o conteúdo essencial do direito." |
| PT wav | 16.8 s | **off** | **4.4 s** | "Aula 5 do Direito Constitucional. Hoje vamos estudar o artigo 8º. As restrições aos direitos, liberdade e garantias estão enquadrando o princípio da proporcionalidade. E nunca podem afetar o conteúdo essencial do direito." (≈ 85% word accuracy; "dezoito"→"8º" is a meaning-changing error) |
| EN mp3, ask for `[mm:ss.s-mm:ss.s]` segments | 9.3 s | exclude (on) | 45.7 s | **Empty**: `finish_reason: length`, all 3,000 tokens spent reasoning |
| EN mp3, segments | 9.3 s | **off** | **0.98 s** | `[0.0-2.0] Hello class.` / `[2.0-4.0] Today we discuss the separation of powers.` / `[4.0-6.0] Legislative.` / `[6.0-8.0] Executive and judicial branches.` The text is right. The **timestamps are invented** (uniform 2 s slots, wrong format, and they stop at 8.0 s while the clip is 9.3 s). |
| PT+EN concatenated mp3 | **209 s** (1.26 MB) | off | 34.1 s | **Failed**: `finish_reason: length` at 3,000 tokens. Output repeated "Hello class…" **43 times** where the audio has 8: a hallucination loop. |

Accounting: `prompt_tokens` 255 for 16.8 s and 2,660 for 209 s, i.e. ≈ **12.7 tokens per audio second**. `prompt_tokens_details.audio_tokens` reported **0**, so it cannot be relied on.

`thinkingmachines/inkling-small:free` (audio input) → **403** `{"message":"thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps","code":403,"metadata":{…"failed_routing_step":"Gate Free Endpoints by Agentic Harness"}}`. Some free models are app-gated, so the picker must handle 403 per model.

**Verdict:** chat-audio on the free omni model is fine for **short clips** (quick "voice question", a ≤ 30 s voice note) with reasoning off. It is **not acceptable for lecture transcription**: the timestamps are fake, it loops on long input, and its numbers are wrong. If it is ever offered as "experimental free cloud transcription":
- cut audio into ≤ 30 s pieces at silences (reuse Trama's `split_long`/`pack`),
- set `max_tokens ≈ 8 × seconds + 64`,
- reject any piece whose output has a repeated n-gram run (e.g. the same ≥ 8-word sequence 3+ times) or more than 4.5 words per second, and fall back for it,
- place the text over the piece's speech span (Trama's `place_heard` with no segments).

### 6b. Dedicated STT endpoint (exists; all models are paid)
- `GET /api/v1/models?output_modalities=transcription` returned **29 models, none free**, all with `endpoints: ["/api/v1/audio/transcriptions"]`. Prices are **per second of audio** (`pricing.prompt`), e.g.:
  - `openai/whisper-large-v3-turbo` 0.00000333 $/s → **≈ $0.018 per 90-min lecture**
  - `nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b`, `qwen/qwen3-asr-0.6b` 0.00000333 $/s
  - `openai/whisper-large-v3` 0.0000075 $/s → ≈ $0.04 per 90 min
  - `nvidia/parakeet-tdt-0.6b-v3` 0.000025 $/s; `openai/whisper-1` 0.0001 $/s ($0.54 per 90 min); `microsoft/mai-transcribe-1.5` 0.36 (!)
- Request (from the docs, and identical to what Trama sends):
```json
POST /api/v1/audio/transcriptions
{"model":"openai/whisper-large-v3-turbo",
 "input_audio":{"data":"<base64>","format":"wav"},
 "language":"pt",
 "response_format":"verbose_json",
 "timestamp_granularities":["segment"],
 "temperature":0}
```
  The response has `text` and `usage: {seconds, input_tokens, output_tokens, total_tokens, cost}`. With `verbose_json` (only on OpenAI-compatible providers such as OpenAI, Groq and Together; others return 400) it also has `language`, `duration` and `segments[{start, end, text, speaker?}]` / `words[…]`. Multipart (`file`, `model`, `language`, `response_format`, `timestamp_granularities[]`) works too. Limits: 25 MB per multipart upload, a 60 s upstream processing timeout per request, so keep sending ≤ 30 s pieces as Trama does. `text`, `srt` and `vtt` formats give 400. The response header `X-Generation-Id` is present.
- Not exercised in the lab (it would spend credit). Trama's `remote.rs` is the reference implementation, including the `REFUSED` → plain-`json` downgrade when `verbose_json` is rejected.
- `/api/v1/models` (chat) also lists audio-**input** chat models (gemini-*, voxtral-small-24b, gpt-audio, qwen3.8-omni-flash, …) and two free ones (the omni above and the gated inkling free models).

**Recommendation:** local whisper.cpp stays the primary path (private and free; model downloaded on demand). The cloud option is a "Cloud transcription (paid, ~2–4 cents per lecture)" toggle using `/audio/transcriptions` with `openai/whisper-large-v3-turbo` as the default (configurable). The claim protocol in the shared class folder makes sure only one member pays. There is no free cloud STT to promise.

---

## 7. Embeddings

- `GET /api/v1/embeddings/models` → 38 models. **Free ones:** `nvidia/nemotron-3.5-embed-1b:free`, `nvidia/nemotron-3.5-embed-8b:free` (32k ctx, multilingual, text+image), `nvidia/nemotron-3-embed-1b:free`, `nvidia/llama-nemotron-embed-vl-1b-v2:free`, `liquid/lfm-2.5-embedding-350m:free` (512-token ctx, 1024-d; its description says requests "may be retained and used to train").
- `POST /api/v1/embeddings` with `{"model":"nvidia/nemotron-3.5-embed-1b:free","input":[6 strings],"encoding_format":"float"}` → **502** `{"error":{"message":"HTTP 500: {\"object\":\"error\",\"message\":\"service inference failed\",\"type\":\"server_error\"}","code":502}}`
- Same with `nvidia/llama-nemotron-embed-vl-1b-v2:free` → **200 in 0.56 s**:
```json
{"object":"list","data":[{"object":"embedding","embedding":[…2048 floats…],"index":0},…],
 "model":"private/openrouter/nvidia/llama-nemotron-embed-vl-1b-v2","provider":"Nvidia","id":"…",
 "usage":{"prompt_tokens":586,"total_tokens":586,"cost":0,"is_byok":false,…}}
```
  Cosine ranking for the query "Um regulamento municipal pode restringir a liberdade de propaganda política de um só partido?": transcript 0.481 > art. 18 0.275 > art. 37 0.264 > art. 13 0.176 > art. 64 0.079. That ranking is sensible.

**Recommendation:** default to **local BM25** with PT/ES/EN stemming and accent folding: `tantivy` in Rust, or MiniSearch in TS. BM25 is private, offline, has no rate limits, and works for law articles where exact terms ("artigo 18.º", "conteúdo essencial") matter most. Offer free embeddings as an **opt-in** hybrid re-ranker ("Smarter search, sends text to a free provider"), cached locally per `(embeddingModelId, chunkSha256)` in app data, **not** in the synced class folder: vectors depend on the model, and each member may choose differently. Retry 502 once, then fall back to BM25-only without telling the user it failed.

---

## 8. Error taxonomy (observed JSON) and student-facing messages

All errors are `{"error":{"code":<int>,"message":"…","metadata":{…}?}}` and sometimes carry a top-level `"user_id":"user_…"`. **Never show or log `user_id` or `metadata.raw` to the student.** The header `x-openrouter-error-origin: client | provider` tells you who failed.

| Status | When (observed) | Body (exact or trimmed) | Retry? | Code | Student message (EN; i18n keys for PT/ES) |
|---|---|---|---|---|---|
| 401 | wrong key (`sk-or-v1-000…`) | `{"error":{"message":"User not found.","code":401}}`, origin `client` | no | `AUTH` | "Your OpenRouter key was not accepted. Check it in Settings → AI." |
| 400 | unknown model id | `{"error":{"message":"google/does-not-exist:free is not a valid model ID","code":400},"user_id":"…"}` | no; refresh catalog, offer the default | `MODEL_UNKNOWN` | "The model “{id}” no longer exists on OpenRouter. Pick another in Settings." |
| 400 | malformed body | `{"error":{"message":"Input required: specify \"prompt\" or \"messages\"","code":400}}` | no (bug) | `BAD_REQUEST` | "Something went wrong preparing the request (bug). Please report it." |
| 400 | context too long (lfm-2.5 64k) | `{"error":{"message":"This endpoint's maximum context length is 65536 tokens. However, you requested about 77013 tokens (76963 of text input, 50 in the output). Please reduce the length of either one, or use the context-compression plugin to compress your prompt automatically.","code":400,"metadata":{"provider_name":null}}}` | once, after trimming passages/history (or switch to a long-context model) | `TOO_LONG` | "This is too much text for {model}. Tramado trimmed it, or choose a model with a larger context." |
| 402 | not reproduced (would need spending). Docs: insufficient credits; with `Retry-After` it is wait-and-retry, without it it is not | – | no | `NO_CREDIT` | "Your OpenRouter account has no credit for this model. Use a free model or add credit at openrouter.ai/credits." |
| 403 | app-gated free model | `{"error":{"message":"thinkingmachines/inkling-small:free is only available on agentic harnesses. …","code":403,"metadata":{"failed_routing_step":"Gate Free Endpoints by Agentic Harness",…}}}` | no; hide that model | `MODEL_GATED` | "This free model is not available to Tramado. Pick another." |
| 403 | moderation (docs): `metadata.reasons[]`, `flagged_input` | – | no | `FLAGGED` | "The provider refused this content." |
| 404 | `require_parameters` filter | `"No endpoints found that can handle the requested parameters…","metadata":{"failed_routing_step":"Filter by Parameters"}` | retry without the strict param | `UNSUPPORTED` | (internal; fall back silently) |
| 404 | data-policy filter (free NVIDIA + deny; any free + zdr; or account privacy setting) | `"No endpoints found matching your data policy (Free model training). Configure: https://openrouter.ai/settings/privacy"` / `"… (Zero data retention) …"`, `failed_routing_step: "Filter by Data Policy"` | no | `PRIVACY_BLOCKS` | "Your privacy settings block this free model. Switch Tramado to Free mode, choose a paid private model, or allow free models at openrouter.ai/settings/privacy." |
| 429 | upstream shared pool (gemma, xing) | `{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemma-4-31b-it:free is temporarily rate-limited upstream. …","provider_name":"Google AI Studio","is_byok":false,"provider_error_code":"429","limit_source":"upstream_provider_shared_pool","remedy_hint":"…"}}}`, origin `provider`, **no `Retry-After`, no `X-RateLimit-*`**, answered in 0.25–0.5 s | yes: next model in the chain, then backoff | `BUSY` | "Free AI models are busy right now. Retrying… (or choose another model)" |
| 429 | OpenRouter free-tier limit (docs) | `{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}` + `X-RateLimit-Limit/Remaining/Reset` (Reset = epoch ms) | per-minute: wait until Reset. per-day: stop until 00:00 UTC | `FREE_LIMIT` | "You've used today's free AI requests ({used}/{limit}). They reset at {local time of 00:00 UTC}." |
| 502 | upstream failure (embeddings) | `{"error":{"message":"HTTP 500: {…\"service inference failed\"…}","code":502}}` | yes (1–2×) | `UPSTREAM` | "The AI provider failed. Retrying…" |
| 503 | no provider meets routing (docs); may carry `Retry-After` | – | yes, honour Retry-After | `UNAVAILABLE` | "No provider is available for this model right now." |
| 408 / network / timeout | – | – | yes (1–2×) | `TIMEOUT`/`OFFLINE` | "Couldn't reach OpenRouter. Check your connection." |
| 200 + `finish_reason:"length"` + empty | reasoning ate the budget (§3) | – | once, with more tokens or less effort | `LENGTH` | "The model ran out of room…" |
| 200 + `error` in body / mid-stream `finish_reason:"error"` | docs | `"error":{"code":"server_error","message":"Provider disconnected unexpectedly"}` | yes, once | `UPSTREAM` | as for 502 |

Prefer `error.metadata.error_type` (`rate_limit_exceeded`, `authentication`, `context_length_exceeded`, `server`…) over the HTTP status when it is present (docs). In the lab it was only present in the docs' platform-429 example; the observed provider 429 used `limit_source`.

### Free-tier limits (docs, https://openrouter.ai/docs/api/reference/limits, fetched 2026-11-03)
| Credits ever purchased | `:free` req/min | `:free` req/day |
|---|---|---|
| < 10 | 20 | 50 |
| ≥ 10 | 20 | 1000 |
The lab key shows `"is_free_tier": <redacted>` and `"free_model_daily_requests": {"used": <redacted>, "limit": <redacted>, "remaining": <redacted>}` at the start and `{"used": <redacted>, …}` at the end. Between those two reads, 48 POSTs went to free models and the counter rose by exactly 32. The 16 that did not count were the 7 upstream 429s, 8 routing/validation rejections (400/403/404 before any provider) and the 1 bad-key 401. One 502 from the embeddings upstream **did** count, and embeddings count as free-model requests. **Inference:** attempts rejected before inference, or rate-limited upstream, do not use up the daily quota. The per-minute limit is not reported anywhere.

Client-side guard: a token bucket of **18 req/min** across all features for `:free` models, at most 3 concurrent requests, and a background queue for bulk jobs (flashcards over a whole class, embeddings).

---

## 9. Headers and privacy routing

### Attribution headers (docs, https://openrouter.ai/docs/app-attribution)
```
HTTP-Referer: https://github.com/<org>/tramado      # required for an app page / rankings; a URL
X-OpenRouter-Title: Tramado                        # display name; needed for localhost/desktop apps
X-OpenRouter-Categories: education                 # optional; ≤2, lowercase-hyphenated, unknown values dropped (category list unverified)
```
`X-Title` still works (legacy, sent in the lab). Optionally send `X-OpenRouter-App-Visibility: hidden` to stay out of public rankings. Do **not** set the `user` field to anything identifying: OpenRouter already forwards a `user` value upstream (seen in the debug echo).

### Provider routing tested with free models
| Request | Result |
|---|---|
| super-vl:free + `provider: {data_collection: "deny"}` | **404** "No endpoints found matching your data policy (Free model training)" |
| super-vl:free + `provider: {zdr: true}` | **404** "… (Zero data retention)" |
| gemma-4-31b:free + `{data_collection: "deny"}` | passed the policy filter and reached Google AI Studio (got 429 busy). **Gemma free is deny-compatible.** |
| gemma-4-31b:free + `{zdr: true}` | **404** "… (Zero data retention)" |
| chain [gemma-31b, super-vl, ultra] + deny | **429** (gemma was the only eligible model and it was busy). The NVIDIA models were silently filtered out. |

Consequences for Tramado:
- **Free mode** (default for the free models): send no `provider` filter. In onboarding, state plainly: "Free models are run by providers that may log your prompts and use them for training. Don't paste personal data." The account-level setting at openrouter.ai/settings/privacy can also block free models. That shows up as the same 404 `PRIVACY_BLOCKS`, so the message must point there.
- **Private mode**: `provider: {data_collection: "deny", zdr: true}`. The picker then shows **paid** models only (filter by fetching `/models/{id}/endpoints`, or simply let the 404 explain). Trama's ZDR defaults (`anthropic/claude-haiku-5.5`, `openai/whisper-large-v3`) are sensible paid suggestions.
- Optional middle ground, **"No training"**: `data_collection: "deny"` only. Gemma free works when it isn't busy; NVIDIA free does not.

---

## 10. Key and model-catalog endpoints

### `GET /api/v1/key` (works with a normal inference key)
```json
{"data":{"label":"sk-or-v1-<redacted>","is_management_key":false,"is_provisioning_key":false,
 "limit":"<redacted>","limit_reset":null,"limit_remaining":"<redacted>","include_byok_in_limit":false,
 "budgets":[{"scope":"key_limit","limit_usd":"<redacted>","spend_usd":"<redacted>","remaining_usd":"<redacted>","reset_interval":null,…}],
 "effective_budget":{…},
 "usage":"<redacted>","usage_daily":"<redacted>","usage_weekly":"<redacted>","usage_monthly":"<redacted>",
 "byok_usage":0,…,"is_free_tier":"<redacted>","expires_at":"<redacted>",
 "creator_user_id":"<redacted>","organization_id":null,"workspace_id":"<redacted>","allowed_data_regions":["global"],
 "free_model_daily_requests":{"used":"<redacted>","limit":"<redacted>","remaining":"<redacted>"},
 "rate_limit":{"requests":-1,"interval":"10s","note":"This field is deprecated and safe to ignore."}}}
```
Use it for: (a) the "Test key" button (200 → valid, 401 → invalid), (b) showing credit remaining (`limit_remaining`, null when the key has no cap), (c) the free-request meter (`free_model_daily_requests`), (d) a warning about `expires_at`, and (e) `is_free_tier: true` → "50 free requests per day; buying 10 credits raises this to 1000".

### `GET /api/v1/models` (public; 419 models; ~800 KB; cache for 24 h in app data)
Per model: `id, name, description, context_length, created, expiration_date, architecture{input_modalities[], output_modalities[], tokenizer}, pricing{prompt, completion, audio?, image?, …} (strings, USD per token; "-1" = router/variable), top_provider{context_length, max_completion_tokens, is_moderated}, supported_parameters[], default_parameters{}, reasoning{mandatory, default_enabled, supported_efforts?, default_effort?, supports_max_tokens?}, endpoints[] (API paths), links.details`.

Picker derivations:
```ts
const isFree = (m) => m.id.endsWith(':free') || (m.pricing.prompt === '0' && m.pricing.completion === '0' && m.id !== 'openrouter/free');
const caps = (m) => ({
  free: isFree(m),
  tools: m.supported_parameters.includes('tools'),
  strictJson: m.supported_parameters.includes('structured_outputs'),     // json_schema enforced
  jsonMode: m.supported_parameters.includes('response_format'),          // may still ignore json_schema (gemma)
  reasoning: m.supported_parameters.includes('reasoning'),
  reasoningMandatory: !!m.reasoning?.mandatory,
  efforts: m.reasoning?.supported_efforts,                               // e.g. ["high","medium","none"]
  vision: m.architecture.input_modalities.includes('image'),
  audioIn: m.architecture.input_modalities.includes('audio'),
  chat: m.endpoints.includes('/api/v1/chat/completions'),                // excludes ":batch" variants (endpoints: [])
  context: m.context_length, maxOut: m.top_provider.max_completion_tokens,
  deprecated: m.expiration_date,
});
```
Other catalogs: `GET /api/v1/models?output_modalities=transcription` (STT, §6b), `GET /api/v1/embeddings/models` (§7), `GET /api/v1/models/{id}/endpoints` (providers, per-endpoint `supported_parameters`, `uptime_last_30m`, `status`, `max_prompt_tokens`). The `endpoints` field of the chat models also flags `:batch` models (empty list) and `/api/v1/images` models; hide those.

Free chat models today (id · ctx · tools · strict-JSON · input):
`google/gemma-4-31b-it:free` 262k ✓ ✗ text+image+video · `google/gemma-4-26b-a4b-it:free` 262k ✓ ✗ · `nvidia/nemotron-3.5-super-vl:free` 1M ✓ ✓ text+image+video · `nvidia/nemotron-3-ultra-550b-a55b:free` 1M ✓ ✗(forwarded anyway) · `nvidia/nemotron-3.5-lightning:free` 1M ✓ ✗ · `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` 256k ✓ ✗ **+audio** · `xingchen-agi/xing4.0-29b-a4b:free` 262k ✓ ✓ · `dots-studio/dots-3-note-preview:free` 512k ✓ ✓ · `liquid/lfm-2.5-2.6b:free` 64k ✓ ✓ (reasoning mandatory) · `recursive/flint-v1.0:free` 262k ✓ ✗ (mandatory) · `cohere/north-mini-code:free` 256k ✓ ✗ · `thinkingmachines/inkling(-small):free` 1M (403 gated) · `nvidia/nemotron-3.5-content-safety:free` (classifier; hide) · router `openrouter/free` (200k, tools ✓).

---

## 11. Client spec (TS types + Rust-ready)

### 11.1 Placement
- **Rust (`src-tauri/src/ai/`)** owns the key, read from the OS keychain (`keyring` crate) or app config, **never** from a synced class folder. It also does all HTTP (reqwest + `bytes_stream()` for SSE, or ureq's blocking reader as in Trama), retries, the rate-limit bucket and the catalog cache.
- **TS** builds the *intent* (messages, tool schemas, task kind), receives events over a Tauri `Channel<AiEvent>`, executes tool calls locally (search and read run against the local index, which Rust may also own), and renders.

### 11.2 Types
```ts
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_CHAT_MODEL = 'google/gemma-4-31b-it:free';
export const DEFAULT_FALLBACKS = ['google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free']; // chain ≤ 3 incl. primary
export const DEFAULT_STT_MODEL = 'openai/whisper-large-v3-turbo';   // paid, cloud option only
export type Privacy = 'free' | 'no-training' | 'private';

export type Task = 'chat' | 'exam-answer' | 'extract-questions' | 'summary' | 'notes' | 'flashcards' | 'title' | 'audio-short';
export interface AiSettings { model: string; fallbacks: string[]; privacy: Privacy; showReasoning: boolean; }

export interface ChatRequest {
  model: string; models?: string[];                       // models[0] === model; length ≤ 3
  messages: Msg[]; tools?: Tool[]; tool_choice?: 'auto' | 'none' | 'required';
  max_tokens: number; temperature?: number;
  reasoning?: { enabled?: boolean; effort?: 'xhigh'|'high'|'medium'|'low'|'minimal'|'none'; exclude?: boolean; max_tokens?: number };
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: object } };
  provider?: { data_collection?: 'allow' | 'deny'; zdr?: boolean; require_parameters?: boolean };
  stream?: boolean;
}
export type Msg =
  | { role: 'system' | 'user'; content: string | Part[] }
  | { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[]; reasoning?: string; reasoning_details?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type Part = { type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: 'wav'|'mp3'|'flac'|'ogg'|'m4a'|'aac' } }
                 | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; index?: number; function: { name: string; arguments: string } }

export type AiErrorCode = 'AUTH'|'MODEL_UNKNOWN'|'BAD_REQUEST'|'TOO_LONG'|'NO_CREDIT'|'MODEL_GATED'|'FLAGGED'|'UNSUPPORTED'
  |'PRIVACY_BLOCKS'|'BUSY'|'FREE_LIMIT'|'UPSTREAM'|'UNAVAILABLE'|'TIMEOUT'|'OFFLINE'|'LENGTH'|'CANCELLED';
export type AiEvent =
  | { kind: 'started'; model: string; provider?: string; generationId?: string }
  | { kind: 'heartbeat' }                                // ": OPENROUTER PROCESSING"
  | { kind: 'reasoning'; text: string }
  | { kind: 'content'; text: string }
  | { kind: 'tool_calls'; calls: ToolCall[] }             // emitted once, complete, at finish
  | { kind: 'done'; finish: string; usage?: Usage; model: string }
  | { kind: 'retrying'; code: AiErrorCode; inMs: number; nextModel?: string }
  | { kind: 'error'; code: AiErrorCode; detail?: string; retryAt?: number };
```

### 11.3 Request builder
```ts
const PROFILE: Record<Task, { maxTokens: number; reasoning?: ChatRequest['reasoning']; temperature: number }> = {
  'exam-answer':       { maxTokens: 8000, reasoning: { effort: 'medium', exclude: true }, temperature: 0.2 },
  'chat':              { maxTokens: 4000, reasoning: { effort: 'low', exclude: true },    temperature: 0.4 },
  'extract-questions': { maxTokens: 8000, reasoning: { effort: 'low', exclude: true },    temperature: 0 },
  'summary':           { maxTokens: 4000, reasoning: { effort: 'low', exclude: true },    temperature: 0.3 },
  'notes':             { maxTokens: 4000, reasoning: { effort: 'low', exclude: true },    temperature: 0.3 },
  'flashcards':        { maxTokens: 6000, reasoning: { effort: 'low', exclude: true },    temperature: 0.5 },
  'title':             { maxTokens: 400,  reasoning: { enabled: false },                  temperature: 0.2 },
  'audio-short':       { maxTokens: 600,  reasoning: { enabled: false },                  temperature: 0 },
};
function build(task: Task, s: AiSettings, cat: Catalog, messages: Msg[], extra: Partial<ChatRequest> = {}): ChatRequest {
  const needs = { tools: !!extra.tools, audio: task === 'audio-short' };
  const chain = [s.model, ...s.fallbacks]
    .filter((id, i, a) => a.indexOf(id) === i)
    .filter(id => { const c = cat.caps(id); return c && (!needs.tools || c.tools) && (!needs.audio || c.audioIn); })
    .slice(0, 3);                                             // OpenRouter accepts ≤ 3
  const p = PROFILE[task]; const top = cat.caps(chain[0]);
  let reasoning = p.reasoning;
  if (top?.reasoningMandatory && reasoning?.enabled === false) reasoning = { effort: 'low', exclude: true };
  if (s.showReasoning && reasoning?.exclude) reasoning = { ...reasoning, exclude: false };
  const body: ChatRequest = {
    model: chain[0], ...(chain.length > 1 ? { models: chain } : {}),
    messages, max_tokens: Math.min(p.maxTokens, top?.maxOut ?? p.maxTokens), temperature: p.temperature,
    ...(top?.reasoning ? { reasoning } : {}), stream: true, ...extra,
  };
  if (s.privacy === 'no-training') body.provider = { data_collection: 'deny' };
  if (s.privacy === 'private') body.provider = { data_collection: 'deny', zdr: true };
  if (body.response_format && !top?.strictJson) delete body.response_format;   // schema stays in the prompt
  return body;
}
```
Headers on every request: `Authorization: Bearer <key>`, `Content-Type: application/json`, `HTTP-Referer: https://github.com/<org>/tramado`, `X-OpenRouter-Title: Tramado`.

### 11.4 Error mapping (Rust)
```rust
pub enum AiErr { Auth, ModelUnknown, BadRequest, TooLong, NoCredit, ModelGated, Flagged, Unsupported,
                 PrivacyBlocks, Busy, FreeLimit { reset_ms: Option<u64> }, Upstream, Unavailable { retry_after_s: Option<u64> },
                 Timeout, Offline, Length, Cancelled }

pub fn classify(status: u16, headers: &HeaderMap, body: &serde_json::Value) -> AiErr {
    let msg = body.pointer("/error/message").and_then(|v| v.as_str()).unwrap_or("");
    let meta = body.pointer("/error/metadata");
    let step = meta.and_then(|m| m.get("failed_routing_step")).and_then(|v| v.as_str()).unwrap_or("");
    let etype = meta.and_then(|m| m.get("error_type")).and_then(|v| v.as_str()).unwrap_or("");
    let hdr = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<u64>().ok());
    match status {
        401 => AiErr::Auth,
        402 => AiErr::NoCredit,
        403 if step.contains("Agentic Harness") => AiErr::ModelGated,
        403 => AiErr::Flagged,
        404 if step == "Filter by Data Policy" || msg.contains("data policy") => AiErr::PrivacyBlocks,
        404 if step == "Filter by Parameters" => AiErr::Unsupported,
        404 => AiErr::ModelUnknown,
        400 if msg.contains("not a valid model ID") => AiErr::ModelUnknown,
        400 if msg.contains("maximum context length") || etype == "context_length_exceeded" => AiErr::TooLong,
        400 | 422 => AiErr::BadRequest,
        408 | 504 => AiErr::Timeout,
        429 if meta.and_then(|m| m.get("limit_source")).is_some()
               || headers.get("x-openrouter-error-origin").map_or(false, |v| v == "provider") => AiErr::Busy,
        429 => AiErr::FreeLimit { reset_ms: hdr("x-ratelimit-reset") },
        503 => AiErr::Unavailable { retry_after_s: hdr("retry-after") },
        _ => AiErr::Upstream,                                   // 500, 502, …
    }
}
```

### 11.5 Retry, backoff and fallback policy
1. **One request carries the model chain** (`models`, ≤ 3). OpenRouter itself moves to the next model on 429/5xx, which takes about 0.25–0.5 s per failed model.
2. On `Busy` (whole chain 429) or `Upstream`/`Timeout`/`Unavailable`/`OFFLINE`: retry up to **3×** with backoff `min(30 s, 2^n s) ± 30% jitter` (2, 4, 8 s). Honour `Retry-After` when present. Emit `retrying` events. Cancellation must interrupt the sleep (as Trama's loop does).
3. Optional extra chain: after the first `Busy`, retry with `[next 3 capable free models from the catalog]`, e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`, `openrouter/free`. Only do this in Free mode and only for non-loop tasks; inside a tool loop, keep the pinned model.
4. `FreeLimit`: if `X-RateLimit-Remaining == 0` with a near reset (< 90 s), wait. Otherwise stop and show the daily-limit message with reset at 00:00 UTC. Call `GET /key` to show used/limit.
5. `TooLong`: one automatic retry after shrinking (drop the oldest tool results, cut passages to 60%). Then give up.
6. `Length` (empty content): one retry with `max_tokens = min(2×, maxOut)` and the effort one step lower.
7. No retry: `Auth`, `ModelUnknown`, `BadRequest`, `NoCredit`, `ModelGated`, `Flagged`, `PrivacyBlocks`. `Unsupported`: drop `response_format`/`require_parameters` and resend once.
8. Global client throttle: 18 req/min for `:free`, ≤ 3 in flight, bulk jobs queued at lower priority. Timeouts: connect 15 s, first byte 120 s (heartbeats reset an idle timer of 30 s), total 300 s.

### 11.6 Streaming parser (TS reference; port to Rust 1:1)
```ts
export async function* sse(res: Response): AsyncGenerator<AiEvent> {
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const body = await res.json().catch(() => null);
    yield { kind: 'error', ...mapError(res.status, res.headers, body) }; return;
  }
  const dec = new TextDecoder(); let buf = ''; let finish: string | null = null; let started = false;
  const calls: ToolCall[] = []; let usage; let model = '';
  const reader = res.body!.getReader();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
      if (line === '') continue;                               // event separator
      if (line.startsWith(':')) { yield { kind: 'heartbeat' }; continue; }   // ": OPENROUTER PROCESSING"
      if (!line.startsWith('data:')) continue;                 // ignore event:/id: fields
      const data = line.slice(5).trimStart();
      if (data === '[DONE]') { yield* finish_(); return; }
      let j: any; try { j = JSON.parse(data); } catch { continue; } // never throw on a bad line
      if (j.debug) continue;                                    // debug echo chunk (choices: [])
      if (!started && j.model) { started = true; model = j.model; yield { kind: 'started', model: j.model, provider: j.provider, generationId: j.id }; }
      if (j.error) { yield { kind: 'error', code: j.error.code === 'rate_limit_exceeded' ? 'BUSY' : 'UPSTREAM', detail: j.error.message }; return; }
      if (j.usage) usage = j.usage;                             // final accounting chunk (repeats finish_reason)
      const c = j.choices?.[0]; if (!c) continue;
      const d = c.delta ?? {};
      if (d.reasoning) yield { kind: 'reasoning', text: d.reasoning };
      if (d.content) yield { kind: 'content', text: d.content };
      for (const t of d.tool_calls ?? []) {                     // first fragment: id/type/name, then argument pieces
        const k = t.index ?? 0;
        calls[k] ??= { id: t.id, type: 'function', function: { name: t.function?.name ?? '', arguments: '' } };
        if (t.id) calls[k].id = t.id;
        if (t.function?.name) calls[k].function.name = t.function.name;
        if (t.function?.arguments) calls[k].function.arguments += t.function.arguments;
      }
      if (c.finish_reason && !finish) finish = c.finish_reason;  // take the FIRST one
      if (finish === 'error') { yield { kind: 'error', code: 'UPSTREAM' }; return; }
    }
  }
  yield* finish_();   // stream closed without [DONE]: still report what we have
  function* finish_(): Generator<AiEvent> {
    if (calls.length) yield { kind: 'tool_calls', calls: calls.filter(Boolean) };
    // Caller detects LENGTH: finish === 'length' && no content && no calls.
    yield { kind: 'done', finish: finish ?? 'unknown', usage, model };
  }
}
```
Rust: `reqwest::Response::bytes_stream()`, split on `\n` with the same rules, forwarding to `tauri::ipc::Channel<AiEvent>`. Cancellation = drop the response (closes the connection).

### 11.7 Tool loop
```ts
async function answerQuestion(q: string, ctx: ClassContext): Promise<CitedAnswer> {
  const refs = new RefTable();                 // S# ↔ {docId|recId, page/article|t, snippet}
  const msgs: Msg[] = [{ role: 'system', content: SYSTEM_EXAM(ctx.lang) }, { role: 'user', content: q }];
  let pinned: string | undefined; let toolCalls = 0;
  for (let turn = 0; turn < 8; turn++) {
    const last = turn === 7 || toolCalls >= 16;
    if (last) msgs.push({ role: 'user', content: NUDGE(ctx.lang) });
    const req = build('exam-answer', ctx.settings, ctx.catalog, msgs, { tools: TOOLS, tool_choice: last ? 'none' : 'auto' });
    if (pinned) { req.model = pinned; req.models = [pinned, ...(req.models ?? []).filter(m => m !== pinned)].slice(0, 3); }
    const r = await run(req);                  // stream → {model, content, reasoning_details, tool_calls, usage, finish}
    if (pinned && r.model !== pinned) stripReasoning(msgs);   // model changed under us
    pinned = r.model;
    msgs.push({ role: 'assistant', content: r.content ?? null, tool_calls: r.tool_calls, reasoning: r.reasoning, reasoning_details: r.reasoning_details });
    if (!r.tool_calls?.length) return finalize(r.content, refs);              // parse [S#], validate against refs
    const results = await Promise.all(r.tool_calls.slice(0, 6).map(tc => execTool(tc, refs, ctx)));  // dedupe queries, cap sizes
    toolCalls += r.tool_calls.length;
    r.tool_calls.forEach((tc, i) => msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(results[i]) }));
    if ((r.usage?.prompt_tokens ?? 0) > 24_000) elideOldToolResults(msgs);
  }
  throw new AiError('LENGTH');
}
```

### 11.8 Token budgeting for passages
- Measured ratio: **3.74 chars/token** (PT text, NVIDIA tokenizer: 370,669 chars = 99,031 tokens). OpenRouter's own pre-check estimated 4.05 chars/token. Budget with **3.5 chars/token** (conservative across PT/ES/EN and the Gemma tokenizer).
- Chunking for the index: 1,200–2,000 chars (≈ 350–550 tokens) per chunk, split on article/heading/paragraph boundaries. Law documents get **one chunk per article** (e.g. "Artigo 18.º"), keeping the article number and page as the anchor. Transcripts get 60–90 s windows aligned to segment boundaries, with the `[hh:mm:ss]` start as the anchor.
- Per-request budget (prompt): system + tool schemas ≈ 1.5k tokens, question ≈ 0.5k, retrieved material ≤ **12k tokens** (≈ 42k chars, ≈ 8–12 passages), history ≤ 24k before elision. Hard ceiling = `min(context_length − max_tokens − 1k, 60k)`. Bigger contexts work (a 99k-token prompt took 7.4 s to first token) but they are slower, burn the shared free pool, and are not needed.
- "Stuff the whole document" mode (e.g. summarise one PDF) is allowed when `chars / 3.5 + max_tokens < 0.8 × context_length`. Otherwise map-reduce over 20k-token sections.

### 11.9 Exam-extraction pipeline
`text (from PDF/DOCX/OCR)` → `build('extract-questions', …)` with the schema in the prompt (+ `response_format` if `strictJson`) → `tolerantParse` → `zod.safeParse` → `normalise()` (labels, points, kinds as in §5) → [on failure: 1 repair call] → editable list in the UI → per-question `answerQuestion()` (§11.7), run sequentially with throttle (each question is a tool loop of 4–8 requests; a 10-question exam ≈ 40–80 requests, a large share of a 50/day free account, so show an estimate before starting).

```ts
export function tolerantParse(s: string): unknown | null {
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) s = fence[1];
  const i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i < 0 || j <= i) return null;
  const core = s.slice(i, j + 1);
  for (const t of [core, core.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')]) { try { return JSON.parse(t); } catch {} }
  return null;
}
```

---

## 12. Open items / caveats
- 402 and the platform (non-upstream) 429 were not reproduced. Their shapes come from the docs (`error_type: "rate_limit_exceeded"`, `X-RateLimit-Reset`). Mid-stream errors are also docs-only.
- The `models` array limit (3) was established earlier, not re-tested.
- Free-model availability changes quickly (new free models appear and disappear weekly). Ship defaults as data (a JSON in the app that can be updated with a release) and always validate them against the live catalog at startup. If the default disappears from `/models`, fall back to the first free model with `tools` and context ≥ 128k.
- gemma-4-31b-it:free was unusable for this whole session. If that persists, consider suggesting BYOK (Google AI Studio key at openrouter.ai/workspaces/default/byok, which the 429 `remedy_hint` itself recommends). Otherwise make `nvidia/nemotron-3.5-super-vl:free` the effective first choice while keeping the user's chosen default visible.

Sources: https://openrouter.ai/docs/api/reference/limits · https://openrouter.ai/docs/api/reference/errors-and-debugging · https://openrouter.ai/docs/api/reference/streaming · https://openrouter.ai/docs/guides/best-practices/reasoning-tokens · https://openrouter.ai/docs/guides/routing/provider-selection · https://openrouter.ai/docs/app-attribution · https://openrouter.ai/docs/guides/overview/multimodal/audio · https://openrouter.ai/docs/guides/overview/multimodal/stt · https://openrouter.ai/docs/guides/features/structured-outputs (all fetched 2026-11-03).
