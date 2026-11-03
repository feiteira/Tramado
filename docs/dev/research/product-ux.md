# Tramado — product and UX design input

*Research for the design phase. Written 2026-11-03. Scope: what students love and hate in the tools they already use, then the information architecture, key flows with English microcopy, feature priorities, privacy and ethics, empty and error states, and accessibility. Includes facts tested today against the live OpenRouter API, and regexes and snippets tested in Node 22. Experiments are in `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/product-ux/`.*

---

## 0. TL;DR

1. **The pitch in one line:** *"Every class in one place. Record it once, and the whole class gets the transcript. Ask your materials anything, with the page or minute it came from. Free, no account, no server."*
2. **Every competitor sells one of Tramado's features, and most put it behind a paywall.** Otter (transcripts) caps free use at 300 min a month and 30 min per recording. Quizlet (practice) limits free Learn rounds. Notability (audio-synced notes) is Apple-only and a subscription. NotebookLM (cited answers) has no class group. WhatsApp and Discord (class groups) expose phone numbers and bury files. Tramado can be the free place where all of these meet, built around **the class**.
3. **Zero setup.** A class is a name, a colour and an emoji. Everything else is automatic: the same tabs in every class, auto-named lectures, files dropped in chat filed under Documents. Notion setups fail because students build too much in August and quit by October.
4. **Every AI claim must be checkable.** Each claim gets a citation chip that opens the exact PDF page (and article) or plays the transcript from the right second. Students love this in NotebookLM. It also matters most for law students.
5. **Try first, then the AI.** In exam practice the AI answer stays hidden until the student has tried. The evidence is Bastani et al., PNAS 2025: students given plain GPT-4 did 48% better in practice but 17% worse on the exam once it was taken away. A tutor-style version with guardrails removed that harm.
6. **One recording, one transcriber, visible to all.** Show "Ana's laptop is transcribing — 40% · about 25 min left", plus a stale-claim takeover and an opt-in "help transcribe when plugged in". Show recording presence too ("Bruno is already recording this lecture"), so the class doesn't record the same lecture three times.
7. **Consent is a feature, not a footnote.** In Portugal, Código Penal art. 199.º n.º 1 punishes *recording* words not meant for the public without consent, and also *using* a lawful recording beyond consent (prison up to 1 year or a fine). So there are two consents, recording and sharing with the group. They are stored in the class with who and when. "Share transcript only" and "keep private" are options.
8. **OpenRouter facts that change the UX** (tested today):
   - The terms require users to be **18 or older** (updated 31 Aug 2026). High-school users need a no-AI path or a local model (an OpenAI-compatible URL such as Ollama or LM Studio).
   - `provider.data_collection:"deny"` still reaches the requested default `google/gemma-4-31b-it:free` and also `google/gemma-4-26b-a4b-it:free`, `dots-studio/dots-3-note-preview:free` and `cohere/north-mini-code:free`. It **blocks every NVIDIA free model** (they may train).
   - `provider.zdr:true` (Trama's current policy) **blocks every free model tested** except one that was rate-limited.
   - Recommended default: "No training" (`data_collection:"deny"`) with the fallback `models: ["google/gemma-4-31b-it:free","google/gemma-4-26b-a4b-it:free","dots-studio/dots-3-note-preview:free"]`. It answered a cited Portuguese law question today through dots/AtlasCloud while both Gemmas returned 429.
9. **Free-tier limits to show in the UI:** 20 requests a minute. 50 a day if the account has bought less than 10 credits, 1000 a day otherwise. `GET /api/v1/key` returns `free_model_daily_requests: {used, limit, remaining}`, which is enough for a "{remaining} free requests left today" readout.
10. **MVP:** onboarding, classes, documents, recording (in-room and online), on-demand local transcription with a group claim, a transcript player, notes (private or shared), exams (extract → review → cited answers → practise), invite link with QR, class chat with @AI, a per-class Ask, Ctrl+K search, the settings, and a "What leaves this computer" page.
    - **v1.1:** FSRS flashcards, a timetable with "Record now?" prompts, live captions, shared annotations, law-article linking, slide capture.
    - **Later:** mobile, handwriting, semantic search.

---

## 1. Design principles (each one traced to research)

| # | Principle | Why (evidence) |
|---|---|---|
| P1 | **Zero setup beats flexible setup.** A class needs a name. Colour and emoji are suggested. Every class has the same tabs. | Notion: students "built an elaborate system in August and abandoned it by October because it was too complex to maintain". The fix is fewer steps between "I have X" and "X is tracked" ([lifestack](https://lifestack.ai/blog/notion-templates-for-college-students), [Medium](https://medium.com/@explrerhere/why-your-notion-setup-always-fails-fix-this-first-ea057ec65618)). Moodle: students ask for *consistent* course spaces ([Lancaster study](https://ojs.library.lancs.ac.uk/lue/article/download/18/22/65)). |
| P2 | **Every AI claim is checkable in one click** (page, article or timestamp). | NotebookLM's most-praised trait is its inline citations to source passages. Its stated weaknesses: grounding still "can omit an exception… or misstate a detail", and it has no collaboration ([guide](https://zaidalhuda.github.io/notebooklm-guide/NotebookLM_Comprehensive_Guide.pdf), [CASRAI](https://www.casrai.org/guides/notebooklm-for-research-workflows)). |
| P3 | **Try first, then AI.** Hide AI answers in practice until the student has attempted. Offer "hint" before "answer". | Bastani et al., PNAS 122(26) 2025: GPT Base +48% in practice but −17% on the exam; GPT Tutor with guardrails mitigated the harm ([Wharton](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education), [SSRN](https://papers.ssrn.com/abstract=4895486)). |
| P4 | **Free means free.** No minute caps, no rounds-per-day. The only limit is the user's own OpenRouter quota, shown honestly. | Otter free: 300 min a month and 30 min per recording, "insufficient for a full course load" ([affine](https://affine.pro/blog/otter-ai-review-for-students)). Quizlet moved Learn and Test behind round limits. Knowt is "slowly" moving features to paid tiers ([nibble](https://nibble-app.com/blog/knowt-vs-quizlet), [fiveable](https://fiveable.me/knowt-vs-quizlet.md)). |
| P5 | **Audio is anchored to everything.** Notes typed while recording carry timestamps, markers sit on a timeline, and clicking any line plays from there. | Notability's audio-synced notes are "the only reason I choose Notability over GoodNotes". GoodNotes users lobbied for years for the same feature ([GoodNotes feedback board](https://feedback.goodnotes.com/forums/191274-goodnotes-ideas/suggestions/6481557-linked-audio-recording-is-a-must-please-add-audio?page=1), [Laptop Mag](https://laptopmag.com/reviews/apps/notability)). |
| P6 | **One-key colour markers while recording** (Important / Didn't get it / Exam! / To do). | Glean (Sonocent), built for dyslexic learners: categories "Heading, Important, Review, Task" with number-key shortcuts, plus playback speed and pitch control ([Warwick](https://warwick.ac.uk/services/library/using/productivity-tools/sonocent/), [UCF comparison](https://sas.sdes.ucf.edu/wp-content/uploads/sites/22/2020/08/Comparison-Between-Glean-and-Sonocent-Audio-Notetaker.pdf)). |
| P7 | **Chat is not storage.** Files dropped in chat are filed under Documents. Pinned messages show in the class header. | WhatsApp chats are "effectively ephemeral" and important info gets lost among chatter. Discord helps with channels and pins but servers are "poorly run" ([ruzuku](https://www.ruzuku.com/learn/tools/whatsapp/course-accountability), [UBC](https://blogs.ubc.ca/engl30198a2022s12/files/2022/07/Jo-Hempelmann-Project-Proposal.pdf)). |
| P8 | **Names, not phone numbers.** | In a WhatsApp group "everyone in that group now has your child's phone number". The University of Amsterdam's subreddit banned WhatsApp group links for safety ([screenwise](https://screenwiseapp.com/guides/discord-vs-whatsapp-for-school-projects)). |
| P9 | **Card making must be one click, scheduling invisible.** | Anki: "massive learning curve" and "soul-crushing time required to make cards manually". FSRS is better but adds setup ([nibble Anki](https://nibble-app.com/blog/anki-review), [Baylor study](https://cdn.bcm.edu/sites/default/files/2023-09/51-merlinsky-e.pdf)). |
| P10 | **Say what leaves the computer, in plain words, every time.** | Trama's ethos (`/home/feiteira/Trama/PRIVACY.md`, "What leaves this computer"). Otter reviews raise privacy concerns about recording class discussions. |
| P11 | **Offline-first. Sync is a status, never a gate.** | Moodle slows down "before deadlines" ([Capterra](https://www.capterra.com/compare/80691-186631/Moodle-vs-Google-Classroom)). Tramado works with no network, and sync catches up later. |
| P12 | **Separate private and shared spaces clearly.** | OneNote Class Notebook's model works: a read-only Content Library, a Collaboration Space and private sections. Its failure modes were permission breakage and misuse of the shared space ([Microsoft](https://support.microsoft.com/en-us/education/fix-class-notebook-when-welcome-collaboration-space-or-content-library-are-missing), [Pitt](https://www.technology.pitt.edu/blog/classnotebooks)). |

---

## 2. Survey: what students love and hate (and what Tramado takes from it)

| Product | Loved | Hated | Tramado takeaway |
|---|---|---|---|
| **Otter.ai** | Lets you focus in class with a backup transcript. Live transcript with highlights. Slide capture in online meetings. AI Chat over the meeting. Summaries. Helps international and hard-of-hearing students. | 300 min a month and 30 min per recording on free. Accuracy drops with noise, accents and technical terms. Surprise charges. Privacy of recorded discussions. | Unlimited local transcription. A per-class vocabulary hint (names, Latin terms such as *quid iuris*) passed to whisper as the initial prompt. "Check the transcript" review mode. Slide capture in v1.1. Live captions in v1.1. |
| **Notability / GoodNotes** | Audio synced to notes: tap a note, hear that moment. "Note Replay". Several recordings per note, each a dot on the timeline. | Apple-only, subscription. Sync sometimes unreliable. Recording poor unless in the front row. | Timestamped typed notes during recording. A timeline with markers. "Sit near the front" tip. Cross-platform (Linux, Windows, macOS). |
| **NotebookLM** | Source-grounded answers with inline citations. Free. Quizzes, flashcards and study guides from the same sources. | Grounding is not truth. Strict "won't answer off-source". Source caps. No collaboration. Audio overviews can be superficial. | Citations everywhere, a class-wide shared source set, an explicit "Allow general knowledge (marked unverified)" switch, and per-class Ask. |
| **StudyFetch** | Auto flashcards, quizzes and summaries. Live lecture recording. An AI tutor. | Vague about its limitations. Customer service. 3.5/5 Trustpilot (secondary source). Paid. | Be explicit about AI limits. Show which model answered and from which sources. |
| **Knowt** | Free Learn mode. Imports from Quizlet. Notes to flashcards. | Ads, bugs, and features drifting behind the Ultra paywall. | No ads, no tiers. Open source keeps it honest. |
| **Quizlet** | Huge shared library. Learn mode (adaptive retrieval). Google Classroom tie-in. | Free Learn and Test now limited to a few rounds a day. AI behind a paywall since 2023–24. | Practice is unlimited. Classmates' shared exam questions act as a class-sized "library". |
| **Anki** | Long-term retention. FSRS. Total control. | Learning curve. Dated UI. Manual card creation. Review pile-ups at high retention. | AI-suggested cards, accepted one by one. Hidden FSRS with 2 buttons by default and 4 optional. A daily cap. Export to Anki (TSV) in v1.1. |
| **OneNote Class Notebook** | A clear content library, collaboration space and private sections. | Sections vanish when permissions break. Students moving teacher content. Misuse of the shared space. | Shared and private split by *location* (private data never in the synced folder). Organiser roles. Read-only class folders (Syncthing send-only) later. |
| **Google Classroom / Moodle** | Easy setup (Classroom). Everything the lecturer posts is in one place. | Moodle is dated and has inconsistent navigation. Weak mobile and inconsistent notifications. Slow before deadlines. Course-invite confusion. | Same tabs in every class. Notifications that matter (exam date changed, new lecture transcript, @you). Import from Moodle later. |
| **WhatsApp / Discord groups** | Everyone is already there. Instant. Discord channels and pins. | Phone numbers exposed. Info and files buried. Notification flood. Poorly run servers. Shared test questions put the class at risk. | Names only. Pins in the class header. Files auto-filed. "Mute but tell me @mentions and exam changes" by default. Integrity note on exams. |
| **Obsidian for law** | Linking cases and statutes. A plugin for legal references. Plain files. | Maintenance burden. "Two hours designing the perfect case database and zero hours reading the cases". | Plain files, no setup. Auto-detect article references (`art. 483.º do CC`) and link them to the student's own copy of the code (v1.1). |

---

## 3. Information architecture

### 3.1 Vocabulary (decide once, use everywhere)

| Concept | EN | PT-PT | ES | Notes |
|---|---|---|---|---|
| A course (folder) | **Class** | **Disciplina** | **Asignatura** | PT university slang is "cadeira" and the formal term is "unidade curricular (UC)". "Disciplina" works for both school and university. |
| One meeting / recording | **Lecture** | **Aula** | **Clase** | In EN, "Lecture" reads fine for high school too. Default name: "Lecture 6 — Tue 14 Oct" / "Aula 6 — ter., 14 out." / "Clase 6 — mar. 14 oct." |
| Test/exam paper | **Exam** (kinds: Quiz, Test, Midterm, Final, Oral, Practice sheet) | **Exame / Teste** (kinds: Teste, Frequência, Exame — época normal, Exame — época de recurso, Exame — época especial, Oral, Ficha de exercícios) | **Examen** (kinds: Parcial, Final — convocatoria ordinaria, Final — convocatoria extraordinaria, Oral, Hoja de ejercicios) | Points label: EN "points", PT "valores" (scale 0–20, pass ≥ 9.5), ES "puntos" (scale 0–10, pass ≥ 5). |
| Group member who created the class | **Organiser** | **Organizador(a)** — or warmly, "delegado/a" | **Organizador/a** | PT has "delegado de turma" and ES "delegado de clase". This works as a playful hint in empty states, not a role name. |
| Classmate | Classmate | Colega | Compañero/a | |
| AI assistant | **Ask** (tab) / **@AI** in chat | **Perguntar** / **@IA** | **Preguntar** / **@IA** | Accept `@ai`, `@ia`, `@AI` and `@IA` in every language. |
| Private | Only you | Só você / Só tu | Solo tú | Trama's PT catalog uses "você" ("Diga no início…"). Keep that register. |

### 3.2 Navigation model

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ ☀ Today      │  (content)                                                    │
│ 🔍 Search ⌘K │                                                              │
│──────────────│                                                              │
│ CLASSES      │                                                              │
│ ⚖️ TGDC    3 │  ← unread chat badge                                         │
│ 📜 Hist. D.  │                                                              │
│ 🧮 Estat. ●  │  ← red dot = recording now                                   │
│ + New class  │                                                              │
│ ⤓ Join class │                                                              │
│──────────────│                                                              │
│ ⚙ Settings   │                                                              │
│ ⟳ Synced ✓   │  ← sync pill: "Synced" / "Syncing 3 files" / "Offline" /      │
│ ✦ AI: Gemma  │    "Sharing off". AI pill: model, or "AI off"; click = settings│
└──────────────┴──────────────────────────────────────────────────────────────┘
          ▲ global recording bar docks at the bottom when recording (any screen)
```

- Left rail (collapsible). Each class row shows a colour bar, the emoji and its short name. The colour is never the only signal: the emoji and name are always there.
- **Ctrl/⌘+K** opens one palette for search and commands, reusing Trama's `CommandPalette` (`/home/feiteira/Trama/app/src/shell/CommandPalette.tsx`).
- **Ctrl/⌘+Shift+R** starts or stops recording in the current class (or asks which class).
- Archived classes (past terms) sit under "Archive" at the bottom of the class list.

### 3.3 Today (home)

```
Good afternoon, Ana                                       Tue 3 Nov · Week 8
┌ COMING UP ─────────────────────────────────────────────────────────────────┐
│ ⚖️ TGDC — Frequência        in 9 days (Thu 12 Nov, 10:00)  [Practise 14 ▸] │
│ 🧮 Estatística — Teste      in 16 days                     [Practise 6 ▸]  │
└────────────────────────────────────────────────────────────────────────────┘
┌ NEXT CLASS (v1.1, timetable) ───┐ ┌ PRACTICE DUE ─────────────────────────┐
│ 📜 História do Direito  14:00   │ │ 23 cards due · about 8 min  [Start]   │
│ Room 2.03         [● Record]    │ └───────────────────────────────────────┘
└─────────────────────────────────┘
┌ RECENT LECTURES ──────────────────────────────────────────────────────────┐
│ ⚖️ Lecture 6 — Negócio jurídico      Today 10:00 · 1h32 · transcript ✓   │
│ 🧮 Lecture 5 — Intervalos de conf.   Yesterday · Ana's laptop 40%  ◐     │
│ 📜 Lecture 7 — Direito romano        Mon · waiting for a transcriber  ⏸  │
└───────────────────────────────────────────────────────────────────────────┘
┌ UNREAD ───────────────────────────────┐ ┌ TRANSCRIPTIONS ───────────────────┐
│ ⚖️ TGDC  3 messages · 📌 1 new pin    │ │ This computer: idle               │
│ 🧮 Estat. Bruno: "@Ana do you have…"  │ │ Ana's laptop: Lecture 5, 40%      │
└───────────────────────────────────────┘ │ 1 waiting  [Transcribe it here]   │
                                          └───────────────────────────────────┘
```

Rules: sections hide when empty. On the first day Today is a friendly checklist instead (see §7.1). Exams within 3 days get a stronger visual and say "Tomorrow" or "In 2 days". Never use red for countdowns (it causes anxiety). Use the class colour plus a calendar icon.

### 3.4 Class list (when the rail is not enough)

A grid of cards, one per class. Each card has a colour band, an emoji, the name, the lecturer and the term. It shows counts (lectures, documents, exams), the next exam countdown, member avatars (initials) with presence dots, and a sync status line ("Up to date", "Syncing 12 files", "Only on this computer"). Actions: open, pin to top, archive, colour and emoji, leave.

### 3.5 Class view

```
⚖️ Teoria Geral do Direito Civil  ·  Prof. Menezes · 2026/27 S1 · 12 classmates ●●●○
📌 "Frequência moved to 12 Nov, room 1.02" — Bruno, pinned                  [✕]
[● Record lecture]   [+ Add]  ⌄                          ⟳ Up to date · 3 online
──────────────────────────────────────────────────────────────────────────────────
 Lectures · Documents · Notes · Exams · Ask · Chat (3) · Members
```

Tab order, with the reason for each:
1. **Lectures.** The core of the app and what changes weekly. A list grouped by week shows title, date, length, transcript state, marker counts (🎯 4) and who recorded it.
2. **Documents.** Folder view plus a "Recent" view. Shows file type, page count, "added by", and a text-extraction state (searchable ✓ / scan, no text ⚠).
3. **Notes.** Two sections, "My notes 🔒" and "Class notes 👥", Markdown, with backlinks to lectures and timestamps.
4. **Exams.** "Coming up" (date-only cards with a countdown, scope and room) and "Exam papers" (with questions, AI answers, and your marks and progress).
5. **Ask.** AI over this class's sources, in chat form, with filter chips (All / Lectures / Documents / Exams / My notes).
6. **Chat.** The class group, with a pins strip at the top.
7. **Members.** People, then their devices with sync and presence state, the invite button and roles. "Transcription helpers" lists who volunteers.

A class that is not shared hides Chat and Members and shows one "Invite classmates" call to action in their place.

### 3.6 Lecture view (the "wow" screen)

```
Lecture 6 — Negócio jurídico         Tue 14 Oct · 1h32 · recorded by Ana · 👥 shared
▶ ⏸  1.0× ▾  ⟲10 ⟳10   00:41:12 / 01:32:05                    🔊 ── Transcribed ✓
┌ timeline ───────────────────────────────────────────────────────────────────┐
│▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▁▂▃▅▆▅▃▂▂▃▅▆▇▆▅▃▂▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂│
│   ⭐        ❓      🎯🎯🎯(×5 class)        ⭐      📝            🎯           │
│ |—— Intro ——|—— Elementos essenciais ——|—— Vícios da vontade ——|— Resumo —|  │ ← AI chapters
└─────────────────────────────────────────────────────────────────────────────┘
TRANSCRIPT                                          │ SIDE PANEL  [Notes|AI|Markers]
00:40:58  …e portanto a declaração negocial…        │ My notes (timestamped)
00:41:12  🎯 Isto costuma sair no exame: o erro     │ 41:12 erro-vício vs erro…
          sobre o objeto do negócio (art. 251.º)    │ 52:30 ver art. 247.º
          ▲ highlighted, comment (2)                │ AI ▸ Summary · Key terms ·
00:41:40  …                                         │      Flashcards · Exam hints
```

- **Markers aggregate across the class:** "🎯 ×5 class" means five classmates marked that moment "Exam!" in their own copies (v1.1, if markers are shared). This is social proof without a feed.
- **Exam radar** (cheap, delightful): spoken phrases such as "isto sai no exame" are auto-marked 🎯 with an "auto" label. Regex in §9.3.
- **Follow-along:** the current paragraph is highlighted while playing (pausable, and respects reduced motion). Click any line to seek.
- Speed runs 0.5–3× with pitch preserved (the HTML media `preservesPitch` default). "Skip silences" is optional (v1.1).

### 3.7 Document view

PDF.js viewer with page anchors (`#page=34`) and highlight overlays for cited passages, Trama-style. DOCX is shown as rendered text through mammoth (already in Trama: `mammoth 1.13.0`, `pdfjs-dist 6.3.289`). The side panel has My highlights, Class comments, Ask about this document and Explain selection. For legislation PDFs, a table of contents of articles (`Artigo 122.º`…) is built from the text so citations can say "art. 122.º — p. 34".

### 3.8 Exam view

The left column lists questions with status icons (unanswered, AI answered, ✓ right, ~ partly, ✗ wrong, 🔁 in practice). The right column shows the question, then *Your answer*, then *AI answer* (hidden until you try), then the source chips, then "Is this right?". The header shows points and kind chips and a "Practise this paper" button.

### 3.9 Global search (Ctrl/⌘+K)

- A single input. Results grouped as **Lectures** (snippet + ▶ timestamp), **Documents** (snippet + page), **Notes**, **Exams**, **Chat**, then **Commands**.
- Filter chips: current class / all classes · type · date.
- Accent- and case-insensitive (PT/ES need "acao" to match "ação"). Optional stemming.
- The last row is always "✦ Ask AI: *your query*", scoped to the current class or all classes.
- Works offline and without an AI key. AI only reranks or answers on request.

### 3.10 Settings

1. **Profile**
   - Your name, shown to classmates.
   - This computer's name, e.g. "Ana's laptop".
   - Avatar initials and colour.
2. **Language and appearance**
   - Language: English / Português / Español. Each is shown in its own language.
   - Theme: System / Light / Dark.
   - Text size.
   - Reading font: Default / Atkinson Hyperlegible / OpenDyslexic.
   - Reduce motion.
3. **AI (OpenRouter)**
   - Key: paste it, test it, remove it. It is stored in the OS keychain, never in a class folder.
   - Model: default `google/gemma-4-31b-it:free`. Fallbacks: up to 2 more.
   - Privacy level: Strict (zero data retention), **No training** (default), or Allow free models that may train.
   - Free requests left today.
   - "Use a different service (OpenAI-compatible URL)" for Ollama, LM Studio or a university server.
   - Answer language: same as the question, or always mine.
4. **Transcription**
   - Speech model: Not downloaded / Fast (190 MB) / Best (575 MB), with a Download or Remove button.
   - Default language per class.
   - "Help transcribe the class's lectures": Off / When plugged in / Always.
   - Cloud transcription with OpenRouter: off by default.
5. **Sharing (Syncthing)**
   - Status: running, version, port.
   - This computer's ID, with "Show QR" for adding your own second computer.
   - Your other computers.
   - Bandwidth limits.
   - "Sync on metered or mobile connections".
   - "Skip audio files in classes" (default off).
   - Advanced: open the Syncthing web UI, or use an existing Syncthing.
6. **Notifications**
   - Exam changes, @mentions, new transcripts and chat. Default: everything except routine chat, which is badge-only.
7. **Privacy**
   - The "What leaves this computer" page.
   - Recording consent defaults.
   - Delete audio after N days once the transcript is checked: Never / 30 / 90 / end of term.
8. **Storage**
   - Where classes live (default `~/Tramado`) and space used per class.
   - Clean up recordings.
9. **Help and about.**

### 3.11 What lives where (UX-relevant mapping onto plain files)

This sketch only says what is shared and what is private. The exact format is for the design phase.

```
~/Tramado/                                   ← user-visible root, plain files
  Teoria Geral do Direito Civil/             ← one Syncthing folder = one class (shared)
    .tramado/class.json                      name, colour, emoji, lecturer, term, consent records, roles
    .tramado/presence/<deviceId>.json        "recording now", "transcribing 40%", heartbeat (each device writes only its own)
    .tramado/claims/<lectureId>.json         who transcribes what
    Lectures/2026-10-14 Lecture 6/           audio.opus, transcript.json + transcript.md, markers.<deviceId>.json
    Documents/…                              user's files as-is (they can open them without Tramado)
    Exams/2025-06 Exame época normal/        exam.pdf, questions.json, ai-answers.json
    Notes/                                   class (shared) notes, Markdown
    Chat/<deviceId>/2026-11.jsonl            append-only, one writer per file → no sync conflicts
<app data dir>/private/<classId>/            ← NEVER synced: my notes, my highlights, practice/FSRS state,
                                               Ask history, drafts, exam marks
<OS keychain>                                ← OpenRouter key
<app data dir>/models/                       ← whisper model (downloaded on demand)
```

Keep private data **outside** the synced folder rather than relying on `.stignore`. Syncthing does not sync `.stignore` itself, so a mistake there leaks data silently. Store audio as Opus mono at ~24–32 kbps, about 11–14 MB an hour. Trama's WAV-like recordings take ~230 MB an hour (Trama manual §Practicalities), which would make class sync painful.

---

## 4. Key flows, step by step, with English microcopy

Tone follows Trama: plain, second person, honest about trade-offs, no exclamation-mark spam, sentence case. One warm touch per screen at most. Placeholders in `{braces}`.

### 4.1 First run and onboarding (about 60 seconds, 4 screens, everything optional except a name)

**Screen 1 — Welcome**
- Language chooser at the top, pre-selected from the OS: `English · Português · Español`
- Title: **Tramado**
- Body: "Your classes in one place: lectures, transcripts, documents, exams and your class group. Free and open source. Your classes stay on your computer and your classmates' computers, with no Tramado server in between."
- Button: **Get started**
- Footnote: "No account. Nothing leaves this computer until you share a class or turn on AI."

**Screen 2 — Your name**
- Title: "What should classmates call you?"
- Field placeholder: "e.g. Ana Ribeiro"
- Hint: "Shown next to your messages and recordings in classes you share. You can change it later."
- Sub-line (auto): "This computer will appear as **{name}'s laptop**." [Change]
- Button: **Continue**

**Screen 3 — AI help (optional)**
- Title: "AI help (optional)"
- Body: "Tramado can answer exam questions from your own classes, explain a passage, summarise a lecture and suggest flashcards. It uses OpenRouter with your own key, and free models work."
- Field: "OpenRouter key" [Paste]. Link: "Get a free key at openrouter.ai/keys ↗"
- Note, small, always visible: "OpenRouter is for people aged 18 or over. If you are younger, skip this: everything else in Tramado works without AI."
- Privacy line: "When you ask the AI something, your question and the passages it needs go to OpenRouter and the company running the model. Tramado asks only for providers that don't train on what you send."
- Button: **Test and save**. States:
  - Working: "Checking your key…"
  - OK: "✓ Works. Gemma 4 31B (free) is your model, and you have {n} free requests left today."
  - OK but default model busy: "✓ Your key works. The free model is busy right now (that's common). Tramado will try {fallback} when that happens."
  - 401: "OpenRouter didn't accept this key. Check you copied all of it (it starts with `sk-or-`)."
- Secondary: **Skip for now**

**Screen 4 — Ready**
- Title: "You're set, {first name}."
- Two big choices:
  - **Create a class**: "Start a class for a subject you're taking."
  - **Join a class**: "Paste an invite a classmate sent you."
- Footnote: "The speech model for transcribing lectures (575 MB) downloads the first time you need it."

There is no Syncthing screen. Sharing sets itself up the first time the user shares or joins a class. Start Syncthing only then, which honours "no network until you choose" (see §6.5). If Syncthing starts later and fails, use the errors in §7.2.

### 4.2 Create a class

Dialog **New class**:
- "Name": placeholder "e.g. Teoria Geral do Direito Civil"
- "Short name" (auto-suggested from initials, editable): "TGDC". Hint: "Used in the sidebar and in chat."
- "Colour": 12 swatches. Pre-pick one not used by other classes. Each is tuned with Trama's `ensureContrast()` (`/home/feiteira/Trama/app/src/ui/color.ts`) for light and dark.
- "Icon": a suggested emoji from keywords (Direito/Law/Derecho → ⚖️, História/History → 📜, Estatística/Statistics/Matemática → 🧮, Biologia → 🧬, Química → ⚗️, Economia → 📈, Inglês → 🇬🇧, Programação → 💻), plus [Choose…] for an emoji picker.
- "Lecturer (optional)", "Term (optional)": "2026/27 · Semester 1"
- "Language spoken in lectures": defaults to the app language. It is used for transcription and AI answers.
- Switch: **Share with classmates** (default on).
  - On: "Classmates you invite get the lectures, documents, class notes and chat. Your own notes, highlights and practice stay on your computer."
  - Off: "Only on this computer. You can share it later."
- Button: **Create class**

After creation the class opens with its empty states (§7.1). If shared, a dismissible card offers **Invite classmates**.

### 4.3 Invite classmates

Button **Invite** (in Members, the class header ⋯ menu, and the empty Chat) opens a sheet:

- Title: "Invite classmates to ⚖️ TGDC"
- Body: "Send this invite wherever your class talks: your WhatsApp group, Discord, Moodle forum or email. Anyone who has it can ask to join, and you confirm each person."
- **Invite link** (big, one click): `https://tramado.app/join#v1.eyJm…` [**Copy link**]
  - Hosted as a *static* page, so it is still serverless. The payload lives in the URL **fragment**, which browsers never send to the server. The page says "Open in Tramado" (`tramado://join/…`) or "Get Tramado" with OS-specific downloads.
- [**Show QR code**] for the lecture room: classmates scan from the projector or your screen with their phone. The phone opens the static page, then they tap "Send to my computer" (share or email the link to themselves). Alternatively they scan with Tramado's own "Scan invite" camera button (v1.1).
- [**Copy invite code**]: the raw payload for people pasting into Tramado's "Join" box. Microcopy: "Invite code (it's long — copy and paste it, don't type it)".
- [Save as file…] writes a `TGDC.tramado-invite` file for email attachments or Moodle.
- Options (collapsed): "Let people in without asking me, for the next 24 hours" (default **off**). "Other members can let people in" (default **on**, so the organiser need not be online).
- Footer, honest: "People join through your computer the first time, or any member's who is online. If nobody is online, they wait."

Payload contents (design-level): version, class folder ID, class name, emoji, colour, inviter name, the device IDs of up to 3 members likely online (organisers first), creation date, optional expiry, and a random invite secret. At about 300–400 characters it fits in a QR code. A Syncthing device ID alone is 63 characters (8 groups of 7 base32 characters plus dashes), so a truly *short* code is impossible without a rendezvous server. Say so in the docs and don't pretend otherwise.

**What the inviter sees when someone asks:**
Toast and notification: "**Bruno Costa** ("Bruno's laptop") wants to join ⚖️ TGDC. Check: **amber-otter** · [Let in] [Not now] [Decline]"
- The two "check words" come from the joiner's device ID and are shown on both screens, like Signal safety numbers. They are optional to compare and protect against a leaked invite. Microcopy under them: "Bruno sees the same two words. If you're unsure, ask him."
- When several are waiting: "3 people want to join TGDC: Bruno Costa, Carla M., Diogo · [Let all in] [Review]"

### 4.4 Join a class (what the joiner sees)

1. Opening the link or pasting the code shows a preview card:
   - "**Ana Ribeiro** invited you to"
   - "⚖️ **Teoria Geral do Direito Civil** — Prof. Menezes · 2026/27 S1"
   - "What you'll get: lectures and transcripts, documents, class notes and the class chat. Your own notes, highlights and practice stay private."
2. "Keep it in: `~/Tramado/Teoria Geral do Direito Civil`" [Change]
   - Checkbox: "Also download lecture recordings (about 15 MB per hour)", default on. Hint when off: "You'll still get every transcript. Turn recordings on later in the class settings."
3. Ground rules, one checkbox, shown only if the class has recording consent records: "Recordings in this class were made with the lecturer's permission **for this class only**. I won't share them outside it." ☐
4. Name check (pre-filled from the profile): "You'll appear as **Bruno Costa**." [Change]
5. Button: **Ask to join**
6. Waiting state: "Waiting for Ana or another member to let you in… Your check words: **amber-otter**. You can close this window. Tramado will tell you when you're in."
   - If nobody is online after 30 s: "No one from the class is online right now. You'll join as soon as someone opens Tramado."
7. Accepted: "You're in! Getting ⚖️ TGDC… 23 of 61 files". The class opens immediately. Items still syncing show a small ⟳ and open as soon as they arrive.
8. Declined, or the invite expired: "This invite didn't work. Ask {inviter} for a new one."

**Adding your own second computer** (Settings → Sharing → Your computers): "Show this computer's QR code" on one machine, "Add a computer" (paste or scan) on the other. All your classes appear there too. Your private data is **not** copied: it's per-computer. Say this clearly. Syncing private data between *your own* devices is a v1.1 option: a separate unshared "Private" Syncthing folder that only your devices hold.

### 4.5 Record a lecture

**Entry points:** the class header **● Record lecture**, Today's "Next class" card (v1.1), Ctrl/⌘+Shift+R, and the tray icon on Windows and Linux (v1.1).

**Dialog "Record a lecture in ⚖️ TGDC"** (remembers answers per class, so the second time it's one click):

- "Where is the lecture?"
  - ◉ **In the room**: "Uses this computer's microphone. Sit near the front, close to the lecturer or a loudspeaker."
  - ○ **Online**: "Records your microphone and what your computer plays (Zoom, Teams, Meet, Colibri…). Wear headphones so the lecture isn't recorded twice." (Reuse Trama's `speech.record.headphones` text.)
- "Language spoken": Português (Portugal) ▾, with Detect automatically as an option.
- **Consent** (required; Trama-style wording):
  - ☐ "The lecturer agreed to this lecture being recorded."
  - When the class is shared, "Share with the class":
    - ◉ "Recording and transcript"
    - ○ "Transcript only (the recording stays on this computer)"
    - ○ "Nothing yet — I'll decide after"
  - ☐ shown when sharing is selected: "The lecturer agreed to sharing it with this class group."
  - Hint: "In Portugal and Spain, recording someone without their consent, or using a recording for more than they agreed to, can be against the law. Ask at the start of the first lecture: most lecturers say yes for study. [Why this matters]"
  - ☐ "Remember for this class". This writes a consent record to `class.json`, for example "Lecturer agreed to recording and sharing — confirmed by Ana, 14 Oct 2026", visible to all members under Members → Recording permissions.
- **Presence warning**, only when someone else is already recording this class:
  - "**Bruno is already recording this lecture** (since 14:02, in the room). Only one recording gets transcribed for the class."
  - [Record anyway, as a backup] [Don't record]
- Button: **Start recording**

**While recording** (a bar docked at the bottom of every screen, never hidden):

```
● REC  ⚖️ TGDC · Lecture 6   00:41:12   🎙▁▃▅▃▁  [⏸ Pause] [■ Stop]
   1 ⭐ Important   2 ❓ Didn't get it   3 🎯 Exam!   4 ✅ To do    N  Note
```

- Keys 1–4 drop a marker at the current time. Toast: "🎯 Marked *Exam!* at 41:12" with Undo. Clicking a marker chip does the same.
- **N** opens a one-line note field, timestamped at the moment you *started* typing.
- Battery line when unplugged: "On battery: about {h} h left. Plug in if the lecture runs long."
- "Tramado keeps this computer awake while recording." (Trama already does this.)
- If the mic is silent for 2 min, a gentle warning: "We haven't heard anything for 2 minutes. Is the microphone muted?" [Check]
- Online mode shows two level meters: "You" and "Computer sound". If one track fails, reuse Trama's `micOff` and `systemOff` text.
- Crash safety: write audio in chunks so a crash keeps what was recorded. On the next start: "A recording of TGDC was interrupted at 00:52:10. [Keep what was recorded] [Delete it]".

**Stop → "Save lecture"**
- Title (pre-filled): "Lecture 6 — Tue 14 Oct". After the transcript exists, Tramado suggests an AI title: "Negócio jurídico: elementos essenciais" [Use].
- "Transcript":
  - ◉ "Transcribe on this computer" (about {time}; the model downloads first if needed)
  - ○ "Let a classmate's computer do it" (shared classes only)
  - ○ "With OpenRouter: a few minutes; the audio is sent to {provider}"
  - ○ "Not now"
- Button: **Save**

### 4.6 Transcription status across the group

State card on the lecture, mirrored on Today:

| State | Microcopy | Actions |
|---|---|---|
| No claim | "**Waiting for a transcriber.** Anyone in the class can transcribe this lecture once, for everyone." | [Transcribe on this computer] |
| Claimed, healthy (heartbeat < 2 min) | "**Ana's laptop is transcribing — 40%** · about 25 min left" | [Notify me when it's ready] |
| Claimed, heartbeat 2–10 min | "Ana's laptop is transcribing — 40% · last update 6 min ago (it may be asleep or offline)" | — |
| Claimed, stale (> 10 min, or offline > 10 min) | "**Ana's laptop stopped** at 40%, 14 min ago." | [Take over on this computer] |
| This computer | "Transcribing on this computer — 62% · about 12 min left. You can keep working. Plug in if you can." | [Pause] [Stop and let someone else do it] |
| Done | "Transcribed by **Ana's laptop** · Whisper large-v3-turbo · 14 Oct · 👏 Thank Ana" | [Re-transcribe…] (asks for confirmation; replaces it for everyone) |
| Failed | "Transcription failed on Ana's laptop: {reason}." | [Try on this computer] |

- **Volunteer setting** (Settings → Transcription, also offered after joining a shared class): "Help transcribe the class's lectures automatically: ○ Off ◉ When this computer is plugged in ○ Always". With "plugged in", the device claims unclaimed lectures only on AC power, and only when the model is already downloaded.
- **Default rule:** the recorder's computer claims automatically if the model is present. Otherwise the lecture waits for a volunteer or a manual click.
- **The 👏 "Thank Ana" button** posts a small reaction in chat ("Bruno thanked Ana for transcribing Lecture 6"). It's lightweight social glue that rewards the volunteer.
- **Model download on demand**, the first time someone transcribes:
  - "**Transcribing on this computer needs a speech model** (downloads once, then works offline)."
    - ◉ "Best: 575 MB, fewer mistakes" (`ggml-large-v3-turbo-q5_0.bin`, 574 MB on Hugging Face)
    - ○ "Fast: 190 MB, for older computers" (`ggml-small-q5_1.bin`)
  - "Saved in Tramado's own folder (not in your classes)." [Download and transcribe] [Use OpenRouter instead] [Let a classmate do it]
  - Progress: "Downloading the speech model — 212 of 575 MB · about 2 min". Verify the SHA-256 after downloading, as Trama does at build time.

### 4.7 Add documents

- **Drag and drop anywhere** on a class. Overlay: "Drop to add to ⚖️ TGDC → Documents". Dropping on the Exams tab asks "Add as an exam paper?"
- Multi-file progress toast: "Adding 4 files… Reading text for search and AI (3 of 4)". When done: "Added 4 files to TGDC." [Undo]
- **Where?** A chip on each new file: 👥 "Shared with the class". The menu offers "Keep private (only you)", which moves the file to private storage.
- **Duplicate detection** by hash: "Ana already added *Código Civil (2025).pdf* on 3 Oct. [Open hers] [Add anyway]"
- **Scanned PDF** (no text layer): a chip "⚠ Scan — no text". The panel says "This PDF is a scanned image, so search and AI can't read it yet." [Read the text with AI (sends the pages to OpenRouter)]. Local OCR comes later.
- **Suggested folders** on first add: Slides · Readings · Legislation · Past exams · Other. One click accepts them, or the student can ignore folders entirely.
- Supported for MVP: PDF, DOCX (mammoth), PPTX (text extraction per slide; slide images later), TXT/MD, images (stored; AI vision describes them on request), audio and video files (shown under **Lectures**: "This looks like a recording. Add it as a lecture?").

### 4.8 Exams: add → extract → review → AI answers with citations → mark → practise

**A. Coming up** (a date only, for countdowns): Exams → **+ Add** → "**An upcoming test or exam**"
- Kind ▾ (localised list, §3.1), Date and time, Room (optional), "What it covers" (optional free text, or ticked lectures and documents), Weight (optional).
- Microcopy: "Tramado will count down on Today and suggest what to practise."

**B. An exam paper** (questions): Exams → **+ Add** → "**An exam paper or practice questions**"
1. "Drop a PDF, Word file or photo, or [type or paste the questions]."
   - Fields: "Name" (pre-filled from the file or a detected header: "TGDC — Exame época normal — 2025/06/20"), Kind, Year.
2. **Extraction.** Progress: "Reading the questions… (with {model})"
   - For photos and scans the model needs vision. Gemma 4 and Nemotron VL free accept images, per `architecture.input_modalities`.
3. **Review screen**, mandatory and short:
   - Title: "**We found 6 questions.** Check them before the AI answers. Fix any that were split or merged."
   - Each card has: number (`I`, `II.a`), points ("8 valores"), a kind chip (Case · Essay · Short answer · Multiple choice · Comment · Calculation · Other), editable text, and [Split] [Merge with next] [Delete].
   - "Choose 2 of 3" groups render as a bracket: "Answer 2 of a, b, c".
   - Exam rules found: "Permitida a consulta de legislação não anotada · 2 h". These are kept as context for the AI ("allowed: unannotated legislation").
   - Button: **Looks right — answer them** · secondary [Save without answers]
   - *Evidence this step is needed:* today's extraction test with the free fallback model (dots-3-note-preview) labelled a *case* question and a *comment* question as "multiple_choice". It did not split II a/b/c and lost "+ 2 de redação". See §8.4.
4. **Answer settings** (one line, expandable):
   - "Answer from: ◉ your class materials only ○ your materials, plus general knowledge (marked as unverified)"
   - "◉ **Try each question yourself first** (recommended)"
   - Hint: "Answering before you look is what makes it stick."
5. **Answering:** "Answering 6 questions with Gemma 4 31B (free)… 2 of 6". Each answer appears as it completes. The model actually used is shown per answer: "answered by NVIDIA Nemotron (fallback)".
6. **Per-question review card:**

```
II.a  Distinga erro-vício de erro na declaração.                    3 valores · Short answer
┌ Your answer ────────────────────────────────────────────────────────────────┐
│ (write or think, then reveal)                                               │
└─────────────────────────────────────────────────────────────────────────────┘
[ Show the AI's answer ]  [ Give me a hint ]

── AI answer · Gemma 4 31B (free) · from 3 of your sources ──────────────────
O erro-vício incide sobre a formação da vontade [1] (arts. 251.º e 252.º CC [2]),
enquanto o erro na declaração é uma divergência entre a vontade e a declaração [3]…
⚠ One sentence isn't in your materials: "…" (general knowledge — check it)
Sources:  [1] Lecture 6 ▶ 41:12   [2] Código Civil.pdf · p. 52 · art. 251.º   [3] Manual TGDC.pdf · p. 310
Is this right?   [✓ Right]  [~ Partly]  [✗ Wrong]  [? Not sure]
                 [Add the correct answer…]   ☑ Add to practice
```

   - Citation chips open the PDF at the page with the passage highlighted, or play the lecture from 10 s before the timestamp. A footnote-style "[1]" in the answer text links to the same chip.
   - "**Not in your materials**" must be explicit. Rendering it as a separate, differently styled paragraph is a must for law.
   - Case questions (*hipóteses práticas*) get a structured answer template: "**Problem → Applicable rules → Application to the facts → Conclusion**" (PT: "Questão → Normas aplicáveis → Aplicação → Conclusão"). Article references are auto-linked (§9.3).
   - "Give me a hint" (tutor mode) returns the relevant sources and a guiding question, *not* the answer. This is the GPT Tutor pattern from Bastani et al.
7. **Marks** stay private by default. A shared class may opt in (v1.1) to "Class check: 4 classmates marked this AI answer right, 1 wrong", which helps everyone spot hallucinations.
8. **Practise:** a "Practise this paper" or "Practise TGDC (14 due)" button.
   - The card shows the question, then **Show answer** (Space): your answer if you wrote one, otherwise your corrected answer, otherwise the AI answer with sources.
   - Then "How did it go?": [**Again** (1)] [**Got it** (2)] by default. Advanced: Again / Hard / Good / Easy (1–4) for FSRS.
   - End screen: "Done for today. Next: 5 questions tomorrow. ⚖️ Frequência in 9 days."
   - The keyboard model matches Trama's practice screen (`questions.practice.keys` in `/home/feiteira/Trama/app/src/core/i18n/locales/en/questions.ts`).
9. **Integrity note**, shown once per exam paper as a dismissible info line: "For practice and past papers. Using AI during an actual test or exam is usually against the rules."

### 4.9 Chat (with @AI)

- Composer: "Message TGDC…". Supports @mention autocomplete (members plus **@AI**), attachments, Markdown-lite (bold, lists, code), and replies (quote a message).
- **Attachments go to Documents** ("Documents › From chat"), and the message shows the file card. Microcopy on the first attachment: "Files you send in chat are also kept in Documents, so they don't get lost."
- **Pins:** message ⋯ → "Pin for the class". Pins show in the strip under the class header: "📌 Frequência moved to 12 Nov, room 1.02 — Bruno". Any member can pin, and organisers can unpin anyone's pins.
- **Message states** (honest about peer-to-peer):
  - "Saved — will send when a classmate is online" (🕓)
  - "Sent" (✓) once at least one other member's device has it
  - On hover: "Delivered to 7 of 12 classmates' computers" (v1.1)
- **Exam-date chips:** a message mentioning a date plus "frequência/teste/exame/test/exam/examen" offers [Add to Exams: Coming up?]. This is a small, delightful touch.
- **@AI in chat:**
  - Example: "@AI what did the lecturer say about reserva mental?"
  - The **asker's** computer runs the request with the **asker's** key, using **shared class materials only**: never anyone's private notes, never the chat itself unless the asker quotes it.
  - Reply bubble: "✦ **Tramado AI** · asked by Ana · Gemma 4 31B (free)", followed by the answer with citation chips. The chips work for everyone, because the cited files are in everyone's copy of the class.
  - While working, a placeholder: "✦ Looking through 8 lectures and 23 documents…"
  - Asker has no AI set up (inline, only visible to them): "To ask @AI, set up AI in Settings. Classmates' keys are never shared." [Set up AI]
  - Rate-limited: "✦ The free model is busy right now. [Try again] [Try {fallback}]"
  - Under 18 / AI off: "@AI" doesn't autocomplete. Typing it shows "AI is off on this computer."
- **Notifications default:** badge only for chat. Notify for @you, @everyone (organisers only), pins and exam-date changes. Microcopy in the class ⋯ menu: "Notify me: ◉ Mentions and important ○ Every message ○ Nothing".
- **Moderation, lightweight:** delete your own messages (removal syncs); organisers can hide a message for everyone; "Remove {name} from the class". Honest note: "{name} keeps what was already on their computer."

### 4.10 Annotating transcripts and documents

Select text in a transcript or document to open a floating toolbar:

`[🖍 Highlight ▾] [💬 Comment] [✦ Explain] [🃏 Flashcard] [✦ Ask…] [⧉ Copy with source]`

- **Highlight:** 5 colours with *names*, defaulting to the marker meanings (Important, Didn't get it, Exam, To do, Other). Highlights are 🔒 private by default.
- **Comment:** text plus a visibility toggle "🔒 Only me / 👥 Class". A shared comment appears for everyone with the author's name, and can be replied to (thread) in v1.1.
- **✦ Explain this passage** opens a side panel with a plain-language explanation of the selection, using the surrounding minute of transcript and related sources (cited).
  - Chips: [Simpler] [More detail] [Give an example] [Explain in Português] [How might this come up in an exam?]
  - Panel footer: "Sent to {provider}: this passage and {n} related passages."
- **🃏 Flashcard:** a pre-filled front ("What is *reserva mental*?") and back from the selection, plus [✦ Improve with AI]. The card lands in "My cards · TGDC".
- **⧉ Copy with source** copies `"…text…" — TGDC, Lecture 6, 41:12` or `— Código Civil.pdf, p. 52`. Students paste quotes into essays, so this matters.
- **Lecture-level AI tools** (Lecture view → AI tab), each result saved as a note, cited, and regenerable:
  - **Summary**: 5–10 bullets with timestamps
  - **Chapters**: titles on the timeline
  - **Key terms**: a glossary with the definition as the lecturer gave it, plus a timestamp. A class-wide glossary merges these.
  - **Flashcards**: a suggested list, each accepted one by one with ✓ / ✗ / edit. Never auto-add 40 cards (the Anki lesson).
  - **Exam hints**: exam-radar matches plus "questions the lecturer might ask"
  - **Fix names and terms**: proposes corrections for misheard proper nouns and terms (shown as tracked changes)

### 4.11 Search everything

- Ctrl/⌘+K from anywhere. Placeholder: "Search your classes, or type a command…"
- Results appear as you type, under 50 ms for ~1,000 documents with a local index. They are grouped with counts: "Lectures (12) · Documents (5) · Notes (2) · Exams (1) · Chat (4)".
  - Lecture hit: `⚖️ Lecture 6 · 41:12 ▶  "…o erro sobre o **objeto** do negócio…"`. Enter plays from there, Shift+Enter opens the lecture.
  - Document hit: `⚖️ Código Civil.pdf · p. 52  "…Artigo 251.º (Erro sobre a pessoa ou sobre o **objeto** do negócio)…"`
- Scope chip: "In TGDC" ⇄ "All classes" (Tab toggles).
- Last row: "✦ **Ask AI** “erro sobre o objeto” in TGDC". Enter here opens the Ask tab with the query.
- Commands: "Record lecture", "New class", "Add exam", "Practise", "Go to Settings › AI"…
- Empty query shows recent items and recent searches (private).

---

## 5. Feature prioritisation

### 5.1 MVP: must ship in 0.1

| Area | Feature | Rationale |
|---|---|---|
| Onboarding | Name, language, optional AI key with live test and free-quota readout, nothing else | Everything else is just-in-time. Notion's lesson: no setup tax. |
| Classes | Create (name, short name, colour, emoji suggestion, language), list, archive, leave | The unit of everything. |
| Documents | Drag and drop; PDF/DOCX/PPTX text; viewer with page anchors; duplicate detection; private/shared | Citations need page anchors from day one. |
| Lectures | Record in-room or online, consent dialog, markers 1–4, timestamped quick notes, recording bar, crash recovery, import audio/video | Core promise. Markers and notes are cheap and loved (Notability, Glean). |
| Transcription | Local whisper downloaded on demand (Fast/Best), group claim with status, volunteer setting, OpenRouter audio as an option | User requirement. The claim protocol *is* the group feature. |
| Transcript player | Click-to-seek, follow-along, speed 0.5–3×, edit text, search inside | Makes transcripts usable. |
| Notes | Markdown notes, "My notes" 🔒 vs "Class notes" 👥, insert timestamp link | Basic, and the private/shared split is a trust feature. |
| Exams | Coming up (date, countdown); exam papers: extract → **review** → cited answers → mark → simple 2-button practice; try-first default | The headline AI feature. The review step is required (§8.4). |
| AI | Ask tab per class (cited); Explain this passage; lecture Summary and Key terms; privacy level setting; fallback models; OpenAI-compatible custom URL (advanced) | The custom URL is cheap and covers under-18s and privacy purists (local Ollama or LM Studio). |
| Group | Invite link + QR + code + file; join preview; accept/decline with check words; members with device sync status; presence (online, recording, transcribing) | "Simple to set up" is a hard user requirement. |
| Chat | Text, mentions, replies, attachments → Documents, pins strip, @AI with citations | Replaces the WhatsApp group *for this class*. |
| Search | Ctrl/⌘+K local full-text, accent-insensitive, grouped results, "Ask AI" row | Search must work with no AI and offline. |
| Settings | Profile, language (EN/PT-PT/ES), theme, AI, transcription, sharing, notifications, privacy, storage | |
| Privacy | "What leaves this computer" page (Trama format), consent records, delete-audio-after option | Trust is the brand. |
| Accessibility | Keyboard everything, screen-reader labels, AA contrast, reduced motion, text size, reading-font option | Cheaper to build in than retrofit. |

### 5.2 v1.1: the next 2–3 months

| Feature | Rationale |
|---|---|
| **Flashcards + FSRS scheduling** (ts-fsrs), "Practice due" on Today, daily cap, Anki TSV export | Retention is where students win grades. Needs the MVP's card sources first. |
| **Timetable**: weekly slots per class, "Next class" on Today, "TGDC starts in 5 min — record it?" notification | Turns recording into a habit. Moderate effort (recurrence, holidays). |
| **Live captions while recording** (whisper streaming on capable machines) | A big accessibility win for hard-of-hearing students (one of Otter's university uses). CPU-heavy, so opt-in. |
| **Shared markers heat** ("🎯 ×5 class") and shared comment threads | Social signal without a feed. |
| **Law mode**: auto-detect article references in transcripts and documents, link them to the article in the student's own code PDF, and add an "Articles" side index per class | Law students were the user's example. The regex is ready (§9.3). |
| **Class check on AI answers** (aggregate right/wrong marks) | Crowd-checks hallucinations. Needs care about private marks becoming visible. Opt-in. |
| **Slide capture** for online lectures (screenshot on screen change, aligned to the timeline) | Otter's slide capture is loved. Needs screen-capture permissions per OS. |
| **Study plan to exam date** (spread the due questions over the remaining days) | Natural once the countdown and FSRS exist. |
| **Message delivery detail** ("delivered to 7 of 12") | Nice once the sync layer is stable. |
| **Scan an invite with the webcam** | Makes in-room QR joining one step. |
| **"Skip silences"** in playback, chapters on the timeline | Polish. |
| **Private sync between your own computers** (an unshared Syncthing folder) | Users with laptop plus desktop will ask. |
| Local OCR for scanned PDFs (tesseract via Rust, or the platform OCR APIs) | Removes the need to send scans to AI. |

### 5.3 Later

| Feature | Rationale |
|---|---|
| Mobile companion (Tauri mobile; meanwhile, plain files make Syncthing-Fork on Android a viewer) | Students live on phones, but desktop recording and transcription come first. Plain files buy time. |
| Handwriting/pen notes synced to audio (Notability-style) | Tablet-first. Large effort. |
| Semantic search (embeddings) | Local BM25 plus AI query expansion is good enough first. |
| Read-only "course library" folders published by a lecturer or class rep (Syncthing send-only) | Mirrors OneNote's Content Library. Needs lecturer adoption. |
| Moodle import (Moodle web services token → course files) | High value at PT universities, which mostly run Moodle. Auth varies per institution. |
| "Always-on class backup" device (Syncthing untrusted/encrypted receiver, e.g. a Raspberry Pi) | Solves "nobody online" for big classes. Power-user feature. |
| Audio overviews / podcast of a lecture (TTS) | NotebookLM's viral feature, but costly and "superficial" per reviews. |
| Calendar export (ICS) of exams; import of a university timetable | |
| Quiz battles / class leaderboard | Gamification risks noise. Only if students ask for it. |

### 5.4 Delightful touches (cheap, memorable; mostly MVP-compatible)

1. **Lecture timeline** with waveform, marker emoji, AI chapters and the class's 🎯 heat.
2. **Exam radar:** "isto sai no exame" / "esto entra en el examen" / "this will be on the exam" auto-marked 🎯 (§9.3).
3. **"Explain this passage"** with Simpler / Example / In Portuguese chips.
4. **Exam countdown** chips in the class header and on Today ("in 9 days"), with the practice count beside it.
5. **Per-class colour and emoji** everywhere: rail, chips, citation chips, notifications.
6. **Offline-first indicators:** a ⟳ on items still arriving, "Only on this computer" on unshared items, and a sync pill that never blocks.
7. **Sync status per member:** "● Ana — up to date · ◐ Bruno — syncing 45% · ○ Carla — last seen 3 days ago".
8. **"Bruno is already recording this lecture"**, which avoids duplicate recordings.
9. **👏 Thank the transcriber.**
10. **Copy with source** (quote plus lecture timestamp or page).
11. **Duplicate file detection** ("Ana already added this").
12. **Suggested emoji** from the class name.
13. **Gentle silence warning** while recording.
14. **Free-quota readout:** "{remaining} free AI requests left today".
15. **"Since you were away"** digest when opening a class after more than 3 days: new lectures, pins, exam changes, unread mentions.
16. **Localised academic calendar words** (frequência, época de recurso, convocatoria extraordinaria) and grading scales (0–20 valores, 0–10).

---

## 6. Privacy and ethics

### 6.1 Recording consent (legal context the UI must respect, not legal advice)

- **Portugal: Código Penal, art. 199.º "Gravações e fotografias ilícitas"**, n.º 1 ([PGDL consolidated text](https://www.pgdlisboa.pt/leis/lei_mostra_articulado.php?artigo_id=109A0199&nid=109&tabela=leis&pagina=1&ficha=1&so_miolo=&nversao=)):
  - "Quem sem consentimento: a) Gravar palavras proferidas por outra pessoa e não destinadas ao público, mesmo que lhe sejam dirigidas; ou b) Utilizar ou permitir que se utilizem as gravações referidas na alínea anterior, **mesmo que licitamente produzidas**"
  - Penalty: prison up to 1 year or a fine up to 240 days.
  - N.º 3 applies arts. 197.º–198.º. Art. 198.º makes it a crime that needs a complaint, *procedimento dependente de queixa*.
  - **Consequence for Tramado:** consent to *record* and consent to *share/use* are distinct. Hence the two checkboxes and the "Transcript only / Nothing yet" options.
- **Copyright:** lectures are protected works in both countries. PT CDADC art. 2.º n.º 1 b) lists "conferências, lições, alocuções e sermões". ES TRLPI art. 10.1 a) lists "explicaciones de cátedra". Sharing beyond the class could infringe. Hence the "for this class only" acknowledgement on join.
- **Universities' own rules** often require permission from the lecturer. Brazilian examples (UFC 2026, UFGD 2020) explicitly forbid recording without prior authorisation. No Portuguese faculty regulation was found in this search, so tell students to check theirs.
- **Classmates' voices** are recorded too. Reuse Trama's honest framing (`/home/feiteira/Trama/docs/manual/en/11-classes.md#permission`): "Your classmates are recorded too when they ask questions."

**Consent UX rules:**
1. Ask every time, unless "Remember for this class" was ticked by someone who confirmed the lecturer's permission. Record who and when in `class.json`.
2. Show the class's consent record to everyone under Members → **Recording permissions**: "Recording: allowed · Sharing in this group: allowed · confirmed by Ana Ribeiro on 14 Oct 2026". Any member can [Report a problem]. Organisers can [Withdraw permission], which stops new recordings being shared and offers to delete existing audio for everyone.
3. Online mode: "Say at the start that you are recording" (Trama's `consentHint`).
4. Never auto-record. The timetable reminder (v1.1) *asks*.
5. **Delete audio after checking.** Trama's advice "Once you have checked a transcript, you can remove its recording" becomes a per-lecture action plus an optional class policy ("Delete recordings 30 days after transcription").

### 6.2 What is shared and what is private

| Item | Default | Can change? | Notes |
|---|---|---|---|
| Lecture **recording** (audio) | Per the recording dialog's choice: shared only with sharing consent | Yes, per lecture | "Transcript only" keeps the audio local. |
| **Transcript** | Shared, if the lecture is shared | Yes | Edits by anyone sync, with an attribution history. |
| Markers you drop | 🔒 Private (MVP); "share my markers" opt-in in v1.1 | Yes | Heat map in v1.1 uses only opted-in markers. |
| **Documents** | 👥 Shared (in a shared class) | "Keep private" per file | Moves the file to private storage. |
| **Notes** | 🔒 "My notes" by default | "Move to Class notes" | Two clearly separated sections. Never a silent toggle. |
| Highlights | 🔒 Private | No (comments can be shared) | |
| Comments | 🔒 Private | 👥 per comment | |
| **Exam papers and questions** | 👥 Shared | "Keep private" per paper | |
| AI answers to exam questions | 👥 Shared (saves classmates' quota; attributed to the model and the asker) | Yes | Label: "AI answer · Gemma 4 31B · requested by Ana". |
| Your answers and marks (right/wrong) | 🔒 Private | Opt-in "Class check" (v1.1) | |
| Practice / FSRS state | 🔒 Always private | No | |
| Ask-tab conversations | 🔒 Private | "Post to class chat" per answer | |
| Chat | 👥 Class members | — | |
| Your name and device names | 👥 Class members | — | Never a phone number or email. |
| OpenRouter key | 🔐 OS keychain, this computer only | — | Never synced, never sent to classmates. OpenRouter ToS §3.2: you're responsible for all use of your key. |

### 6.3 AI data leaving the device

- **What is sent, per action** (the "What leaves this computer" table, as in Trama):
  - Ask / @AI / Explain: the question plus the top-k retrieved passages, with their document names and timestamps.
  - Exam extraction: the exam text, or page images for scans.
  - Exam answering: one question plus the retrieved passages.
  - Summary / key terms: the lecture transcript, in chunks.
  - Cloud transcription: the audio, in chunks.
  - Never sent: whole folders, private notes (unless the student filters Ask to include "My notes"), chat history, other classes.
- **Where it goes:**
  - OpenRouter (US), then the provider that serves the model. Per `GET /api/v1/providers`: Google AI Studio (HQ US), Nvidia (US datacenters), and so on.
  - Microcopy in Settings: "Requests go to OpenRouter (USA) and then to the model's provider, often also in the USA."
  - OpenRouter does not log prompts by default ("Prompt and completion are not logged by default"). Logging is opt-in for a 1% discount. Providers have their own policies.
- **Free models may train:** OpenRouter has *separate account settings* for paid and free models, and providers that "may train" exist among free ones (NVIDIA). Tested today (§8.1):
  - `provider.data_collection: "deny"` blocks all NVIDIA free models with 404 "No endpoints found matching your data policy (Free model training)".
  - It still reaches both Gemma 4 free endpoints (Google AI Studio), dots-3-note-preview (AtlasCloud) and north-mini-code (Cohere).
- **Recommended privacy levels** (Settings → AI → "What providers may do with what you send"):
  1. **Strict — keep nothing** (`provider.zdr: true`). Microcopy: "Only providers that keep nothing of what they're sent. Most free models are excluded, so you'll usually need a paid model." Tested: blocks every free model tried, except one that was rate-limited. This is Trama's current policy (`/home/feiteira/Trama/PRIVACY.md`: "Trama only asks for providers that keep nothing… (Zero Data Retention) and do not train on it").
  2. **No training (default)** (`provider.data_collection: "deny"`). Microcopy: "Providers may keep requests for a short time (for example, to check for abuse) but won't train AI on them. Works with the default free model."
  3. **Allow free models that may train** (`"allow"`). Warning microcopy: "Some free models are free because the provider may use what you send to improve their AI. Don't use this for anything personal: recordings of people, your own writing you want to keep private, or sensitive topics." This needs an explicit confirmation.
- **Under-18s:** OpenRouter's terms (updated 31 Aug 2026) say "You must be at least 18 years of age to use the Service". The minimum rose from 13 to 18. Tramado must:
  - not *require* AI;
  - state the age rule where the key is entered;
  - offer the **custom OpenAI-compatible endpoint** (local Ollama or LM Studio, or a school-provided server) as the route for minors.
  
  GDPR digital-consent ages (13 in PT per Lei 58/2019 art. 16; 14 in ES per LOPDGDD art. 7) matter less because Tramado itself runs no service. The peer-to-peer class group is between the students' own devices.
- **Per-request transparency:** every AI result shows "✦ {model} via OpenRouter · {n} passages sent" with a [See what was sent] disclosure listing the passages. There is also a local, private **AI activity log** (Settings → Privacy) with time, action, model and passage count. That is Trama's audit-trail idea, slimmed down.

### 6.4 Academic integrity

- Exams are framed as **past papers and practice**. A one-time note appears on each exam paper (§4.8.9).
- Try-first is on by default (P3). The setting is remembered per student, and turning it off is allowed (respect autonomy).
- AI answers are always labelled as AI, with the model name, and never mixed into "Your answer" text.
- Chat @AI answers carry the model and the asker, so the class can judge them.

### 6.5 GDPR-friendly defaults (summary)

| Default | Value |
|---|---|
| Account, telemetry, analytics, crash reports | None. Also set Syncthing `options.urAccepted = -1` (usage reporting declined) and `options.crashReportingEnabled = false` when Tramado configures it. |
| Network before sharing or AI | None. Syncthing starts only when a class is shared or joined. Disclose that Syncthing then contacts its **global discovery** and **relay** servers (device ID and IP address; contents are encrypted end to end between devices). Offer "Local network only" for privacy purists. Note that eduroam often isolates clients, so it may not work there. |
| AI | Off until a key is entered. "No training" level by default. Only the passages needed are sent. |
| Recording | Explicit consent each time or a remembered class record. Sharing is a separate consent. Option to delete audio after transcription. |
| Leaving a class | "Leave class: stop syncing. Your copy stays on this computer unless you delete it. What you added stays with your classmates. Remove it before leaving if you want it gone (removals sync)." |
| Removing a member | "{name} stops receiving updates. They keep what was already on their computer." |
| Data portability | Everything is plain files in `~/Tramado`, readable without Tramado. |
| Key storage | OS keychain, never in synced folders. |

---

## 7. Empty states, error states, accessibility

### 7.1 Empty states (each with one primary action)

| Where | Title | Body | Action |
|---|---|---|---|
| Today, first run | "Welcome, {first name}." | Checklist: ☐ Create or join a class · ☐ Record or import a lecture · ☐ Add a document · ☐ Add an exam date (each ticks itself when done) | [Create a class] [Join a class] |
| Today, nothing due | "All clear for today." | "No exams in the next 2 weeks and nothing to practise." | [Practise anyway] |
| Class list | "No classes yet." | "A class holds one subject's lectures, documents, exams and notes, and can be shared with classmates." | [Create a class] [Join with an invite] |
| Lectures | "No lectures yet." | "Record the next one, or add a recording you already have (an audio or video file)." | [● Record lecture] [Add a recording] |
| Documents | "Drop slides, readings and legislation here." | "PDF, Word, PowerPoint, text and images. Tramado reads them so you can search and ask about them." | [Add documents] |
| Notes | "Your notes for {class}." | "My notes are only on this computer. Class notes are shared with everyone in the class." | [New note] [New class note] |
| Exams | "No exams yet." | "Add the date of your next test to get a countdown, or add a past exam and practise it, with AI answers that point to your lectures." | [Add an exam date] [Add an exam paper] |
| Ask (AI on) | "Ask anything about {class}." | Suggested prompts from content: "Summarise Lecture 6", "What is *reserva mental*?", "Which articles did the lecturer cite most?" | input |
| Ask (AI off) | "Ask your classes with AI." | "Set up OpenRouter with your own key (free models work), or a local AI service. Search works without AI." | [Set up AI] [Search instead] |
| Chat (shared, alone) | "Just you so far." | "Invite classmates to chat, share documents and split the transcription work." | [Invite classmates] |
| Chat (unshared) | "This class is only on this computer." | "Share it to get a class chat, shared documents and transcripts." | [Share this class] |
| Members | "Only you." | "Send an invite in your class group. It takes classmates a minute to join." | [Invite] |
| Search, no results | "Nothing found for “{q}”." | "Try fewer words, or search all classes." | [Search all classes] [✦ Ask AI] |
| Practice, nothing due | "Nothing due right now." | "Next review: {when}. You can still practise any paper." | [Practise a paper] |

### 7.2 Error states (problem → microcopy → recovery)

**Sharing (Syncthing)**

| Situation | Microcopy | Recovery |
|---|---|---|
| Embedded Syncthing failed to start | "Sharing isn't running, so your classes aren't syncing. Everything still works on this computer." | [Try again] [Details] (log tail; port in use? → "Another program is using port {p}. Tramado will use a different one." automatically) |
| Existing Syncthing found (user runs their own) | "Syncthing is already running on this computer. Use it for Tramado's classes too? Your existing folders won't be touched." | [Use it] [Use Tramado's own] |
| REST API unreachable or wrong API key | "Tramado can't talk to Syncthing. {reason}." | [Reconnect] [Restart sharing] |
| No peers online | Sync pill: "Waiting for classmates" + tooltip "No one from your classes is online. Changes are saved and will sync later." | none needed |
| A member offline for long | Members: "○ Carla — last seen 12 days ago" | [Remove from class…] (organisers) |
| Sync conflict (`*.sync-conflict-*` files) | On the item: "Two versions of “Class notes — Week 3” were edited at the same time. Both are kept." | [Compare] [Keep this one] [Keep the other] [Keep both] |
| Disk almost full | "Your disk is almost full ({free} left). New recordings and classmates' files may not fit." | [Clean up recordings…] [Skip audio in some classes] |
| Folder moved or deleted outside Tramado | "Tramado can't find the folder for {class}. Was it moved or deleted?" | [Find it…] [Get a fresh copy from classmates] [Remove from Tramado] |
| Invite invalid or expired | "This invite didn't work: {reason}. Ask {inviter} for a new one." | [Paste another] |
| Joiner waiting, nobody online | "No one from {class} is online right now. You'll join as soon as someone opens Tramado." | — |

**AI (OpenRouter)**: classify by `error.code`, `error.message` and `error.metadata` (shapes tested today, §8.2).

| Situation | Detect | Microcopy | Recovery |
|---|---|---|---|
| No key | — | "AI isn't set up yet." | [Set up AI] |
| Invalid key | 401 | "OpenRouter didn't accept your key. It may have been deleted or mistyped." | [Update key] |
| Out of credits (paid models) | 402 | "Your OpenRouter account has no credit left for {model}. Free models still work." | [Use the free model] [Add credit ↗] |
| **Free model busy upstream** | 429 with `metadata.limit_source == "upstream_provider_shared_pool"` or `raw` containing "rate-limited upstream" | "The free model is busy right now. This happens often with free models, and it's not your fault." | Auto: Tramado has already tried the fallbacks; show which. Buttons: [Try again in {retry_after}s] (countdown from `Retry-After` when present), [Use {next fallback}], [Change model] |
| Your free daily quota used | 429 with `metadata.error_type == "rate_limit_exceeded"`, `free_model_daily_requests.remaining == 0` | "You've used today's {limit} free AI requests. They reset at {local time of 00:00 UTC}." + "Accounts that have bought at least 10 credits get 1000 free requests a day." | [OK] [Use a paid model] |
| Per-minute limit (20/min) | 429 platform with `X-RateLimit-*` | "Too many requests in a minute. Continuing in {s}s…" | auto-queue with countdown (exam answering, batch summaries) |
| No endpoint under your privacy level | 404 "No endpoints found matching your data policy (…)" | "{model} isn't available at your privacy level (“{level}”)." | [Choose another model] [Change privacy level…] |
| Model needs a special client | 403 "only available on agentic harnesses" (seen today for `thinkingmachines/inkling*:free`) | "{model} can't be used from Tramado." | Hide these models in the picker. |
| Provider down | 502/503 | "The model's provider is having problems." | auto-fallback; [Try again] |
| Mid-stream error | SSE chunk with `finish_reason: "error"` | Keep the partial text, greyed: "The answer was cut off." | [Continue] [Try again] |
| Empty content (reasoning ate the budget) | `content` empty/whitespace, `finish_reason: "length"` | (silent) retry once with a larger `max_tokens` or `reasoning: {effort:"low"}`, then: "The model didn't produce an answer. Try again or choose another model." | [Try again] |
| Context too long | 400/413 | "That's more text than {model} can read at once. Tramado will use fewer passages." | auto-retry with smaller top-k |
| Offline | fetch fails | "You're offline. AI needs the internet. Search and everything else still work." | [Try again] |
| Response trimming | content starts with `\n\n` (seen today with dots-3) | trim before rendering | — |

**Recording and transcription**

| Situation | Microcopy | Recovery |
|---|---|---|
| Mic permission denied (macOS/Windows) | "Tramado isn't allowed to use the microphone. Allow it in {System Settings › Privacy › Microphone}, then try again." | [Open settings] |
| No input device | Trama's `speech.record.noDevice` | — |
| System audio unavailable (online mode) | "Tramado can't record your computer's sound on this system: {reason}. You can still record your microphone (in-room mode)." | [Record mic only] |
| Model download failed / checksum mismatch | "The speech model didn't download correctly. Nothing was installed." | [Try again] [Use OpenRouter] [Let a classmate transcribe] |
| CPU lacks AVX2 | Trama's `UNSUPPORTED_CPU` + "A classmate's computer or OpenRouter can transcribe it instead." | [Ask the class] [Use OpenRouter] |
| Not enough disk for the model | "The speech model needs {size} free. You have {free}." | [Use the Fast model ({190 MB})] [Clean up] |
| Claim stale | see §4.6 | [Take over] |
| Recording interrupted | see §4.5 | [Keep] [Delete] |

### 7.3 Accessibility checklist (target WCAG 2.2 AA)

- **Keyboard:** everything is reachable and operable. Shortcuts are listed in a "?" overlay. Recording markers 1–4 and N work without moving focus from where you are. Practice uses Space/1–4/←→ (Trama parity).
- **Screen readers:**
  - The recording bar is a `role="region"` with a label. Recording state changes are announced once ("Recording started", "Paused", "Saved").
  - Do **not** announce every timer second. Transcription progress is announced politely every 10% at most.
  - Citation chips have full labels: "Source 2: Código Civil, page 52, article 251".
  - Timeline markers are a list too, not only graphics.
- **Captions and transcripts:** the transcript *is* the accessible alternative to audio. Live captions are v1.1. Keep transcript text selectable and resizable.
- **Playback:** 0.5–3× with pitch preserved (Glean users raise pitch to follow voices; offer a ±3 semitone pitch control later).
- **Colour:** class colour plus emoji plus name, never colour alone. Highlights have names. Use Trama's `ensureContrast` for 3:1 non-text contrast (WCAG 1.4.11) and AA 4.5:1 text tokens (Trama's `tokens.test.ts` already enforces this).
- **Target size** ≥ 24×24 px (WCAG 2.5.8). Visible focus rings (Trama's `--focus` token).
- **Reading fonts:** Atkinson Hyperlegible Next (`@fontsource-variable/atkinson-hyperlegible-next@5.3.0`, OFL-1.1) and OpenDyslexic (`@fontsource/opendyslexic@5.3.0`, OFL-1.1) as options. Text size 87–150%.
- **Motion:** honour `prefers-reduced-motion`, which disables follow-along auto-scroll animation and makes it jump instead.
- **Cognitive load:** one primary action per screen, progressive disclosure for advanced options, consistent tab order across classes (P1).
- **Language:** set `lang` on the root and on transcript blocks in another language (e.g. an English lecture inside a PT UI) so screen readers switch voices.
- The European Accessibility Act (applies since June 2025) targets commercial products. A free open-source app isn't obviously in scope, but AA is the right bar anyway.

---

## 8. Tested today: OpenRouter facts that shape the UX

All tests used the user's key (never printed), from `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/product-ux/`.

### 8.1 Free models (14 listed by `GET /api/v1/models` today) vs privacy levels

| Model | Input modalities | `data_collection:"deny"` | `zdr:true` |
|---|---|---|---|
| `google/gemma-4-31b-it:free` (requested default) | text, image, video | ✅ passes routing (then 429 upstream) | ❌ 404 |
| `google/gemma-4-26b-a4b-it:free` | text, image, video | ✅ passes (429 upstream) | — |
| `dots-studio/dots-3-note-preview:free` | text, image | ✅ **OK via AtlasCloud** | ❌ 404 |
| `cohere/north-mini-code:free` | text | ✅ OK via Cohere (code model) | ❌ 404 |
| `recursive/flint-v1.0:free` | text | ✅ passes (503) | — |
| `xingchen-agi/xing4.0-29b-a4b:free` | text | ✅ passes (429) | ✅ passes (429) |
| `nvidia/nemotron-3.5-super-vl:free` (known working fallback) | text, image, video | ❌ 404 "Free model training" | — |
| `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (audio in) | | ❌ 404 | — |
| `liquid/lfm-2.5-2.6b:free` | text | ❌ 404 | — |
| `thinkingmachines/inkling(-small):free` (audio in) | text, image, audio | 403 "only available on agentic harnesses" | — |

**Product consequence:** the default "No training" level plus the fallback chain below keeps the user's requested default and still answers when Gemma is rate-limited. The "Allow training" level is what unlocks the NVIDIA fallback that worked earlier in this project. The per-endpoint training flag is **not** in the public `/models/{id}/endpoints` JSON today: its keys are name, pricing, provider_name, supported_parameters, status, uptime… with no data-policy field. So probe with the request flag rather than predicting from metadata.

### 8.2 Snippets worth copying

Privacy-safe default request (tested: answered via dots-3-note-preview while both Gemmas were 429):

```json
{
  "models": ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
  "provider": { "data_collection": "deny" },
  "max_tokens": 1200,
  "messages": [
    {"role": "system", "content": "You are a study assistant. Answer ONLY from the numbered sources. Cite like [S1]. If the sources do not contain the answer, say so. Reply in European Portuguese."},
    {"role": "user", "content": "Sources:\n[S1] Código Civil, artigo 122.º — …\n[S2] Código Civil, artigo 130.º — …\n[S3] Transcrição Aula 3 (00:41:12) — …\n\nQuestion: Com que idade se adquire plena capacidade de exercício em Portugal?"}
  ]
}
```

Response: `model = dots-studio/dots-3-note-preview:free`, `provider = AtlasCloud`, 633 tokens, content `"\n\nA plena capacidade de exercício de direitos em Portugal é adquirida aos dezoito anos de idade, conforme estabelecido no artigo 130.º do Código Civil [S2]."`. The UI should show "answered by the fallback model" because `model` ≠ the requested default.

Free quota for the readout (tested): `GET https://openrouter.ai/api/v1/key` →

```json
{"data": {"is_free_tier": "<redacted>", "limit": "<redacted>", "limit_remaining": "<redacted>", "usage": "<redacted>",
          "free_model_daily_requests": {"used": "<redacted>", "limit": "<redacted>", "remaining": "<redacted>"}}}
```

Documented limits: 20 req/min for `:free`; 50/day if under 10 credits purchased, 1000/day otherwise. The day is UTC. `rate_limit` in this response is deprecated.

Upstream 429 shape (tested):

```json
{"error": {"message": "Provider returned error", "code": 429, "metadata": {
  "raw": "google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own provider key…",
  "provider_name": "Google AI Studio", "is_byok": false, "provider_error_code": "429",
  "limit_source": "upstream_provider_shared_pool",
  "remedy_hint": "Retry shortly, add your own provider key to use your own limits (…), or route to another provider…"}}}
```

Data-policy 404 shape (tested):

```json
{"error": {"message": "No endpoints found matching your data policy (Free model training). Configure: https://openrouter.ai/settings/privacy",
  "code": 404, "metadata": {"routing_funnel": [{"step": "Initial Endpoints", "endpoint_count": 1}], "failed_routing_step": "Filter by Data Policy"}}}
```

Error classifier sketch (TypeScript):

```ts
type AiProblem =
  | 'NO_KEY' | 'BAD_KEY' | 'NO_CREDIT' | 'FREE_BUSY' | 'DAILY_QUOTA' | 'PER_MINUTE'
  | 'PRIVACY_BLOCKED' | 'UNSUPPORTED_MODEL' | 'PROVIDER_DOWN' | 'TOO_LONG' | 'OFFLINE' | 'OTHER';

export function classify(status: number, body: any, headers: Headers): AiProblem {
  const e = body?.error ?? {};
  const md = e.metadata ?? {};
  const msg: string = `${e.message ?? ''} ${md.raw ?? ''}`;
  if (status === 401) return 'BAD_KEY';
  if (status === 402) return 'NO_CREDIT';
  if (status === 403 && /agentic harness/i.test(msg)) return 'UNSUPPORTED_MODEL';
  if (status === 404 && /data policy/i.test(msg)) return 'PRIVACY_BLOCKED';
  if (status === 429) {
    if (md.limit_source === 'upstream_provider_shared_pool' || /rate-limited upstream/i.test(msg)) return 'FREE_BUSY';
    if (headers.get('X-RateLimit-Remaining') === '0' && /per.?min/i.test(msg)) return 'PER_MINUTE';
    return 'DAILY_QUOTA'; // confirm with GET /api/v1/key → free_model_daily_requests.remaining === 0
  }
  if (status === 400 || status === 413) return /context|too long|tokens/i.test(msg) ? 'TOO_LONG' : 'OTHER';
  if (status >= 500) return 'PROVIDER_DOWN';
  return 'OTHER';
}
```

### 8.3 Privacy-level mapping

```ts
const PRIVACY = {
  strict:   { zdr: true, data_collection: 'deny' },   // "Keep nothing" — paid models in practice
  standard: { data_collection: 'deny' },              // DEFAULT — "No training"
  open:     { data_collection: 'allow' },             // "Allow free models that may train" (warn)
} as const;
// request.provider = PRIVACY[level]
```

### 8.4 Exam extraction quality (why the review step is mandatory)

The test used a Portuguese law exam excerpt with 3 groups, sub-questions a/b/c, points and "+2 de redação". Request: strict JSON schema (`response_format: {type:"json_schema", json_schema:{strict:true,…}}`), `provider: {data_collection:"deny", require_parameters:true}`, and the same 3-model fallback. The answer came from dots-3-note-preview:
- It returned valid JSON with the title, date, rules and points 8/6/4.
- **But** every `kind` was `"multiple_choice"`, although the questions were a case, a choose-2 short-answer group and a comment.
- It did **not** split II.a/b/c.
- It dropped the "+ 2 de redação".

UX conclusion:
1. Always show the review screen.
2. Pre-split with simple deterministic heuristics before or after the model: Roman numerals or digits at line start, `a)`/`b)` sub-items, `(\d+(,\d+)? valores|points|puntos)`, and "Responda a duas" / "Answer two of" → choose-N.
3. Don't trust `kind` blindly. Default it to "Other" when uncertain.

---

## 9. Localisation notes (PT-PT, ES, EN)

### 9.1 Academic vocabulary in catalogs

- PT-PT: "aula", "disciplina", "docente/professor(a)", "frequência", "teste", "exame de época normal / de recurso / especial", "melhoria de nota", "valores", "sumário" (the official summary of each lecture: "Ver sumário" is a nice label for the AI summary), "hipótese prática", "pergunta teórica", "consulta de legislação não anotada".
- ES: "clase", "asignatura", "profesor/a", "parcial", "final", "convocatoria ordinaria/extraordinaria", "supuesto práctico" (the law case question), "temario", "apuntes".
- EN: "lecture", "class", "midterm", "final", "past paper", "problem question" (UK law), "issue–rule–application–conclusion (IRAC)".
- The case-answer template headings per language: EN "Issue → Rule → Application → Conclusion". PT "Questão → Normas aplicáveis → Aplicação → Conclusão". ES "Cuestión → Normas aplicables → Aplicación → Conclusión".

### 9.2 Grading scales and dates

- PT 0–20 (pass 9.5, shown with a comma decimal: "14,5 valores"). ES 0–10 ("7,5"). EN % or points. Use `Intl.NumberFormat` and `Intl.DateTimeFormat`. Trama uses luxon 3.7.2.
- Week numbering and "Week 8 of the semester" need a term start date (optional, in the class settings).

### 9.3 Law-article detection and exam radar (tested in Node 22: `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/product-ux/js/regex2.mjs`)

Run only the regex for the lecture's or document's language, because "art. 24" matches in all three.

```ts
// PT: "art. 122.º do CC", "artigo 125.º, n.º 1, alínea a)", "arts. 240.º a 243.º do Código Civil", "art. 13.º da CRP", "artigo 483.º-A do CC"
const PT_ARTICLE = /\bart(?:igo)?s?\.?\s*(\d{1,4})(?:\.?\s*[º°o])?(?:-([A-Z]))?(?:\s*(?:a|e|-)\s*(\d{1,4})(?:\.?\s*[º°o])?)?(?:\s*,?\s*n\.?\s*[º°o]\.?\s*(\d{1,3}))?(?:\s*,?\s*al(?:[íi]nea)?\.?\s*([a-z])\))?(?:\s+(?:do|da)\s+(CC|CP|CPC|CPP|CRP|CT|CSC|CPA|CPTA|CIRE|RGPD|C[óo]digo\s+(?:Civil|Penal|do\s+Trabalho|de\s+Processo\s+(?:Civil|Penal)|das\s+Sociedades\s+Comerciais)|Constitui[çc][ãa]o))?/gu;
// ES: "artículo 1902 del Código Civil", "art. 24.2 CE", "art. 10 bis de la LEC"
const ES_ARTICLE = /\bart(?:[íi]culo)?s?\.?\s*(\d{1,4})(?:\.(\d{1,3}))?(?:\s*(bis|ter|quater))?(?:\s+(?:(?:del?|de\s+la)\s+)?(CC|CE|CP|LEC|LECrim|ET|LOPDGDD|C[óo]digo\s+(?:Civil|Penal)|Constituci[óo]n(?:\s+Espa[ñn]ola)?))?/gu;
// EN: "section 3(1) of the Human Rights Act 1998", "Article 8 ECHR"
const EN_ARTICLE = /\b(?:[Ss](?:ection)?\.?|[Aa]rt(?:icle)?\.?)\s*(\d{1,4}[A-Z]?)(?:\((\d{1,3})\))?(?:\s+(?:of\s+the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+Act(?:\s+\d{4})?|ECHR|TFEU|TEU|GDPR))?/g;
```

All 10 samples were matched with correct groups, including the ranges and the `-A` suffix. Gotchas:
- Speech may produce "artigo cento e vinte e dois". Whisper usually writes digits, but spelled-out numbers need a words-to-number pass (v1.1).
- To link to the student's own code PDF, index the PDF's `Artigo N.º` headings to page numbers at import.

Exam radar runs on accent-folded, lowercase text:

```ts
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const RADAR = {
  pt: /\b(?:isto|isso|esta materia|este tema|esta parte|esta pergunta)\s+(?:\S+\s+){0,2}(?:sai|vai sair|costuma sair|pode sair|entra|vai entrar|e para)\s+(?:\S+\s+){0,3}(?:exame|teste|frequencia)\b|\b(?:importante|fundamental)\s+para\s+o\s+(?:exame|teste)\b|\bpergunta\s+de\s+exame\b|\btomem\s+nota\b/u,
  es: /\b(?:esto|esta parte|este tema|esta pregunta)\s+(?:\S+\s+){0,2}(?:entra|va a entrar|cae|suele caer|puede caer|sale|va a salir)\s+(?:\S+\s+){0,3}(?:examen|parcial|final)\b|\bpregunta\s+de\s+examen\b|\bapuntad(?:lo)?\s+esto\b|\bimportante\s+para\s+el\s+examen\b/u,
  en: /\b(?:this|that|it)\s+(?:will|is going to|might|could|may|is likely to)\s+(?:be|come up|appear|show up)\s+(?:on|in)\s+the\s+(?:exam|test|final|midterm)\b|\bexam\s+question\b|\bwrite\s+this\s+down\b|\bmake\s+sure\s+you\s+know\b/u,
};
// RADAR.pt.test(fold(paragraph)) → auto-marker 🎯 (labelled "auto", removable)
```

Tested: it matched "isto costuma sair no exame, tomem nota", "Esta matéria vai sair de certeza no teste", "Esto entra seguro en el examen" and "This will come up on the exam". It did not match "O exame foi ontem" or "El examen fue ayer".

The same `fold()` belongs in search indexing and querying, which makes it accent-insensitive.

---

## 10. Libraries relevant to these UX choices (versions checked with `npm view` today)

| Need | Package | Version | Licence | Note |
|---|---|---|---|---|
| Spaced repetition | `ts-fsrs` | 5.4.2 (stable, 2026-09-01) / 6.0.0 (2026-10-28, new `DefaultScheduler()` async API, FSRS-7) | MIT | 6.0.0 is under 2 weeks old. Start on 5.4.2 or pin 6.0.0 after 11 Nov. Save `card` and `revlog`. |
| QR codes | `qrcode` | 1.5.4 | MIT | Or `uqr` 0.1.3 (tiny, SVG). The Rust `qrcode` crate is an alternative. |
| Waveform/timeline | `wavesurfer.js` | 8.0.3 (2026-10-19) is the newest ≥ 2 weeks old; 8.0.5 is 1 day old | BSD-3 | The Regions plugin works for markers and chapters. |
| PDF viewer | `pdfjs-dist` | Trama uses 6.3.289; latest 6.5.438 | Apache-2.0 | Reuse Trama's integration. |
| DOCX | `mammoth` | 1.13.0 (same as Trama) | BSD-2 | |
| Local search | `minisearch` 7.2.0 or `flexsearch` 0.8.212 (JS), or SQLite FTS5 in Rust | — | MIT / Apache-2.0 | Apply `fold()` in the tokenizer. |
| Rich notes | `@tiptap/react` 3.32.2 | | MIT | Or plain Markdown with a light editor. Keep files as `.md`. |
| Emoji picker | `emoji-mart` 5.6.0 + `@emoji-mart/data` 1.2.1 | | MIT | Last release 2024. Or a small curated picker (~200 study-relevant emoji). |
| Accessible fonts | `@fontsource-variable/atkinson-hyperlegible-next` 5.3.0, `@fontsource/opendyslexic` 5.3.0 | | OFL-1.1 | Trama uses Instrument Sans + Literata 5.3.0. |
| Icons | `lucide-react` (Trama: 1.52.0) | | ISC | Consistent with Trama. |

---

## 11. Open questions and risks for the design phase

1. **Invite acceptance when the organiser is offline.** Recommend "any member can let people in" by default (Syncthing introducer semantics). That needs a clear member list so people can spot strangers.
2. **Big classes (100+ students) on Syncthing:** the device mesh, relays and many devices writing presence files. Consider capping presence heartbeats (e.g. every 60 s, and only while active) and advising "study groups" of 5–30 people as the sweet spot. That matches the "class group" mental model better than a whole year of students.
3. **Shared transcript edits:** last-writer-wins on `transcript.json` will cause conflicts. Prefer per-device correction overlays merged at read time, or a single "transcript owner" (the transcriber) plus suggestions.
4. **Audio sharing by default** vs storage: about 14 MB an hour as Opus is fine; WAV is not. Make "Skip audio" easy for small disks.
5. **@AI quota fairness:** the asker pays with their own quota. Shared AI answers on exam papers save classmates' quota, which is good. Avoid auto-answering on every device: the "answers exist" state syncs, so others see them.
6. **Under-18 students** can't use OpenRouter. Test the "custom endpoint" path with Ollama's OpenAI-compatible API before 0.1, so high-school users get *some* AI.
7. **Free-model volatility:** today's free list is 14 models, and the requested default is often 429. Ship the fallback list as *data*, updatable without a release (e.g. a JSON file in the GitHub repo fetched only when AI is enabled, or simply in-app editing). The ≤ 3-entry `models` limit applies.
8. **Legal copy:** the consent microcopy above is not legal advice. Have a PT/ES law student or lecturer review it. Fittingly, the target users can help.

---

## Sources

Student tools
- Otter for students: https://affine.pro/blog/otter-ai-review-for-students · https://oah.olin.edu/node/211 · https://www.capterra.com/p/202799/Otter/reviews/?page=3 · https://myengineeringbuddy.com/blog/otter-ai-reviews-alternatives-pricing-offerings/ · https://our.ric.edu/department-directory/center-disability-access/assistive-equipment-and-software/otterai-assistive-software · https://www.castmagic.io/software-review/otter-ai
- Notability / GoodNotes audio: https://laptopmag.com/reviews/apps/notability · https://www.coloradocollege.edu/offices/accessibilityresources/images/quickstartguides/Notability%20Quick%20Start%20Guide.pdf · https://feedback.goodnotes.com/forums/191274-goodnotes-ideas/suggestions/6481557-linked-audio-recording-is-a-must-please-add-audio?page=1 · https://support.goodnotes.com/hc/en-us/articles/7352688559631 · https://www.goodnotes.com/blog/audio-recording · https://subscribed.fyi/notability/reviews/
- NotebookLM: https://zaidalhuda.github.io/notebooklm-guide/NotebookLM_Comprehensive_Guide.pdf · https://www.casrai.org/guides/notebooklm-for-research-workflows · https://myclaw.ai/blog/notebooklm-ai-review
- StudyFetch: https://tldv.io/blog/studyfetch-review/ · https://www.ask-maeve.com/blog/study-fetch-reviews/
- Knowt / Quizlet: https://nibble-app.com/blog/knowt-vs-quizlet · https://fiveable.me/knowt-vs-quizlet.md · https://toolradar.com/compare/quizlet-vs-knowt · https://bmgator.org/33901/news/changes-to-quizlet-cause-frustration-among-students/ · https://campustechnology.com/articles/2017/03/09/quizlet-debuts-study-feature-that-helps-students-study-efficiently.aspx · https://fireflies.ai/blog/best-ai-notetaker-for-students
- Anki: https://nibble-app.com/blog/anki-review · https://cdn.bcm.edu/sites/default/files/2023-09/51-merlinsky-e.pdf · https://forums.ankiweb.net/t/expected-knowledge-gain-and-anki-vs-questions-dilemma/67322 · https://www.yousmle.com/?p=742
- OneNote Class Notebook: https://support.microsoft.com/en-us/education/fix-class-notebook-when-welcome-collaboration-space-or-content-library-are-missing · https://www.technology.pitt.edu/blog/classnotebooks
- Moodle / Classroom: https://www.capterra.com/compare/80691-186631/Moodle-vs-Google-Classroom · https://www.lssu.edu/wp-content/uploads/2017/05/Moodle_SummativeReport_PilotFindings.pdf · https://ojs.library.lancs.ac.uk/lue/article/download/18/22/65
- Notion for students: https://lifestack.ai/blog/notion-templates-for-college-students · https://medium.com/@explrerhere/why-your-notion-setup-always-fails-fix-this-first-ea057ec65618
- Obsidian for law: https://forum.obsidian.md/t/using-obsidian-for-law-school/27756 · https://forum.obsidian.md/t/any-lawyers-or-legal-practitioners-using-obsidian/2057 · https://www.obsidianstats.com/tags/legal-references
- WhatsApp / Discord groups: https://screenwiseapp.com/guides/discord-vs-whatsapp-for-school-projects · https://www.ruzuku.com/learn/tools/whatsapp/course-accountability · https://deltacollegian.net/2025/09/19/48006/ · https://blogs.ubc.ca/engl30198a2022s12/files/2022/07/Jo-Hempelmann-Project-Proposal.pdf · https://arcadiaquill.com/15325/opinion/discord-is-underrated
- Glean / Sonocent: https://warwick.ac.uk/services/library/using/productivity-tools/sonocent/ · https://sas.sdes.ucf.edu/wp-content/uploads/sites/22/2020/08/Comparison-Between-Glean-and-Sonocent-Audio-Notetaker.pdf · https://doit.uw.edu/publication/do-it-news-may-2018/tech-tips-sonocent/

Learning science
- Bastani et al., "Generative AI without guardrails can harm learning", PNAS 122(26) 2025, DOI 10.1073/pnas.2422633122: https://papers.ssrn.com/abstract=4895486 · https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education

Law and privacy
- Código Penal art. 199.º (consolidated): https://www.pgdlisboa.pt/leis/lei_mostra_articulado.php?artigo_id=109A0199&nid=109&tabela=leis&pagina=1&ficha=1&so_miolo=&nversao=
- Brazilian university recording rules (for comparison only): https://defisio.ufc.br/wp-content/uploads/2026/04/instrucao-normativa-defisio.pdf
- FDUL assessment regulation consultation (mentions hipóteses práticas): https://www.fd.ulisboa.pt/wp-content/uploads/2024/10/Despacho-n.o-12165_2024_15102024.pdf

OpenRouter (official docs and live API)
- Terms (18+, key confidentiality): https://openrouter.ai/terms
- Logging and privacy: https://openrouter.ai/docs/guides/privacy/logging · FAQ: https://openrouter.ai/docs/faq
- Provider routing (`data_collection`, `zdr`): https://openrouter.ai/docs/guides/routing/provider-selection
- Limits and `/api/v1/key`: https://openrouter.ai/docs/api/reference/limits
- Live: `GET /api/v1/models`, `GET /api/v1/models/{id}/endpoints`, `GET /api/v1/providers`, `GET /api/v1/key`, `POST /api/v1/chat/completions` (all called 2026-11-03)

Syncthing
- Introducer: https://docs.syncthing.net/users/introducer.html · https://forum.syncthing.net/t/how-to-fully-share-folder-among-multiple-devices/21013

Speech models
- whisper.cpp ggml sizes (Hugging Face API, 2026-11-03): https://huggingface.co/ggerganov/whisper.cpp. Measured sizes: `large-v3-turbo-q5_0` 574 MB, `large-v3-turbo-q8_0` 874 MB, `medium-q5_0` 539 MB, `small-q5_1` 190 MB, `base-q5_1` 60 MB.

Trama (read-only reference)
- `/home/feiteira/Trama/docs/manual/en/11-classes.md` (recording classes, past exams, practice)
- `/home/feiteira/Trama/app/src/core/i18n/locales/en/speech.ts`, `.../service.ts`, `.../questions.ts` (microcopy patterns, error keys)
- `/home/feiteira/Trama/app/src/ui/color.ts` (`ensureContrast`), `/home/feiteira/Trama/app/src/ui/tokens.css`
- `/home/feiteira/Trama/PRIVACY.md` ("What leaves this computer" table format)
