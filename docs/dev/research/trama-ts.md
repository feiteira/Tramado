# Trama → Tramado: reuse map of the platform-free TypeScript

Research date: 2026-11-03. Source: `/home/feiteira/Trama` (read only; app version 0.1.0, MPL-2.0).
Lab (all experiments, runnable): `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/trama-ts/`

---

## 0. TL;DR

| Area | Verdict | Why |
|---|---|---|
| `core/i18n` (typed catalogs, `t`/`tp`) + `ui/i18n.tsx` | **KEEP as is** (new namespaces) | 84 lines of machinery. A missing key fails `tsc`, and a test catches untranslated copies and lost placeholders. |
| `core/import` (txt, md, docx, odt, rtf, html, pdf, vtt, srt, transcript text) | **KEEP**, with small **ADAPT**s | Hardened parsers (encodings, zip bombs, hyphenation, Teams/Zoom VTT). Add `pptx` and keep PDF `pageStarts`. |
| `core/import` csv / xlsx / survey | **DROP** (or park) | These are survey → document tools for QDA. Students don't need them, and dropping them removes `papaparse`. |
| `core/qda/rank.ts` (BM25) | **KEEP the algorithm, ADAPT into an index** | It is a good fit for RAG with citations. It re-tokenises the whole corpus on every query (about 240 ms for 6 M chars). The indexed version in the lab ranks identically and answers in 6–16 ms. |
| `core/qda/text.ts`, `util.ts`, `stopwords/*`, `search.ts` (boolean search + KWIC) | **KEEP as is** | Platform-free. They depend only on each other. |
| `core/qda/*` everything else (agreement, cooccurrence, matrix, segments, ranges, attributes, charts, crosstab, tree, pseudonymise, stats, wordfreq) | **DROP** | These are QDA analysis modules. `wordfreq` could come back later for a "key terms of this class" view. |
| `core/text/markdown.ts`, `normalize.ts` | **KEEP** | Renders AI answers, chat (`breaks: true`) and notes. Add an inline citation node. |
| `core/speech/*` (types, transcript + echo removal, timing, wav) | **KEEP** | `Transcription` makes a good on-disk transcript schema. `dropEcho` is needed for online classes. |
| `core/service/config.ts` | **ADAPT** | Default model becomes `google/gemma-4-31b-it:free` plus a fallback list. ZDR must be optional. The key goes to secrets. |
| `core/service/prompt.ts` (Draft an answer, numbered sources) | **KEEP the shape, ADAPT the text and limits** | Tested live: a free model cited `[1] [2] [3]` correctly and said what was missing. `DRAFT_MAX_TOKENS = 900` is too low for reasoning models. |
| `services/service.ts` | **DROP** (store-meta "enabled per project" + audit log) | In Tramado the AI is a user setting, not a per-project permission. |
| `services/transcription.ts` | **ADAPT** | Keep the engine loop (start → poll → take → layout, plus error codes). The store-meta queue becomes a file-based claim protocol in the class folder. |
| `services/recording.ts` | **ADAPT heavily** | Drop the encrypted frame sealing. Rust should write the audio file itself, outside the synced folder until the recording stops. |
| `services/questions.ts` | **ADAPT** | Keep `questionName` and the draft flow. Drop the codes/codings/memos plumbing. Retrieval becomes automatic (BM25) instead of passages the student links. |
| `services/jobs.ts`, `prefs.ts` | **KEEP** (prefs: adapt the keys) | Small and generic. |
| `platform/types.ts` | **ADAPT** (new interface, see §8) | Drop keyring, library, projects/SQL, kdf and blobs. Add fs, secrets, ai, sync, speech-model download, and a media URL. |
| `platform/tauri.ts` | **ADAPT** | Keep `call`/`toPlatformError`/`toBytes`/`body`, raw-body IPC with headers, `joinPath`, the e2e dialog queue and `onBeforeExit`. |
| `platform/memory.ts`, `fakeSpeech.ts`, `fakeService.ts` | **ADAPT** | Same pattern. Add a fake Syncthing "mesh" of several memory devices for Vitest. |
| `platform/sqljs.ts`, `core/store`, `core/crypto`, `core/hlc`, `core/model`, `core/export/refi`, `core/export/trama`, `core/privacy` | **DROP** | No SQL, no encryption, no REFI-QDA. Optionally adapt `privacy/flows.ts` later for a PRIVACY.md. |
| `core/export/office` (docx/html/csv/xlsx writers) | **OPTIONAL KEEP** | Depends only on `fflate` + `refi/xml.ts` (`xmlAttr`, `xmlText`). Useful for exporting notes or answers to Word. |

**I verified the core claim.** The KEEP subset is `core/import`, `core/qda/{rank,text,util,search,stopwords}`, `core/text`, `core/speech`, `core/service`, `core/i18n/{translate,languages}` and `core/bytes.ts`: 5,746 lines. I copied it into a standalone folder with a 3-line `model/types.ts` shim. It typechecks under Trama's strict tsconfig, and **all 266 of Trama's tests for those modules pass** (20 test files, about 4 s). See §9.

---

## 1. How Trama's TypeScript is laid out (what matters for reuse)

- `app/src/core/` has no DOM and no React. It runs in Vitest under Node.
- `app/src/services/` has no DOM. It is written against a `Platform` and a SQL `Store`.
- `app/src/platform/` is the device boundary: `types.ts`, plus `tauri.ts` (IPC to Rust), and `memory.ts` + `sqljs.ts` for tests and the demo.
- `main.tsx` picks the platform. If `'__TAURI_INTERNALS__' in window`, it uses `createTauriPlatform()`. Otherwise it runs `bootDemo()` (`demo/boot.ts`): a memory platform seeded with an example project, plus URL flags `?speech=fake`, `?service=fake`, `?lang=`, `?clock=` (frozen time and seeded randomness for screenshots) and `?route=`.
- Trama's webview has **no network access**. AI calls go through Rust (`desktop/src-tauri/src/service/mod.rs`, `ureq`), allowed only to `openrouter.ai` and hosts the user confirmed.

**Dependency facts of the reusable core** (from `grep import`):
- `core/import/*` → `../bytes` (`fromWindows1252`) and `../model/types` (`LIMITS`, `SyncPoint`) only. External: `fflate` (detect, docx, xml), `@xmldom/xmldom` 0.9 (xml, odt, xlsx), `papaparse` (csv), and `mammoth` + `pdfjs-dist`, which are **injected** (`MammothLike`, `PdfJsLike`), so tests and the app pass different builds.
- `core/qda/rank.ts` → `./text` (`foldWithMap`, `originalSpan`) → `./util`. `search.ts` → `./text`. `stopwords/*` has no dependencies.
- `core/speech/transcript.ts` → `../import/transcript` (`cuesToTranscript`) + `../text/normalize` (`fold`).
- `core/service/*` has no dependencies.

---

## 2. `core/i18n`: typed catalogs and `tp` plurals (KEEP)

Files: `core/i18n/catalogs.ts` (7 lines), `languages.ts` (33), `translate.ts` (44), `locales/{en,pt,es}/<namespace>.ts` (21 namespaces each), `catalogs.test.ts`, and `ui/i18n.tsx` (React provider, 75 lines).

**How it works**
1. English is the source of truth. Each namespace is a plain object literal, e.g. `locales/en/questions.ts` → `export const questions = { title: 'Questions', count: { one: '{n} question', other: '{n} questions' }, … }`.
2. `locales/en/index.ts` assembles `export const en = { common, app, … }` and derives the type:
   ```ts
   type DeepStringify<T> = T extends string ? string : { [K in keyof T]: DeepStringify<T[K]> };
   export type Messages = DeepStringify<typeof en>;
   ```
3. Each `pt/<ns>.ts` and `es/<ns>.ts` is typed `export const questions: Messages['questions'] = { … }`, and `pt/index.ts` is `export const pt: Messages = { … }`. **A missing or extra key fails `tsc`.**
4. `translate.ts` builds key types by recursion:
   ```ts
   export type Vars = Record<string, string | number>;
   type NestedKey<T, P extends string = ''> = T extends string ? P
     : { [K in keyof T & string]: NestedKey<T[K], P extends '' ? K : `${P}.${K}`> }[keyof T & string];
   export type MessageKeyOf<T> = NestedKey<T>;
   /** Keys whose value is a { one, other } pair — the only plural shape the catalogs use. */
   type PluralKey<T, P extends string = ''> = T extends { one: string; other: string } ? P
     : T extends string ? never
     : { [K in keyof T & string]: PluralKey<T[K], P extends '' ? K : `${P}.${K}`> }[keyof T & string];
   export type PluralKeyOf<T> = PluralKey<T>;
   export function translate<T>(messages: T, fallback: T, key: MessageKeyOf<T>, vars?: Vars): string;            // falls back to en, then the key
   export function translatePlural<T>(messages: T, fallback: T, key: PluralKeyOf<T>, n: number, bcp47: string, vars?: Vars): string; // Intl.PluralRules(bcp47).select(n)==='one' ? 'one':'other'; injects {n}
   export function interpolate(text: string, vars?: Vars): string; // {name} placeholders; unknown ones stay literal
   ```
5. `languages.ts`: `UI_LOCALES = ['en','pt','es'] as const`, with `UI_LOCALE_META` = `{ en: en-GB, pt: pt-PT, es: es-ES }` (bcp47, nativeName, englishName). `detectUiLocale('pt-BR') → 'pt'`.
6. `ui/i18n.tsx`: `makeI18n(locale) → { locale, meta, t, tp, date(dt, 'short'|'medium'|'long'|'weekday'), time(dt), relative(iso) }`, plus `I18nProvider`, `useI18n()`, `useT()`, and `i18nStatic()` for code outside React. Dates use **luxon** `DateTime.setLocale(bcp47)`.
7. `catalogs.test.ts` has two checks: (a) fewer than 5% of non-English strings may be identical to English (`SAME_OK` regex lists exceptions such as `app.name`), and (b) every `{placeholder}` survives. A `.one` form may drop `{n}`, as in "its document".

**Plural rules check** (Node 22): `pt-PT` 0 → other, 1 → one. `pt-BR` 0 → one, 1.5 → one. `es-ES` and `en-GB` are like pt-PT. The `{one, other}` shape is therefore enough for all three Tramado languages, but **keep `bcp47: 'pt-PT'`**, not `'pt'`.

**For Tramado**
- Copy `translate.ts`, `languages.ts`, `catalogs.ts`, `catalogs.test.ts` and `ui/i18n.tsx` verbatim. Rename `SAME_OK` keys.
- New namespaces (suggestion): `common, app, onboarding, classes, documents, recordings, transcripts, exams, notes, study (flashcards), group (chat/members), sync, ai, settings, help`.
- Strings worth harvesting and rewording (they speak of "research", "researcher" and "encrypted"):
  - `common` (OK/Cancel/Save…, time.* relative-time strings with `daysAgo` plural)
  - `speech` (record/transcribe/bar)
  - `service` (OpenRouter set-up dialog, error codes)
  - `importer.errors` and `importer.warnings` (the sentences for `WARNING` and `ImportError` codes)
  - `questions.draft`
- Proposed glossary addition, consistent with Trama's European variants (formal register, ecrã/ficheiro, ordenador/archivo):

| English | Português (PT) | Español (ES) |
|---|---|---|
| class (course) | cadeira (UI) / unidade curricular (formal) | asignatura |
| class group (people) | turma | grupo (de clase) |
| lecture / class session | aula | clase |
| recording | gravação | grabación |
| transcript | transcrição | transcripción |
| lecture notes | apontamentos | apuntes |
| exam / test | exame / teste | examen / prueba (examen parcial) |
| question / answer | pergunta / resposta | pregunta / respuesta |
| source / citation | fonte / citação | fuente / cita |
| flashcard | cartão de estudo | tarjeta de estudio |
| invite code | código de convite | código de invitación |
| shared | partilhado (never "compartilhado") | compartido |
| file / folder | ficheiro / pasta | archivo / carpeta |
| download | transferir | descargar |
| settings | definições | ajustes |
| API key | chave da API | clave de API |

---

## 3. `core/import`: every parser

Common contract (`types.ts`): `importFile(filename, bytes, opts) → ImportedDoc[] | ImportedTableResult`.
- `ImportedDoc` is `{ name, kind: 'text'|'transcript'|'pdf'|'survey', text, sync: SyncPoint[], speakers: {name, spans}[], source: {filename, format}, original?: {bytes, mime}, warnings: string[] }`.
- Canonical text is LF only, NFC, no BOM, and no control characters except `\t` and `\n`. All offsets are UTF-16, half-open `[start, end)`.
- Paragraphs are `\n`-separated lines.
- Warnings are language-neutral codes, `code:arg`; read them with `parseWarning`.
- Errors are `ImportError(code: 'UNSUPPORTED'|'EMPTY'|'DAMAGED'|'ENCRYPTED_PDF'|'TOO_LARGE', detail)`. For UNSUPPORTED, `detail` names what the file looks like: `doc|xls|ppt|pptx|ods|odp|image|media|binary|zip`.
- Anything unexpected becomes `DAMAGED`, never a raw throw.

| File | Lines | Deps | What it does | Tramado |
|---|---|---|---|---|
| `detect.ts` | 166 | fflate | Picks the format from the bytes, with the extension as a hint. Lists zip entries without inflating them; a PDF header may sit within the first 1 KB; spots OLE `.doc/.xls/.ppt`, media and images; finds UTF-16 without a BOM. `SUPPORTED[]` has extensions, mime and group. `supportedExtensions(group)` builds dialog filters. | **KEEP + ADAPT**: add `pptx` (and maybe `odp`, images for exams). `sniffZip` already sees `ppt/` and returns `{format:null, hint:'pptx'}` (verified). |
| `text.ts` | 163 | bytes, model.LIMITS | `decodeTextWithInfo` (UTF-8, UTF-16 LE/BE, Windows-1252 fallback with counts), `canonicalize`, `tidy`, `tidyPlain`, `baseName`, `extensionOf`, `docName` (capped at 200 chars). | **KEEP** |
| `txt` (in `index.ts`) | — | — | decode → canonicalize → tidyPlain → optional transcript detection | **KEEP** |
| `md.ts` | 150 | — | Markdown → plain text (headings lose `#`, bullets become "•", tables become tab-separated cells, escapes handled). Linear regexes. | **KEEP** (student notes) |
| `docx.ts` | 80 | fflate, mammoth (injected or lazily loaded) | `boundedDocx` re-zips only size-verified parts so mammoth's JSZip cannot be zip-bombed, then mammoth → HTML → `htmlToParagraphs({literal:true})`. Images are counted, not kept. | **KEEP**. **No page numbers exist** (Word has no fixed pages). To cite headings, adapt it to keep the `h1–h6` levels from mammoth's HTML. |
| `odt.ts` | 151 | @xmldom 0.9, xml.ts | `content.xml` → paragraphs, lists, tables, notes. Comments and tracked deletions are skipped. | **KEEP** |
| `rtf.ts` | 427 | bytes | Full RTF tokenizer with code pages and footnotes moved to the end. | **KEEP** (cheap) or DROP (rare for students) |
| `html.ts` | 281 | entities.ts | Tag-soup HTML → paragraphs without a DOM. Also used by docx. | **KEEP** (docx needs it) |
| `pdf.ts` | 232 | pdfjs-dist (injected `PdfJsLike`) | Rebuilds lines from glyph runs (drops fake bold, merges superscripts), then paragraphs from vertical gaps, indents, short last lines, size changes and list starts. Rejoins hyphenation, keeping PT clitics such as `disse-lhe`. **Returns `pageStarts`, `imagePages`, `pages`.** | **KEEP + ADAPT** (see §5) |
| `vtt.ts` | 103 | entities, transcript | WebVTT with voice tags `<v Name>` (Teams), `Name:` prefixes (Zoom), NOTE/STYLE blocks. `parseCueTime`. | **KEEP**: students can import **Teams/Zoom transcripts of online classes** with speakers and times. |
| `srt.ts` | 52 | vtt, transcript | Lenient SubRip. | **KEEP** |
| `transcript.ts` | 454 | model.SyncPoint | `cuesToTranscript(cues, {syncEveryCue=true})` makes one paragraph per speaker turn plus sync points at every cue. Without speakers, cues less than 2 s apart merge up to 1000 chars. Also handles roll-up captions. `parseTextTranscript` reads Otter, Teams-docx, `[00:01:23] Name:` and similar layouts. | **KEEP** |
| `csv.ts` | 144 | papaparse | Detects the delimiter (`;` for PT/ES Excel). | **DROP** for v1 |
| `xlsx.ts` | 309 | @xmldom, xml.ts | Minimal sheet reader. | **DROP** for v1 |
| `survey.ts` | 130 | — | Table → documents per respondent. | **DROP** |
| `xml.ts` | 246 | fflate, @xmldom | **Bounded unzip**: hand-read central directory, 512 MiB per entry, 1 GiB total, inflation in 16 KiB steps. `parseXml` turns errors into DAMAGED. DOM helpers `childElements`, `descendants`, `textContent`. | **KEEP**: the base for new zip formats (pptx, odp). |
| `entities.ts` | 64 | — | HTML entities without a DOM. | **KEEP** |
| `index.ts` | 219 | all | `importFile` with options `pdfjs`, `mammoth`, `password`, `transcript: 'auto'|'always'|'never'`, `speakers`, `syncEveryCue`, `keepOriginal`, `format`. | **ADAPT**: return the PDF page map (see §5). Drop `keepOriginal`, since originals stay on disk as plain files. |

**New: PPTX / slides (prototype verified).** Slides are a stated Tramado need, and Trama only reports `hint:'pptx'`. With Trama's `readZip`, `parseXml` and `descendants`, a reader takes about 30 lines (`lab/trama-ts/pptx.ts`). It reads every `<a:p>` in `ppt/slides/slideN.xml`, joins the `<a:t>` runs, and joins slides with `"\n\n"`, giving `slideStarts`. Output for a 2-slide deck:
`{"text":"Aula 3 — Contratos\nFormação do contrato\n\nProposta e aceitação\nA proposta vincula o proponente (art. 230.º CC)","slideStarts":[0,41],"slides":2}`.
- **Gotcha:** the real slide order is `ppt/presentation.xml` `<p:sldIdLst>` resolved through `ppt/_rels/presentation.xml.rels`. File numbering is only a fallback.
- Speaker notes are in `ppt/notesSlides/notesSlideN.xml` and are worth indexing.
- ODP needs the same treatment (`content.xml` `draw:page`).

**Scanned PDFs and photographed exams.** Trama has no OCR. It only warns (`pdf.noText`, `pdf.imagePages:2,5`). For exams supplied as images or scans, Tramado needs a vision model. `nvidia/nemotron-3.5-super-vl:free` is a VL model; whether it reads images through OpenRouter is **untested here**.

---

## 4. Search code: `rank.ts` BM25, `search.ts`, fold, stop words

### 4.1 `core/qda/rank.ts` (134 lines)

- `rankPassages(docs: readonly {id, text}[], query, opts: RankOptions): RankedPassage[]` where:
  - `RankedPassage = { documentId, start, end, text, score, hits: {start, end}[] }`
  - `RankOptions = { limit? (default 30), stopwords?: ReadonlySet<string>, exclude?: (p: {documentId, start, end}) => boolean }`
- **Units:** each paragraph (a `\n` line). Lines longer than 600 chars are cut into windows at the last `. ? !` past one third of the window, else at a space.
- **Terms:** `foldWithMap(text, {caseSensitive:false, accentSensitive:false})`, word regex `[\p{L}\p{N}]+(?:['’][\p{L}]+)*`, minimum length 3, numbers dropped, stop words dropped. **Stem = first 6 folded letters.**
- **Score:** BM25 with `k1 = 1.2`, `b = 0.75`, `idf = ln(1 + (N − df + 0.5)/(df + 0.5))`. A unit ending in `?` or `¿` is multiplied by 0.5, so exam questions don't answer themselves.
- `hits` are the matched words mapped back to original offsets, ready for `<mark>`.
- The caller (`features/questions/QuestionView.tsx`) builds stop words as `new Set([...stopwordsFor(lang), ...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')])` and excludes passages already linked.
- **Gotcha: the comment in rank.ts over-claims.** It says "movimentos", "movimento" and "movement" meet. `'movimento'` → `movime` and `'movement'` → `moveme`, so they **do not** meet. Matching across languages (PT question, EN slides) does not happen. Fix this with LLM query expansion: ask the model for 8–12 keywords in pt/es/en, then BM25 the union.

### 4.2 Performance (measured)

Synthetic class of 60 docs (`lab/trama-ts/perf.ts`):

| Corpus | `rankPassages` per query |
|---|---|
| 1 M chars | ~55 ms |
| 6 M chars (about a semester: 30 PDFs plus 30 hours of transcripts) | **~240 ms** |

The cost is per query, because it re-folds and re-tokenises everything every time. An exam with 20 questions means about 5 s of CPU on the UI thread.

### 4.3 Adaptation: `PassageIndex` (verified identical ranking)

`lab/trama-ts/subset/src/core/qda/passageIndex.ts` (≈150 lines) is the same code (same `foldWithMap`, same stems, units, BM25 constants and `ASKED`), but:
- units are tokenised **once** into postings (`Map<stem, number[]>` of `[unit, tf]` pairs);
- `add(id, text, unitSpans?)` takes **caller-supplied units carrying a citation `Locator`**;
- `remove(id)` is lazy.

Test `passageIndex.test.ts` on 6 M chars: **build 319 ms; then 6–16 ms per query versus 235–263 ms**, and **exactly the same results** (document, start, end, score to 9 decimals, hits) as `rankPassages`.

```ts
export type Locator =
  | { kind: 'page'; page: number; label?: string }      // PDF physical page (label = printed page, from pdf.js getPageLabels)
  | { kind: 'slide'; slide: number }
  | { kind: 'time'; ms: number }                         // transcript
  | { kind: 'article'; label: string; page?: number }    // "art. 2.º (pp. 1–2)"
  | { kind: 'none' };
export interface UnitSpan { start: number; end: number; locator?: Locator }
export class PassageIndex {
  constructor(stop: ReadonlySet<string>);
  add(id: string, text: string, unitSpans?: UnitSpan[]): void;   // default: Trama's paragraphUnits()
  remove(id: string): void;
  search(query: string, opts?: { limit?: number; exclude?: (doc: string) => boolean }): IndexedPassage[];
}
```

The index is small and rebuilt from the extracted-text cache when a class opens. If needed, persist it later as JSON in the local cache dir, keyed by file SHA-256 (never inside the synced folder). Run build and search in a **Web Worker** (Trama's `vite.config.ts` already has `worker: { format: 'es' }`).

### 4.4 `core/qda/text.ts` (378 lines): KEEP

- `foldWithMap(text, {caseSensitive?, accentSensitive?}) → { folded, map: Int32Array, ends: Int32Array }` and `originalSpan(f, s, e)`. Matches in folded text map back to exact original offsets. NFKD expands ligatures (`ﬁ` → `fi`, common in PDFs), and ß/æ/œ/ø/ł/đ are folded.
- Also: `fold(text, opts)`, `paragraphs`, `lineSpans`, `lineIndex(text)` (O(log n) `lineOf(pos)`), `paragraphAt`, `sentences`/`sentenceAt` (abbreviation-aware for EN/PT/ES: `Sra.`, `pág.`, `n.º`, `p.ex`), `tokenize`, `wordRegex`, `isWordCharAt`.

### 4.5 `core/qda/search.ts` (665 lines): KEEP for the "search my class" box

- `searchTexts(docs, {query, mode:'words'|'phrase'|'regex', wholeWord?, caseSensitive?, accentSensitive?, anyWord?}, {limit?, context?}) → { hits: {documentId, start, end, before, match, after}[], total, truncated, perDocument }`
- Boolean query language: `a b` (same paragraph), `OR`, `AND`, `NOT`/`-x`, `"phrase"`, `garden*` wildcards, parentheses.
- `parseQuery`, `validateQuery → SearchError(code: 'empty'|'invalid-regex'|'syntax'|'negative-only', detail, position)`.
- `contextAround(text, s, e, width)` and `kwic(hits, width) → KwicRow{left, keyword, right}`.
- Covered by Trama's perf test (more than 5 M chars).

### 4.6 Stop words and fold

- `core/qda/stopwords/{en,pt,es,fr,de,it,nl}.ts` plus `index.ts`, where `stopwordsFor('pt-PT')` returns a cached `ReadonlySet`. PT is the European list (forms of ser, estar, ter, haver, ir; contractions; transcript fillers). **KEEP.**
- `core/text/normalize.ts` `fold(s)` (NFD, strip marks, lower-case, collapse spaces) is used for equality tests (`dropEcho`, question matching). **KEEP.** Don't confuse it with `qda/text.ts` `fold`.
- `core/qda/wordfreq.ts` (`wordFrequencies`, `wordKwic`, `markupSpans` that mask `Speaker:` labels and `[laughs]`) imports `model/types` (`Coding`) and `stats.ts`. **DROP** for v1.

---

## 5. Answers to the four questions

### (a) Can `rank.ts` BM25 drive exam answering with citations?

**Yes.** Use it as the retriever stage, in its indexed form (§4.3). Proposed granularity, all demonstrated in the lab:

| Source | Unit | Locator → citation label | How |
|---|---|---|---|
| PDF (general) | paragraph, ≤600-char windows | `p. N` | `pageOf(pageStarts, unit.start)`. A paragraph never crosses a page, because pages are joined with `"\n\n"`. |
| PDF / DOCX law texts | **article** (heading to next heading), windowed if longer than ~1,500 chars with the same label | `art. 2.º (pp. 1–2)` | regex at paragraph start, used when at least 2 headings are found (`lab/.../subset/articles.ts`) |
| Slides | paragraph within slide | `slide N` | `slideStarts` (pptx prototype) |
| Transcript | pause-delimited paragraph (cues < 2 s apart, ≤1000 chars), windowed to 600 | `mm:ss`, using the **first hit's time**, not the unit's | `msAt(sync, hits[0].start)` |
| DOCX / MD / ODT notes | paragraph | heading path or paragraph number | keep heading levels (adapt docx) |

Lab results (`lab/trama-ts/cite.ts`, a fictional 4-page "Regulamento Académico" PDF plus a transcript), query *"Um estudante reprovou na época normal. Pode ir a recurso e quanto paga?"*:

```
paragraph units:
7.024 reg  p. 1, Art. 2.º | Artigo 2.º Época de recurso O estudante reprovado na época normal pode inscrever-se …
4.230 aula @ 0.0 s        | Bom dia a todos, … Quem chumbar na época normal pode ir à época de recurso, mas tem de pagar uma taxa.
2.140 reg  p. 2, Art. 2.º | A inscrição na época de recurso está sujeita ao pagamento de uma taxa …
article units (articles.ts):
6.85 {"kind":"article","label":"art. 2.º (pp. 1–2)","page":1} | Artigo 2.º Época de recurso … (whole article, incl. the fee sentence on p. 2)
```

Lessons from the run:
- **Transcript timestamp:** the paragraph starts at 0.0 s (the greeting), but the matching sentence starts at 4.2 s. `cuesToTranscript` keeps a sync point at every cue, so cite `msAt(sync, passage.hits[0].start)`.
- **Article units fix page splits.** With paragraph units, art. 2.º's fee sentence on page 2 is a separate, weaker passage. As one article unit, it is a single citation spanning pages 1–2.
- **The PDF paragraph builder merged the "Artigo 2.º Época de recurso" heading with its body.** The 12 pt vs 11 pt difference is below the `max(1, body×0.15)` threshold. Article detection must therefore match `^Artigo N.º` at a paragraph start and **not** assume the heading is its own line.
- Exclude the exam's own file from retrieval (`exclude: doc => doc === examId`). The 0.5× weight for question-shaped units already helps when past exams are in the class.
- Recommended pipeline per exam question:
  1. optional LLM keyword expansion (cross-language);
  2. `index.search(q, {limit: 30})`;
  3. top 8–12 through `passagesThatFit` (cap 2,500 chars each, 24,000 total);
  4. answer prompt with numbered, located sources;
  5. parse `[n]`;
  6. render clickable chips that open the PDF at a page, seek the audio, and so on.

Helpers worth copying:

```ts
import { upperBound } from './util';                       // first index with sorted[i] > x
export const pageOf = (pageStarts: readonly number[], pos: number) => Math.max(1, upperBound(pageStarts, pos));
export function msAt(sync: readonly { pos: number; ms: number }[], pos: number): number {
  let lo = 0, hi = sync.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (sync[mid]!.pos <= pos) lo = mid + 1; else hi = mid; }
  return lo ? sync[lo - 1]!.ms : 0;
}
const ARTICLE = /^(?:Artigo|Art\.?|Artículo|Article)\s+(\d+(?:\.º|º|°)?(?:-[A-Z])?)(?:\.º|º)?/gmu;
/** Citation markers in a model's answer: [1], [2, 3], [1–3]; ignores numbers > n (hallucinated). */
export function citations(answer: string, n: number): number[] {
  const out = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g))
    for (const part of m[1]!.split(/\s*[,;]\s*/)) {
      const [a, b = a] = part.split(/\s*[–-]\s*/).map(Number) as [number, number?];
      for (let k = a; k <= (b ?? a) && k - a < 20; k++) if (k >= 1 && k <= n) out.add(k);
    }
  return [...out].sort((x, y) => x - y);
}
```

### (b) Does the PDF import keep page numbers? What is needed to cite "page N"?

- `extractPdfText()` **does** compute `pageStarts: number[]` (the text offset where each page starts; an empty page gets the end of the text before it), `pages` and `imagePages`. Verified: `pageStarts [0, 338, 604, 752]` for the 4-page test PDF.
- **`importFile()` throws them away.** `ImportedDoc` has no page field, and nothing in Trama uses `pageStarts` (grep: only `pdf.ts` and its test). Trama also has **no PDF viewer**. It keeps the original blob only, and `disableFontFace: true` is fine for text extraction but not for rendering.

What Tramado needs:
1. Add `pages?: { starts: number[]; labels?: string[]; imagePages: number[] }` to `ImportedDoc`, filled in the `case 'pdf'` branch. Alternatively, call `extractPdfText` directly. Use the same shape for pptx (`slides`).
2. Printed page labels: extend `PdfJsLike` with `getPageLabels(): Promise<string[] | null>` on the document proxy. Cite `p. ${labels?.[n-1] ?? n}`, and open the viewer by the **physical** page n.
3. Cache per file, outside the synced folder: `{ sha256, format, text, pageStarts, pageLabels, imagePages, warnings }` in the app cache dir (`~/.cache/tramado/<classId>/text/<sha256>.json`). Every device extracts its own copy; this is deterministic and needs no sync.
4. Strip running headers and footers. Law gazettes (e.g. "Diário da República, 1.ª série — N.º …") repeat lines on every page, which pollutes BM25. Drop a first or last line of a page that appears on at least 50% of pages, a nice small addition to `pdf.ts`.
5. Viewer: pdfjs-dist's `pdf_viewer.mjs` (`PDFViewer`, `EventBus`, `PDFFindController`). Jump with `pdfViewer.currentPageNumber = n` and highlight by searching for the passage's first ~8 words. That is cheaper than keeping a glyph-to-offset map. Rendering needs `cMapUrl` and `standardFontDataUrl` bundled, and the worker as in Trama: `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; m.GlobalWorkerOptions.workerSrc = workerUrl;`. Use CSP `worker-src 'self' blob:`.
6. Scanned pages (`imagePages`): show the warning, and offer OCR through a vision model later.

### (c) Can the OpenRouter "Draft an answer" prompt with numbered sources be reused?

**Yes: keep `core/service/prompt.ts` and adapt the wording and limits.** API:

```ts
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface DraftPassage { document: string; text: string }        // put the locator into `document`: "Regulamento, p. 2, art. 2.º" / "Aula 3, 12:04"
export const DRAFT_MAX_TOKENS = 900;                                      // → raise (see below)
export function passagesThatFit(p: readonly DraftPassage[]): DraftPassage[];   // ≤2,500 chars each, ≤24,000 total, whitespace collapsed
export function draftMessages(question: string, p: readonly DraftPassage[]): ChatMessage[];  // system INSTRUCTIONS + "Question:\n…\n\nPassages:\n[1] (doc) text\n\n[2] …"
export function draftBlock(draft: string, p: readonly DraftPassage[], labels: { heading; check; sources }): string; // Markdown block with numbered source list
export function appendBlock(body: string, block: string): string;
```

Trama's system instructions say: help a student answer an exam question from their own material; answer **only** from the numbered passages; cite as [1], [2]; say plainly when the passages don't answer; write in the question's language; at most four short paragraphs.

**Live test** (`lab/trama-ts/draft-live.ts`): the unchanged `draftMessages` was sent with `models: ["google/gemma-4-31b-it:free","google/gemma-4-26b-a4b-it:free","nvidia/nemotron-3.5-super-vl:free"]`.
- **HTTP 200 in 5.3 s.** It fell back to `nvidia/nemotron-3.5-super-vl:free` because both Gemma models were rate-limited, as already known. Answer, in correct PT-PT:

  > Sim. O estudante reprovado na época normal pode inscrever-se na época de recurso, mediante requerimento apresentado nos serviços académicos [1]. Quem chumbou na época normal pode ir à época de recurso, mas tem de pagar uma taxa [2]. A inscrição na época de recurso está sujeita ao pagamento de uma taxa fixada anualmente pelo conselho de gestão [3]. Os textos disponíveis não indicam o valor concreto dessa taxa…

  Citations were correct, and the model was honest about the missing amount.
- usage: `prompt 338, completion 585, of which reasoning_tokens 471`. **With `DRAFT_MAX_TOKENS = 900`, a longer answer would be cut off or come back empty.** Use 3,000–4,000 for free reasoning models. A one-sentence streamed answer still used 250 reasoning tokens.
- **The same request with Trama's routing `provider: { zdr: true, data_collection: 'deny' }` gives HTTP 404 in 67 ms:** `"No endpoints found matching your data policy (Zero data retention)"`, `failed_routing_step: "Filter by Data Policy"`. **Trama's Rust `routing()` must not be copied as-is. Make ZDR an opt-in setting, off by default, because free models don't qualify.** Trama's Rust maps 404 to `NO_MODEL`; Tramado should explain this case as "your privacy setting excludes this model".

Adaptations for Tramado:
- New instruction variants:
  - **exam answer:** multiple choice and true/false start with `Answer: B` on its own line, then the justification. Uncited sentences are allowed only in a final paragraph marked as not from the class material; the UI flags uncited paragraphs.
  - **question extraction:** JSON list of `{n, text, kind: 'open'|'mcq'|'tf', options?}`. Parse leniently, since free models may ignore `response_format`.
  - summary, flashcards, transcript annotation, query expansion.
- Put the locator in `DraftPassage.document`, e.g. `(Regulamento Académico, p. 1, art. 2.º)` / `(Aula 1, 00:04)`, so the model can also name sources in prose.
- `draftBlock` produces Markdown with `1. doc: “…”`. Tramado should instead store structured `{ answer, citations: [{n, docPath, start, end, locator}] }` in the exam file and render chips. Keep `draftBlock` for "copy as Markdown".
- **Gemma and the system role: not verified** (Gemma models were 429 throughout). If a provider rejects `role: 'system'`, fold the instructions into the first user message.

**Transport:** Trama does chat in Rust (`ureq`, `POST {base}/chat/completions`, reads `/choices/0/message/content` and `model`). Tramado can do it **in TypeScript**:
- **OpenRouter answers CORS preflight with `access-control-allow-origin: *`** (verified for `Origin: http://localhost:1420` and `tauri://localhost`). `Authorization`, `HTTP-Referer` and `X-Title` are allowed, and `X-Generation-Id` is exposed.
- The browser demo can therefore use a real key with plain `fetch`.
- Desktop options: `@tauri-apps/plugin-http` `fetch`, which avoids CSP and CORS and has a host scope, or CSP `connect-src https://openrouter.ai`.
- **Streaming verified.** SSE chunks are `data: {...}` with `choices[0].delta.content` and a **separate `delta.reasoning`** (plus `reasoning_details`); the stream ends with `data: [DONE]`, and `usage` arrives in the last chunk.
- Skip `:` comment lines (OpenRouter sends `: OPENROUTER PROCESSING` keep-alives).
- Port Rust's `answer()` status→code map: 401/403 UNAUTHORIZED, 402 NO_CREDIT, 404 NO_MODEL (including the data-policy case), 408/504 TIMEOUT, 413 TOO_LARGE, 429 RATE_LIMITED, 400/422 REFUSED, other SERVICE_ERROR, network failure UNREACHABLE.
- `service_check` uses `GET {base}/key` → `data.limit_remaining` (credit).

```ts
// services/ai/openrouter.ts (sketch; same code for desktop, demo and tests via an injected fetch)
export async function chatStream(fetchImpl: typeof fetch, req: ChatRequest, onDelta: (d: { content?: string; reasoning?: string }) => void): Promise<ChatAnswer> {
  const res = await fetchImpl(`${req.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${req.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/<org>/tramado', 'X-Title': 'Tramado' },
    body: JSON.stringify({ ...(req.models.length > 1 ? { models: req.models.slice(0, 3) } : { model: req.models[0] }), messages: req.messages,
      max_tokens: req.max_tokens ?? 4000, stream: true, ...(req.zdr ? { provider: { zdr: true, data_collection: 'deny' } } : {}) }),
    signal: req.signal,
  });
  if (!res.ok || !res.body) throw await aiError(res);           // status → code map above
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', text = '', reasoning = '', model = req.models[0]!, finish: string | null = null;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += value;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;                   // ": OPENROUTER PROCESSING"
      const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      const j = JSON.parse(data);
      if (j.error) throw new AiError(codeOf(j.error.code), j.error.message);   // mid-stream errors
      model = j.model ?? model;
      const d = j.choices?.[0]?.delta ?? {};
      if (d.content) { text += d.content; onDelta({ content: d.content }); }
      if (d.reasoning) { reasoning += d.reasoning; onDelta({ reasoning: d.reasoning }); }
      finish = j.choices?.[0]?.finish_reason ?? finish;
    }
  }
  if (!text.trim()) throw new AiError('EMPTY', finish === 'length' ? 'max_tokens spent on reasoning' : 'no content');
  return { text, reasoning, model, finish };
}
```

Remote **transcription** stays in Rust and can be reused from `speech/remote.rs`: decode, VAD, pieces of at most 30 s, base64 WAV, `POST {base}/audio/transcriptions` with `{"model","input_audio":{"data","format":"wav"},"response_format":"verbose_json","timestamp_granularities":["segment"],"language"}`, four at a time. Default model `openai/whisper-large-v3`. Here too, drop the forced ZDR `provider`.

### (d) Platform interface for Tramado

See §8 for the full proposal, and §8.2 for how memory and fake platforms give a browser demo and Vitest coverage.

---

## 6. `core/service/config.ts` and `core/speech/*`

**`config.ts` (105 lines): ADAPT**
- Keep `ServiceConfig {provider: 'openrouter'|'custom', base, key, models}`, `OPENROUTER_BASE = 'https://openrouter.ai/api/v1'`, `serviceHost`, `serviceName`, `serviceProblem`, `maskedKey` (`…abcd`) and `LOCAL_HOST` (plain http only to localhost or LAN).
- Change:
  ```ts
  export interface AiModels { chat: string[] /* 1–3: primary + OpenRouter 'models' fallbacks */; transcribe: string }
  export const DEFAULT_MODELS: AiModels = {
    chat: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free'],
    transcribe: 'openai/whisper-large-v3',
  };
  ```
- `parseServiceConfig` must read the old single `chat` string as `[chat]`.
- `serviceProblem` should not require a transcribe model when local whisper is used.
- **The key never goes in prefs or in a class folder.** It goes through `platform.secrets` (§8).

**`core/speech`: KEEP all**
- `types.ts`: `SpeechSegment {start, end, text}`, `SpeechTrack {segments, language}`, `Transcription {tracks, duration, engine}`. **Use this as the on-disk transcript JSON** (`transcripts/<recordingId>.json`), plus `speakers`, `createdBy` and `model`. Lay it out at load time with `transcriptFromSpeech(t, speakers) → {text, sync, speakers}`. Keep the raw segments as the source of truth; text and sync are derived.
- `transcript.ts`:
  - `dropEcho(mic, system)` drops a mic segment when ≥60% of its words are heard on the system track within ±1.5 s. Needed for online classes without headphones.
  - `transcriptFromSpeech(t, speakers)` interleaves two tracks into turns.
  - `spokenLanguage(t)`.
- `timing.ts`: `timeLeft(mark, percent, now)`, `measuredSpeed`, `blendSpeed`, `clock(ms) → "1:40:05"`, `roundedDuration`. Useful for "about 20 minutes left" and for estimating before a member claims a transcription.
- `wav.ts`: `wavHeader(dataBytes, rate, channels)`. Only needed if the TS side writes WAV; see recording below.

---

## 7. `services/*`

| File | Verdict | Notes |
|---|---|---|
| `service.ts` (61) | **DROP** | Per-project "enabled" flag in store meta, plus `ServiceUnavailable('NOT_SET_UP'|'NOT_ENABLED')`. Tramado: AI is configured or not. Keep the `NOT_SET_UP` error idea. |
| `transcription.ts` (226) | **ADAPT** | Keep `TranscribeRequest {language, channels: 'mix'|'split', speakers, engine: 'local'|'service'}`, `TranscriptionError(code)` with codes `UNAVAILABLE, UNSUPPORTED_AUDIO, NO_SPEECH, NO_RECORDING, HAS_TEXT, MODEL_UNREADABLE, BUSY, HOST_NOT_ALLOWED, BAD_ADDRESS, ERROR`, `settle()` (wait for a busy engine), and the loop `start → sleep(poll) → status → (done|failed|cancelled|idle) → take → transcriptFromSpeech → NO_SPEECH check`. Replace the queue in `store.getMeta('speech.queue')` with a **file-based claim** in the class folder (below), and pass a **file path** instead of decrypted bytes. |
| `recording.ts` (235) | **ADAPT heavily** | Drop `RecordingWriter` sealing (`sealedHeader`, `sealBlobFrame`, 256 KiB encrypted frames). The useful ideas are crash recovery (marker plus fixing the WAV length) and `recordingFilename(startedAt)`. With plain files, Rust can write the WAV itself; see §8. |
| `questions.ts` (191) | **ADAPT** | Keep `questionName(text)` (first 8 words, ≤80 chars, "…") and the `draftAnswer` sequence. Drop codes, codings, memos and undo. Practice marks (`'known'|'again'`) become a per-user study file. |
| `jobs.ts` (18) | **KEEP** | `JobStopped`, `stopper(shouldStop)`. Rename the message (no "locking" in Tramado; use it for "class closed / app quitting"). |
| `prefs.ts` (79) | **KEEP/ADAPT** | `readPrefs(platform, systemLocale)`, `writePrefs(platform, patch)`, `hasChosenLocale`. A damaged prefs file falls back to defaults. Drop `autoLockMinutes`. Keep `locale`, `theme`, `speechSpeed`, `lastProjectId → lastClassId`. Add `ai.models`, `ai.base`, `ai.zdr`, `speech.engine`. |
| `context.ts`, `project.ts`, `library.ts`, `documents.ts`, `codes.ts`, `codings.ts`, `memos.ts`, `cases.ts`, `groups.ts`, `pseudonyms.ts`, `undo.ts`, `backup.ts`, `datafile.ts`, `reconcile.ts`, `log.ts`, … | **DROP** | SQL Store, encryption and QDA domain. `undo.ts`'s `ServiceError(code, message)` is a 10-line idea worth recreating. |

**Recording and transcription in a Syncthing world.** These details decide how `recording.ts` and `transcription.ts` get adapted.
- **Never record into the synced folder.** Syncthing would rescan and re-send a file that grows every 400 ms, and classmates could start transcribing a partial file. Record to `app_data/recordings/<id>.wav.part` (or a `.stignore`d name). On stop, fix the header and **move** it into `<class>/recordings/`. On start-up, recover an orphan `.part` (Trama's `recoverRecording` logic without the crypto).
- Size: Trama records 16 kHz, 16-bit stereo, which is **64 kB/s ≈ 230 MB per hour**, too heavy to sync to every member. Encode to Opus or FLAC in Rust after the stop. Check that the decoder (Symphonia 0.6) can read whatever format is chosen; Opus support in Symphonia is not verified.
- Lecture-room recording uses `channels: 'mix'` and a single track (no speaker labels; paragraphs follow pauses). Online classes use `'split'`: mic left, loopback right, with `dropEcho`.
- **One transcriber per class: file-based claims, one writer per file**, to avoid Syncthing conflict copies (`*.sync-conflict-YYYYMMDD-HHMMSS-<DEVICE>.ext`):
  - Each device writes only its own `<class>/.tramado/claims/<recordingId>/<deviceId>.json` (`{ at, heartbeatAt, engine, etaMs }`).
  - The winner is the earliest `at` among claims whose heartbeat is younger than about 10 minutes, ties broken by smallest `deviceId`.
  - Only the winner transcribes, then writes `transcripts/<recordingId>.json`. Others wait or take over when the heartbeat goes stale.
  - The same per-device-file rule fits chat (`chat/<deviceId>.jsonl`, append-only).
  - The exact design belongs to the Syncthing research. The point here is that Trama's queue code (`enqueue`, `dequeue`, `transcribable`) maps onto "unclaimed recording without transcript".

---

## 8. Platform layer

### 8.1 What to keep from Trama's `platform/tauri.ts`

Worth copying verbatim:
- `call<T>(cmd, args?, headers?)`, which wraps `invoke` and turns rejections into `PlatformError(code, message)`. The shell rejects with `{code, message}`, Tauri itself with a string.
- `toPlatformError(e)` and `toBytes(r: ArrayBuffer | Uint8Array | number[])`.
- `body(bytes)` sends a raw body only when the view covers its whole buffer.
- **Binary writes as a raw IPC body plus percent-encoded headers** (`x-path`, `x-offset`, `x-truncate`), avoiding JSON-encoding megabytes. `const h = (v: string) => encodeURIComponent(v)`.
- `joinPath(dir, name)`, aware of Windows separators.
- `parsePrefs(raw)`, robust, string map only, with a serialised prefs write queue.
- `queuedAnswer()`: e2e tests queue dialog answers in `window.__TRAMA_E2E_DIALOGS__` (rename to `__TRAMADO_…`).
- `onBeforeExit`: `onCloseRequested` → `preventDefault` → run all handlers → `win.destroy()`.
- `isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window`.

From `tauri.conf.json`:
- CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: asset:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost blob: data:; media-src 'self' blob:`
- **`"dangerousDisableAssetCspModification": ["style-src"]`**: without it WebKit drops every inline style in the desktop app, while the browser demo still looks fine.
- Tramado adds `https://openrouter.ai` to `connect-src` (or uses plugin-http), and `asset:` / `http://asset.localhost` to `media-src` for streaming audio from disk.

### 8.2 Proposed `platform/types.ts` for Tramado

```ts
import type { Transcription } from '../core/speech/types';
export type { SpeechSegment, SpeechTrack, Transcription } from '../core/speech/types';

export class PlatformError extends Error { constructor(readonly code: string, message: string) { super(message); } }

export interface FileEntry { path: string; name: string; is_dir: boolean; size: number; modified_ms: number; depth: number }
export interface FileFilter { name: string; extensions: string[] }
export interface AppInfo {
  version: string;
  os: 'linux' | 'macos' | 'windows' | 'android' | 'ios' | 'web';
  /** App data (prefs.json, secrets fallback, in-progress recordings, speech model). Never synced. */
  data_dir: string;
  /** Rebuildable caches: extracted text, search index. Never synced. */
  cache_dir: string;
  /** Default parent for new class folders (e.g. ~/Tramado). */
  classes_dir: string;
}

export type SecretName = 'openrouter.key' | 'custom.key' | 'syncthing.apikey';

/** What on-device speech can do here. */
export interface SpeechInfo {
  transcribe: boolean;
  /** NO_MODEL = not downloaded yet (Tramado downloads on demand); UNSUPPORTED_CPU (no AVX2/FMA/F16C on x86-64). */
  reason: 'NO_MODEL' | 'UNSUPPORTED_CPU' | null;
  engine: string;
}
export interface ModelStatus {
  state: 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed';
  /** Bytes so far / total (ggml-large-v3-turbo-q5_0.bin 574,041,195 + ggml-silero-v5.1.2.bin 885,098). */
  received: number; total: number;
  error: { code: string; message: string } | null;
}
export interface TranscribeOptions {
  language: string | null;            // ISO 639-1 or null (auto)
  channels: 'mix' | 'split';
  /** Remote engine (OpenRouter audio model) instead of local whisper.cpp. */
  service?: { base: string; key: string; model: string; zdr: boolean };
}
export interface TranscribeStatus { state: 'idle' | 'decoding' | 'transcribing' | 'done' | 'failed' | 'cancelled'; percent: number; error: { code: string; message: string } | null }
export interface RecorderTrackStatus { open: boolean; level: number; device: string | null; error: string | null }
export interface RecorderStatus { recording: boolean; ms: number; mic: RecorderTrackStatus; system: RecorderTrackStatus }

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatRequest {
  base: string; key: string;
  /** 1–3 models; more than one → OpenRouter `models` fallback array. */
  models: string[];
  messages: ChatMessage[];
  max_tokens?: number; temperature?: number;
  /** Ask OpenRouter for Zero-Data-Retention providers only (fails with NO_MODEL for :free models). */
  zdr?: boolean;
  signal?: AbortSignal;
}
export interface ChatAnswer { text: string; reasoning: string; model: string; finish: string | null; usage?: { prompt: number; completion: number; reasoning: number; cost: number } }

/** Syncthing, through its REST API (the exact calls come from the Syncthing research). */
export interface SyncStatus { running: boolean; version: string | null; deviceId: string | null; error: string | null }
export interface SyncFolderState { folderId: string; state: 'idle' | 'scanning' | 'syncing' | 'error' | 'unknown'; completion: number; needBytes: number; peers: { deviceId: string; name: string; connected: boolean; completion: number }[] }
export type SyncEvent =
  | { id: number; type: 'folderChanged'; folderId: string; paths: string[] }
  | { id: number; type: 'deviceConnected' | 'deviceDisconnected'; deviceId: string }
  | { id: number; type: 'pendingDevice'; deviceId: string; name: string }
  | { id: number; type: 'pendingFolder'; deviceId: string; folderId: string; label: string };

export interface Platform {
  kind: 'desktop' | 'demo';
  info(): Promise<AppInfo>;

  /** Device preferences (language, theme, models). Never secrets, never class content. */
  prefs: { get(): Promise<Record<string, string>>; set(values: Record<string, string>): Promise<void> };

  /** Secrets, kept outside every class folder: OS keychain, or a 0600 file in data_dir. Demo: memory only. */
  secrets: { get(name: SecretName): Promise<string | null>; set(name: SecretName, value: string): Promise<void>; remove(name: SecretName): Promise<void> };

  /** Plain files. The shell confines paths to classes_dir, registered class folders, data/cache dirs and picked files. */
  fs: {
    read(path: string): Promise<Uint8Array>;
    readText(path: string): Promise<string>;
    /** Atomic (temp file + rename), creating parent folders: Syncthing never sees a half-written file. */
    write(path: string, bytes: Uint8Array): Promise<void>;
    writeText(path: string, text: string): Promise<void>;
    /** Appends (creating the file); returns its new length. For per-device append-only logs (chat). */
    append(path: string, bytes: Uint8Array): Promise<number>;
    readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
    stat(path: string): Promise<FileEntry | null>;
    list(path: string, recursive: boolean): Promise<FileEntry[]>;
    mkdir(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    /** Copies a picked file into a class without its bytes crossing IPC. */
    copy(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    join(dir: string, ...names: string[]): string;
    /** SHA-256 hex, computed by the shell (cache keys for extraction/index; avoids reading big files into JS). */
    hash(path: string): Promise<string>;
    /** File changes under a folder (Syncthing writes, other apps). Returns an unsubscribe function. */
    watch(path: string, onChange: (paths: string[]) => void): Promise<() => void>;
    /** A URL the webview can stream (audio, PDF) from: convertFileSrc on desktop, a blob: URL in the demo. */
    mediaUrl(path: string): string;
    /** Opens with the system app / shows in the file manager (plugin-opener). */
    openExternal(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
  };

  dialogs: {
    pickFolder(title: string): Promise<string | null>;
    pickFiles(title: string, filters: FileFilter[], multiple: boolean): Promise<string[]>;
    saveFile(title: string, defaultName: string, filters: FileFilter[]): Promise<string | null>;
  };

  /** HTTP for AI (desktop: plugin-http fetch scoped to openrouter.ai + user-added hosts; demo: window.fetch). */
  net: { fetch: typeof fetch };

  /** Desktop only; absent in the demo unless ?speech=fake. */
  speech?: {
    info(): Promise<SpeechInfo>;
    model: {
      status(): Promise<ModelStatus>;
      /** Starts the one-time download (HTTPS from Hugging Face, SHA-256 checked); poll status(). */
      download(): Promise<void>;
      cancel(): Promise<void>;
      remove(): Promise<void>;
    };
    transcribe: {
      /** Starts transcribing a file on disk (no bytes over IPC). One at a time. */
      start(path: string, opts: TranscribeOptions): Promise<void>;
      status(): Promise<TranscribeStatus>;
      take(): Promise<Transcription | null>;
      cancel(): Promise<void>;
    };
    recorder: {
      /** Records to `path` (outside class folders), mic and optionally the computer's sound. */
      start(opts: { path: string; system: boolean }): Promise<RecorderStatus>;
      status(): Promise<RecorderStatus | null>;
      /** Stops and finalises the file (header, encode); returns its final path and length. */
      stop(): Promise<{ path: string; ms: number }>;
    };
  };

  /** Syncthing (sidecar or system install), wrapped so tests can fake a mesh of devices. */
  sync?: {
    status(): Promise<SyncStatus>;
    start(): Promise<void>;
    shareFolder(input: { folderId: string; label: string; path: string; devices: string[] }): Promise<void>;
    addDevice(input: { deviceId: string; name: string; introducer?: boolean; autoAcceptFolders?: boolean }): Promise<void>;
    acceptFolder(input: { folderId: string; label: string; path: string; from: string }): Promise<void>;
    removeFolder(folderId: string): Promise<void>;
    folderState(folderId: string): Promise<SyncFolderState>;
    /** Long-poll: events after `since` (Syncthing /rest/events semantics). */
    events(since: number, timeoutS?: number): Promise<SyncEvent[]>;
  };

  setTitle(title: string): Promise<void>;
  onBeforeExit(handler: () => Promise<void>): () => void;
}
```

Design notes:
- **Paths, not bytes.** Trama passed decrypted bytes (`transcribe.start(bytes)`, `recorder.take()` every 400 ms) because files were encrypted blobs. With plain files, Rust reads and writes them directly. That is less IPC, and a 230 MB recording never crosses into JS.
- **AI lives in TS** (`services/ai/*` on top of `platform.net.fetch`), so the demo, the desktop app and Vitest share one OpenRouter implementation. Remote *audio* transcription stays in Rust (decoding and VAD are there).
- **Secrets are separate from prefs** (the user requirement). Trama sealed the key in `library.json`, which Tramado doesn't have.
- `fs.watch` plus `sync.events` drive refresh when classmates' files arrive. Trama had nothing like this (`useLive` subscribed to Store changes).

### 8.3 Memory and fake platforms → browser demo and Vitest

Trama's pattern, which carries over unchanged:
- `createMemoryPlatform(opts) → MemoryPlatform` keeps everything in Maps.
  - Options: `files?: Map<path, bytes>`, `dialogAnswers?` (a queue), `defaultFolder?`, and injectable `speech?` and `service?` fakes.
  - Test helpers: `fileStore`, `queueAnswer(a)`, `addDir(path)`.
  - Its `files.list` builds directory entries from path prefixes. `exists` covers implicit folders. `write` records `mtimes`.
- `createFakeSpeech() → FakeSpeech`:
  - `answer: Transcription | (bytes, opts) => Transcription`, `failNext: string | null`, `last`, `steps` (status polls before done), `takeMs`, `noDevices`.
  - `fakePcm(ms)` gives a 300 Hz tone on the left channel.
- `createFakeService() → FakeService`: `answer: string | (req) => string`, `failNext`, `chats: ChatRequest[]` (a log of what was sent), `allowAnswer`, `asked`, `allowed`.
- The demo is `main.tsx` → `bootDemo()`, with `?speech=fake`, `?service=fake`, `?lang=`, `?clock=` (freezes `Date`, luxon `Settings.now`, seeds `crypto.getRandomValues` and `Math.random` for identical screenshots), and `?route=`.
- Tests of `tauri.ts` use `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(...) }))` plus mocks for `@tauri-apps/api/window` and `@tauri-apps/plugin-dialog`, then `await import('./tauri')`. They assert the exact command, arguments and headers sent to the shell.

Tramado additions:
1. **`createMemoryMesh()`**, a fake Syncthing that lets Vitest test multi-member behaviour deterministically:
   - `const mesh = createMemoryMesh(); const ana = mesh.device('ANA'), rui = mesh.device('RUI');` each device is a `MemoryPlatform` with `sync` implemented.
   - `ana.sync.shareFolder({...devices:['RUI']})` creates a `pendingFolder` event on `rui`, and `rui.sync.acceptFolder(...)` maps the folder into rui's file store.
   - `mesh.flush()` copies changed files between devices. When both sides changed the same file, it creates `name.sync-conflict-YYYYMMDD-HHMMSS-<DEV>.ext` like Syncthing, emits `folderChanged`, and fires `fs.watch` callbacks.
   - `mesh.partition('RUI')` and `mesh.heal()` simulate offline members.
   - This tests the transcription claim protocol (two devices claim, one wins, a stale heartbeat hands over), chat merge order and invite join without a real Syncthing.
2. **`createFakeAi()`** in the same shape as FakeService (`answer`, `failNext`, `chats`), implemented as a fake `fetch` that returns either JSON or an SSE stream from the scripted answer. This exercises the real `openrouter.ts` parsing in tests.
3. **Demo with a real AI:** OpenRouter allows CORS `*`, so the demo can accept a key pasted by the visitor. Keep it in memory only (or `sessionStorage`) and never in `localStorage`.
4. Demo example class: a fictional "Direito Constitucional I" class with a regulation PDF, slides, a transcript (`Transcription` JSON plus a pre-generated WAV, or no audio) and a past exam. Make it fictional, as Trama's AGENTS.md demands for fixtures.
5. Fake speech model download: `model.status()` steps from `missing` through `downloading` 0→100 to `ready`, for screenshots of the first-transcription flow.

---

## 9. Lab evidence: copy-ready subset

Location: `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/trama-ts/subset/`
- `src/core/{import, qda/{rank,text,util,search,stopwords/*}, text, speech, service, i18n/{translate,languages}, bytes.ts}` are copied from Trama unchanged.
- `src/core/model/types.ts` is a **shim**:
  ```ts
  export interface SyncPoint { pos: number; ms: number }
  export const LIMITS = { nameMax: 200, textMax: 20_000_000 } as const;
  ```
- `tsc` with Trama's strict options (plus a path mapping for xmldom 0.9) passes with **no errors**.
- `vitest run`: **20 files, 266 tests passed**, using Trama's fixtures copied to `subset/test-fixtures/import/`. It also needs `src/core/export/forgeZip.testutil.ts` (the zip-bomb test helper used by `docx.test.ts`).
- Added for Tramado: `src/core/qda/passageIndex.ts` + `passageIndex.test.ts` (identical to rankPassages, 15–40× faster per query) and `articles.ts` (article units with page spans).
- Other scripts in `lab/trama-ts/`:
  - `cite.ts`: PDF page, article and transcript time citations, and the `draftMessages` output.
  - `perf.ts`: rankPassages timing.
  - `pptx.ts`: slides reader on Trama's xml helpers.
  - `draft-live.ts`: live OpenRouter run of Trama's prompt, with and without ZDR.
  - `make-law-pdf.mjs`: fictional 4-page law PDF, using Trama's hand-written PDF technique from `app/test-fixtures/import/make-fixtures.mjs`.
  - `out/regulamento.pdf`, `out/stream.txt`: an SSE sample.

Copy commands for the new repo (when design starts; these only read from Trama):
```bash
T=/home/feiteira/Trama/app/src/core; D=<tramado>/app/src/core
mkdir -p $D/{qda,model,i18n,export}
cp -r $T/import $T/text $T/speech $T/service $D/
cp $T/bytes.ts $T/ids.ts $D/
cp $T/qda/{rank,text,util,search}.ts $T/qda/{rank,text,util,search}.test.ts $D/qda/ && cp -r $T/qda/stopwords $D/qda/
cp $T/i18n/{translate,languages,catalogs}.ts $T/i18n/catalogs.test.ts $D/i18n/
cp $T/export/forgeZip.testutil.ts $D/export/                  # for docx.test.ts
rm $D/import/{csv,xlsx,survey}.ts $D/import/tables.test.ts      # optional drop (then edit import/index.ts + detect.ts SUPPORTED)
cp -r /home/feiteira/Trama/app/test-fixtures/import <tramado>/app/test-fixtures/
cp /home/feiteira/Trama/app/src/ui/i18n.tsx <tramado>/app/src/ui/
# plus: write core/model/types.ts shim; new locales/{en,pt,es}/*
```
Licence: both are MPL-2.0 and by the same author. Keep the MPL file-level terms, and add a NOTICE or credit line ("derived from Trama").

---

## 10. Build, tooling and Vitest setup (copy)

`app/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },   // env.d.ts: declare const __APP_VERSION__: string;
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } }, // Tauri devUrl
  build: { target: 'es2022', outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },                                        // pdf.js worker; also a search-index worker
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], testTimeout: 60_000 },
});
```
- **No Vitest setup file.** Tests run in Node. The `vitest/config` reference puts `test` in the Vite config.
- PDFs in tests: `import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'`.
- In the app: `import('pdfjs-dist')` plus a `?url` worker import.
- mammoth is lazy-loaded through `loadMammoth()` (`import('mammoth')`). The Node build reads `{buffer}` and the browser build `{arrayBuffer}`, and Trama passes both.

`app/tsconfig.json`:
- `ES2022` target and lib (`DOM`, `DOM.Iterable`), `module ESNext`, `moduleResolution Bundler`, `jsx react-jsx`
- `strict`, **`noUncheckedIndexedAccess`**, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `isolatedModules`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `types ["vite/client","node"]`, `noEmit`
- include `src`, `scripts`, `vite.config.ts`

Root `package.json`:
- npm workspaces `["app","desktop"]`, `engines.node >= 22.12`
- scripts `dev` (tauri dev), `dev:web` (demo), `typecheck`, `test`, `test:rust`, `lint:rust` (`cargo fmt --check` plus clippy `-D warnings`)

**Gotcha: `@xmldom/xmldom` must be 0.9.x for the app**, but `mammoth` 1.13.0 depends on `^0.8.6`, so npm installs 0.8.15 at the root and 0.9.12 nested in `app/node_modules`. Code compiled against 0.8 fails (`Element`/`Node`/`Document` not exported, `onError` option unknown). Pin `"@xmldom/xmldom": "0.9.12"` in the app workspace, as Trama does.

---

## 11. npm dependencies for Tramado (versions)

| Package | Trama pin (known-good together) | npm latest 2026-11-03 | Tramado |
|---|---|---|---|
| react / react-dom | 18.3.1 | — | keep 18.3.1 (per stack decision) |
| @tauri-apps/api | 2.12.0 | 2.12.4 | keep |
| @tauri-apps/plugin-dialog | 2.8.0 | 2.8.4 | keep |
| @tauri-apps/plugin-http | — | 2.8.3 | **add** (AI fetch; streaming over plugin-http to be verified) |
| @tauri-apps/plugin-opener | — | 2.7.2 | **add** (open a file in the system app, reveal in folder) |
| @tauri-apps/cli (desktop dev) | 2.12.0 | 2.12.4 | keep |
| pdfjs-dist | 6.3.289 | 6.5.438 | keep (extraction **and** viewer) |
| mammoth | 1.13.0 | 1.13.0 | keep (lazy) |
| @xmldom/xmldom | 0.9.12 | 0.9.12 | keep (pin, see gotcha) |
| fflate | 0.8.3 | 0.8.3 | keep |
| luxon (+ @types/luxon 3.7.5) | 3.7.2 | 3.7.2 | keep (i18n dates) |
| lucide-react | 1.52.0 | 1.67.0 | keep |
| @fontsource-variable/instrument-sans, /literata | 5.3.0 | — | keep if the same visual language (self-hosted fonts) |
| papaparse (+ @types 5.5.2) | 5.7.0 | — | **drop** (CSV) |
| @noble/ciphers, @scure/bip39 | 2.4.0 | — | **drop** (no encryption) |
| @noble/hashes | 2.4.0 | — | **drop**: SHA-256 through `crypto.subtle.digest` or the shell's `fs.hash` |
| sql.js (+ @types 1.4.11) | 1.14.2 | — | **drop** |
| typescript | 5.9.3 | 7.0.2 | **stay on 5.9.3**: 7.x is the new native compiler, a separate migration |
| vite | 8.3.1 | 8.3.5 | keep |
| vitest | 5.0.2 | 5.1.0 | keep |
| @vitejs/plugin-react | 6.1.1 | — | keep |
| vite-node | 6.0.0 | — | keep (scripts, e.g. gen of PRIVACY.md) |
| @types/node | 26.6.3 | — | keep |
| @types/react / react-dom | 18.3.28 / 18.3.7 | — | keep |
| playwright-core | 1.62.1 | — | keep (screenshots/e2e over the demo) |

Rust side (for reference; reuse from `desktop/src-tauri`): `tauri 2.12`, `tauri-plugin-dialog 2.8`, `whisper-rs 0.16`, `symphonia 0.6`, `cpal 0.18` (with the `pulseaudio` feature on Linux), `ureq 3.5`, `base64 0.22`, `walkdir 2.5`, `thiserror 2`, `percent-encoding 2`, `gio 0.18` (Linux logind inhibitor). **Drop** `rusqlite` with bundled SQLCipher, `argon2` and `zeroize`.

Keep `.cargo/config.toml` (`GGML_NATIVE=OFF`, AVX2/FMA/F16C on; `MACOSX_DEPLOYMENT_TARGET=14.2`).

The speech model URLs and hashes from `tools/fetch-speech-models.mjs`, to be downloaded on demand instead of bundled:
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`, size 574,041,195, sha256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`
- `https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin`, size 885,098, sha256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`

Rust's `speech/mod.rs` looks for the model in resources, `TRAMA_SPEECH_DIR` or `resources/speech/`. Change it to look in `data_dir/models/` and return `NO_MODEL` until the download has finished.

---

## 12. Gotchas collected

1. `importFile()` drops the PDF `pageStarts`. Extend `ImportedDoc` or call `extractPdfText`.
2. The PDF paragraph builder can merge an article heading with its body (font sizes 1 pt apart). Detect articles by regex at a paragraph start.
3. Running headers and footers in law PDFs pollute BM25. Strip repeated first and last lines.
4. Transcript citations: use the time of the first hit, not the paragraph start.
5. rank.ts stems are 6-letter prefixes. PT/ES/EN do **not** match across languages (the code comment is wrong). Add LLM keyword expansion.
6. rankPassages re-tokenises on every query (about 240 ms for 6 M chars). Use the indexed version in a Worker.
7. `DRAFT_MAX_TOKENS = 900` is too small for free reasoning models (471 reasoning tokens in a short answer). Use about 4,000 and treat empty content with `finish_reason: 'length'` as `EMPTY`.
8. Trama's forced `provider: {zdr: true, data_collection: 'deny'}` gives **404 for free models**. Make it an opt-in setting.
9. OpenRouter `models` fallback: at most 3 entries. The answering model is in the response's `model`; show it in the UI.
10. SSE: skip `:` comment lines; `delta.reasoning` is separate from `delta.content`; errors can arrive mid-stream as a `data:` with `error`.
11. Inline styles vanish in the Tauri/WebKit build without `dangerousDisableAssetCspModification: ["style-src"]`.
12. `@xmldom/xmldom` 0.8 vs 0.9 duplication through mammoth. Pin 0.9.12 in the app workspace.
13. pdf.js takes ownership of the buffer, so `extractPdfText` passes `bytes.slice()`. Keep that.
14. Recordings: never record into the synced folder; compress before syncing (WAV is about 230 MB/hour).
15. Write files atomically (temp file plus rename), and keep **one writer per file** (per-device files) to avoid Syncthing conflict copies.
16. Caches (extracted text, index) and secrets stay out of class folders. Add a `.stignore` entry if any cache must live inside one.
17. Large media: don't `fs.read` an hour of audio into JS to play it (Trama's `MediaBar` builds a Blob URL from the bytes). Use `convertFileSrc` with the asset protocol scope, and plain `blob:` in the demo.
18. Use `bcp47: 'pt-PT'` for plurals (`pt-BR` treats 0 and 1.5 as singular).
19. Gemma with the system role is unverified (always 429). Be ready to fold the system prompt into the user turn.

Report path: /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/research/trama-ts.md
