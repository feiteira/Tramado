# Demo example content

Everything here is **fictional** (UX spec §7, `docs/design/ux-mvp.md`): people, laws, exams and lectures are
invented, and the browser demo says so in its ribbon. The "Lei Fundamental de Exemplo" is a made-up constitution
of the made-up "República de Exemplo"; its wording copies no real constitution.

| File | What it holds |
|---|---|
| `types.ts` | `DemoClass`, `DemoMember`, `DemoLecture`, `DemoSegment`, `DemoDoc`, `DemoExam`, `DemoMessage`, `DemoNote`, … |
| `people.ts` | Members and devices (UX §7.3). Device IDs come from the memory platform's test key pool (slot 0 = this computer, slots 1–6 = classmates; the sync fake's `peerJoins` starts at slot 20) and are committed. |
| `law.ts`, `bio.ts`, `stats.ts`, `hist.ts` | The four classes: who added, recorded, transcribed, asked and wrote what, and when (Europe/Lisbon wall times). |
| `content/*.ts` | The **single source** of every fixture text: the law's 24 pages, the other documents, slides and DOCX paragraphs, the transcript key segments and the 40 filler sentences per language. Self-contained, so Node can read them directly. |
| `fill.ts` | `fillTranscript` / `buildTranscript` (deterministic filler at ~160 words a minute, pauses `(i*7919) % 1100` ms) and `demoPeaks` (UX §7.1 formula). |
| `sources.ts` | The canonical text of each page / slide / DOCX, which citations quote. |
| `time.ts` | Lisbon wall times → epoch ms, `H:MM:SS` → ms, citation time labels. |
| `example.test.ts` | Every citation quote resolves (and is unique in its source); markers within duration; exam radar only where UX §7.3 says; assets match their text; the seed's files verify (signatures, derived IDs, hashes); every UX §7.2 key and §7.4 route resolves. |

`../seed.ts` writes all of it as spec-conformant class folders, private data and app files into the memory
platform (no services). The binaries in `../assets/` are generated from `content/` by
`node tools/fixtures/build-demo-assets.mjs` (check with `--check`) and committed.

URL parameters and hooks: UX §7.2 (parsed in `../boot.ts` into `DemoFlags`; keys resolve through `DemoKeys`).
