# Tramado Class Folder Format, version 1

| | |
|---|---|
| Status | Draft 1.1 (2026-11-03, review round 1: signatures and person keys, derived IDs, deletion and rollback rules, exam and meta fields). Normative for Tramado 0.1. |
| Companion | [`sync-protocol-v1.md`](sync-protocol-v1.md): how class folders are shared through Syncthing. |
| Licence | MPL-2.0, like the rest of the repository. Anyone may implement it. |

This document defines what a **Tramado class** looks like on disk: directories, file names and the exact
JSON shape of every file that Tramado writes for machines. It is written so that other tools can read
Tramado classes, and write to them without breaking them.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

## 0. Design rules (read these first)

1. **A class is one plain directory.** People can open it in a file manager. Lectures, documents, exams
   and class notes are ordinary files that keep working without Tramado.
2. **Every machine-written file has exactly one writer device.** The writer's device ID is in the file's
   path (`.tramado/chat/<deviceId>/…`) or in the file's manifest. Two devices never write the same
   machine file, so Syncthing never makes conflict copies of them. Readers merge.
3. **Content type is found by manifest, not by folder name.** A directory that holds `lecture.json` is a
   lecture and one that holds `exam.json` is an exam, wherever they are and whatever they are called.
   Folder names are cosmetic and are localised when they are created.
4. **Nothing private is ever inside a class folder.** Private notes, highlights, marks, practice state,
   AI history, keys and caches live in per-device app directories (§12). Tramado never relies on
   `.stignore` to keep something private.
5. **Every machine record says what it is**: `format` (a string) and `version` (an integer). Readers
   keep unknown fields and refuse to rewrite what they do not understand (§7).
6. **Ordering uses Hybrid Logical Clocks (HLC)**, never bare wall clocks (§3).
7. **Who may do what is signed.** The records that decide membership and authority carry an Ed25519
   signature by the writer device, and every member file carries a proof made with the person's own key (§6.6,
   §8.3.1). Everything else is protected by Syncthing's `modifiedBy` (§6.2).

---

## 1. Terminology

| Term | Meaning |
|---|---|
| Class | One directory, the **class root**. When shared, it is one Syncthing folder. |
| Device | One installation of Tramado, identified by its Syncthing device ID. Every machine file is keyed by device. |
| Member / person | A human, identified by a `memberId`, which is derived from the person's own Ed25519 key (§8.3.1). A person can have several devices (sync spec §19). |
| Device key | The Ed25519 key of a device's Syncthing identity (`key.pem`); its certificate's SHA-256 is the device ID. Signs records (§6.6). |
| Person key | An Ed25519 key created at onboarding and kept by the app outside class folders; it proves which devices belong to a person (§8.3.1). |
| Writer | The one device allowed to write a given machine file. |
| Class path | A path relative to the class root, using `/` as the separator, Unicode NFC, no leading `/`, no `.` or `..` segments. Example: `Aulas/2026-10-14 1015 Aula 6/lecture.json`. |
| Organiser | A social role (§8.2). Syncthing gives every member write access, so roles cannot be enforced, only honoured. |

---

## 2. Identifiers

| Name | Format (regex) | Example | Created by |
|---|---|---|---|
| `ClassId` (= Syncthing folder ID) | `^tramado-[a-z2-7]{26}$` | `tramado-geznkyujw4ofedwinfcmzl2rim` | Derived from the creating device and a nonce (§2.1). Created when the class is created, even if the class is never shared; it becomes the folder ID when the class is shared. |
| `Nonce` | `^[a-z2-7]{26}$` | `q4m2zx7k3v5hbnw6r2yjc7aefg` | 16 random bytes, RFC 4648 base32, lower case, no padding, first 26 chars. Input of derived IDs (§2.1). |
| `DeviceId` (canonical) | `^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$` | `AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2` | Syncthing (SHA-256 of the device certificate, base32, with Luhn check characters). Always written in this canonical, upper-case, dashed form. |
| `ShortId` | `^[A-Z2-7]{7}$` | `AB4Z76W` | The first 7 characters of a `DeviceId`. This is what Syncthing reports as `modifiedBy`. |
| `DeviceId` (dashless, invites only) | `^[A-Z2-7]{56}$` | | The canonical ID with the 7 dashes removed (56 characters including check characters). |
| `MemberId` | `^[a-z2-7]{26}$` | `k3q7mzx2v4hbtnw5r6yjc2aefg` | Derived from the person public key (§2.1, §8.3.1). Created once at onboarding, with the person key. Not a secret. |
| `Ulid` | `^[0-7][0-9A-HJKMNP-TV-Z]{25}$` | `01JBX4Q7Z5W8M2E3C9R6T0YH2K` | ULID (Crockford base32, upper case). Lecture and exam IDs are **derived** ULIDs (§2.1); chat lines, edit lines, answers, consent records and annotations use random ULIDs. |
| `SegmentId` | `^s_[0-9A-Za-z]{5,8}$` | `s_8k2Lq` | Random base62. Unique within one transcript, never reused, never an index. |
| `QuestionId` | `^q_[0-9A-Za-z]{6,8}$` | `q_7fK2aZ` | Random base62. Unique within one exam, never reused. |
| `Hlc` | §3 | `001793721438157-00000-ab4z76w` | HLC stamp. |
| `Hex64` | `^[0-9a-f]{64}$` | | Lower-case SHA-256 hex digest. |
| `Hex40` | `^[0-9a-f]{40}$` | | Lower-case SHA-1 hex digest (only used to detect text changes, never for security). |
| `Instant` | RFC 3339, UTC, `Z`, milliseconds | `2026-11-03T10:15:02.123Z` | Wall-clock time, for display and `*At` fields. |
| `LocalDateTime` | RFC 3339 with offset | `2026-06-20T09:00:00+01:00` | Calendar times entered by people (exam dates). |
| `EpochMs` | integer ≥ 0 | `1793721438157` | Milliseconds since 1970-01-01 UTC, from the writer's wall clock. |
| `ClassPath` | §1 | | |
| `ColourHex` | `^#[0-9a-f]{6}$` | `#3e63dd` | Class colour. Tramado offers 12 (§8.2); readers MUST accept any hex value. |
| `IconName` | `^[a-z0-9-]{1,40}$` | `scale` | A lucide icon name. Unknown names render as `book-open`. |
| `Lang` | BCP 47 tag | `pt-PT`, `pt-BR`, `es`, `es-ES`, `en` | Language of lectures and AI output. Two tags **match** when their primary subtags are equal and, if both have a region, the regions are equal too (`pt-PT` ≠ `pt-BR`; `es` matches `es-ES`). Comparison is case-insensitive. |
| `ModelId` | `^[a-z0-9-]{1,40}$` | `turbo` | A local speech model of Tramado's registry: `turbo` (`ggml-large-v3-turbo-q5_0.bin`), `small` (`ggml-small-q5_1.bin`), `large-v3` (`ggml-large-v3-q5_0.bin`). Readers MUST accept unknown values. |
| `Sig` | §6.6 | | Ed25519 signature by the writer device. |

### 2.1 Derived identifiers

`b32(x)` is RFC 4648 base32 of `x`, lower case, without padding; strings are hashed as UTF-8; `deviceId` is the
canonical dashed form.

```
classId(creatorDeviceId, idNonce)   = "tramado-" + b32(SHA-256("tramado-class-v1|" + creatorDeviceId + "|" + idNonce))[0..26]
itemId(ms, writerDeviceId, idNonce) = the ULID whose 48-bit time is `ms` and whose 80 "random" bits are the first
                                      10 bytes of SHA-256("tramado-item-v1|" + writerDeviceId + "|" + idNonce)
memberId(personPub)                 = b32(SHA-256(personPub))[0..26]          # personPub = the 32 raw public-key bytes
```

`class.json` derives `classId` from `createdBy.deviceId` and its `idNonce`; `lecture.json` and `exam.json` derive
`id` from `recordedBy.deviceId` / `importedBy.deviceId` and their `idNonce`. Readers MUST recompute these before
trusting a manifest (§6.2 rule 3); for item IDs they compare the 80-bit part only (the 48-bit time is the creation
time: the recording start for a lecture, which is also its draft ID in presence and consent lines, and `createdAt`
for an exam). Creating a class therefore needs the device ID, even for a class that is
never shared (sync spec §2.3 creates the identity without starting Syncthing).

---

## 3. Hybrid Logical Clock (HLC)

Chat lines, edit operations, metadata fields, consent records, moderation lines and bans carry an HLC so
that they can be ordered across devices whose clocks disagree. The format is Trama's `core/hlc.ts`
(kept verbatim in Tramado, with its tests).

### 3.1 Format

```
<ms:15 decimal digits>-<counter:5 base-36 digits [0-9a-z]>-<node>
```

- `ms`: milliseconds since the Unix epoch, zero-padded to 15 digits.
- `counter`: logical counter, base 36, lower case, zero-padded to 5 digits (max 60 466 175).
- `node`: the writer's `ShortId` **in lower case** (7 characters, `[a-z2-7]{7}`).

Regex: `^\d{15}-[0-9a-z]{5}-[a-z2-7]{7}$`. Example: `001793721438157-00000-ab4z76w`.

### 3.2 Comparison

Plain byte-wise string comparison. Because every part is fixed-width, the string order equals the
order by `(ms, counter, node)`. Two different devices cannot produce the same stamp unless their
`ShortId`s collide (35 bits). If two stamps are equal and come from different files, break the tie by
the full `DeviceId` of the file's writer (string order), then by line number.

### 3.3 Generation (per device)

State: `(lastMs, counter)`. Persisted in app data so that a crash can never reissue a stamp: whenever `lastMs`
passes the persisted ceiling, the device writes and fsyncs `ceilingMs = lastMs + 10 000` **before** using the stamp;
at start, `lastMs = max(now, persisted ceilingMs)` and `counter = 0`.

```
tick():                                   # before every local write that needs a stamp
  pt = now_ms()
  if pt > lastMs: lastMs = pt; counter = 0
  else:           counter += 1
  return format(lastMs, counter, node)

observe(remote):                          # for every stamp read from another device's file
  r = parse(remote)
  pt = now_ms()
  if r.ms > pt + 3_600_000: report "clock far ahead" (diagnostics); return   # guard, §3.4
  m = max(pt, lastMs, r.ms)
  if   m == lastMs == r.ms: counter = max(counter, r.counter) + 1
  elif m == lastMs:         counter += 1
  elif m == r.ms:           counter = r.counter + 1
  else:                     counter = 0
  lastMs = m
```

### 3.4 Clock-skew rules

- Stamps from a device more than 1 hour in the future are still **ordered** normally (ordering must be
  the same on every reader) but are **not observed** (they must not drag this device's clock forward).
- A device whose stamps are more than 5 minutes away from the reader's clock gets a diagnostics hint
  ("Ana's computer clock is 7 minutes fast").
- Wall time shown to people comes from the record's `ms` or `*At` field, never from the HLC.
- **Overriding a register.** A device that writes a last-writer-wins value (a meta field §8.2; a `set_text`,
  `set_speaker` or `label_speaker` edit §8.9; a `set_exam` or `set_question` edit §8.13; a pin, unpin or reaction;
  a ban entry §8.19) stamps it `max(tick(), succ(w))`, where `w` is the greatest HLC of the value currently in
  effect for that register and `succ(h)` is `h` with `counter + 1` and the device's own node. The device's own
  clock state does not change. So a value stamped far in the future by a device with a wrong clock can always be
  overridden, and every reader orders the result the same way.

---

## 4. Common rules for every file

### 4.1 Encoding

- UTF-8 without BOM. Line endings `\n`. JSON per RFC 8259.
- Keys are `camelCase`. (Earlier research drafts used `snake_case` in the transcript; v1 uses
  `camelCase` everywhere, to match the TypeScript types.)
- JSON files (`*.json`): writers SHOULD use 2-space indentation for manifests (`lecture.json`,
  `exam.json`, `class.json`) and compact output for everything else. Readers MUST accept both.
- JSONL files (`*.jsonl`): one compact JSON object per line, each line ending in `\n`.

### 4.2 Envelope

Every JSON file and every JSONL line has:

| Field | Type | Rule |
|---|---|---|
| `format` | string | The record type, e.g. `"tramado.chat"`. Table in §7.1. |
| `version` | integer ≥ 1 | Major version of that record type. |

These two fields, plus `deviceId`, `memberId` and `sig` where present, are **frozen**: they keep their name,
type and meaning in every future version, so that an old reader can always tell what a record is and who
it belongs to.

### 4.3 Unknown data

- Readers MUST ignore unknown fields and unknown enum values they can skip (an unknown chat `type`, an
  unknown locator `type`).
- A writer that rewrites a file it owns MUST keep fields it does not understand.
- A reader MUST ignore a JSONL line it cannot parse and MUST ignore a trailing line without `\n`
  (it may be half-written).

### 4.4 Writing files safely

- **Whole-file writes** (`*.json`, `*.md`, `*.vtt`): write to a temporary file in the same directory
  named `.<name>.<8 random [a-z0-9]>.tmp`, `fsync` it, then rename it over the target. The `*.tmp`
  pattern is in the managed ignores (§11), so Syncthing never sends the temporary file.
- **Appends** (`*.jsonl`): open with `O_APPEND`, write the whole line including `\n` with one `write()`
  call, then `fsync`. A line MUST NOT exceed 65 536 bytes.
- **Large new files** (audio, imported documents): stage them in `.tramado/tmp/<random>.part`
  (ignored), then rename into place.
- After every write inside a shared class, Tramado asks Syncthing to scan that path at once
  (sync spec §3.4). Other tools that write files MAY skip this; Syncthing's watcher finds the change
  within 1–2 s.

### 4.5 Files a reader must skip

At any depth: `.stfolder/`, `.stversions/`, `.stignore`, `.syncthing.*.tmp`, `~syncthing~*.tmp`,
`*.tmp`, `*.part`, and `*.sync-conflict-*` copies (except in the notes directory, §8.21). At the root:
`.tramado/tmp/`.

### 4.6 Size limits

| Item | Limit | What happens above it |
|---|---|---|
| Any JSONL line | 65 536 bytes | Writer refuses; reader skips the line. |
| Chat `text`, annotation `body` | 8 000 characters | Writer refuses. |
| `members/*.json`, `presence/*.json`, `meta/*.json`, `bans/*.json` | 64 KiB | Reader ignores the file (diagnostics). |
| `transcript.json` | 32 MiB | Reader ignores the file (diagnostics). |
| `exam.json` | 4 MiB | Reader ignores the file (diagnostics). |
| Class path length | 200 UTF-16 code units | §5.4. |

---

## 5. Directory layout

### 5.1 Tree

```
<Class root>/                                      # e.g. ~/Tramado/Teoria Geral do Direito Civil/
  <Lectures dir>/                                  # cosmetic, localised; see §5.2
    <YYYY-MM-DD HHmm> <title>/                     # one lecture; any name; found by its manifest
      lecture.json            # manifest "tramado.lecture"; writer = recorder device              §8.6
      audio.webm              # Opus in WebM; immutable once published; absent if not shared        §8.7
      transcript.json         # "tramado.transcript"; writer = transcript owner                     §8.8
      transcript.md           # generated by the transcript owner                                   §8.8
      transcript.vtt          # generated by the transcript owner                                   §8.8
      <any other files>       # treated as documents attached to the lecture
  <Documents dir>/…                                # the students' files, any names, any depth
    <From chat dir>/…                              # chat attachments (§8.16)
  <Exams dir>/
    <title>/                                       # one exam; found by its manifest
      exam.json               # manifest "tramado.exam"; writer = importer device                   §8.12
      <original files>        # pdf / docx / jpg / png, listed in exam.json
  <Notes dir>/*.md                                 # class notes, Markdown; multi-writer by design     §8.21
  .tramado/                                        # machine data; one writer per file
    class.json                                     # write-once class identity                       §8.1
    meta/<deviceId>.json                           # class metadata, LWW per field                   §8.2
    members/<deviceId>.json                        # roster entry of one device                      §8.3
    presence/<deviceId>.json                       # live activity of one device                     §8.4
    consent/<deviceId>.jsonl                       # recording/sharing consent records               §8.5
    chat/<deviceId>/<YYYY-MM>.jsonl                # chat, one file per device per month             §8.16
    annotations/<deviceId>/<YYYY-MM>.jsonl         # shared comments and highlights                  §8.17
    claims/<lectureId>/<deviceId>.json             # transcription claim                             §8.10
    claims/<lectureId>.fold/<deviceId>.json        # transcript hand-over claim                      §8.10
    edits/<lectureId>/<deviceId>.jsonl             # transcript corrections                          §8.9
    markers/<lectureId>/<deviceId>.json            # only if the student opted in to share markers   §8.11
    exam-edits/<examId>/<deviceId>.jsonl           # exam question corrections                       §8.13
    answers/<examId>/<deviceId>.json               # shared AI answers                               §8.14
    mod/<deviceId>.jsonl                           # pins, hides, audio removal, class rotation      §8.18
    bans/<deviceId>.json                           # soft ban list                                   §8.19
    invites/<deviceId>.json                        # RESERVED for v1.1 revocable invites             §8.20
    tmp/                                           # ignored staging area (*.part)
  .stfolder/  .stignore  .stversions/              # Syncthing's own (shared classes only)
```

**Deviations from the research baseline (critique §6), with reasons:**

- `.tramado/class.json` was added. Discovery by manifest needs a marker that says "this directory is a
  Tramado class" and carries the class ID, and a class that has never been shared has no Syncthing
  folder ID anywhere else. It is write-once by the creator device, so it keeps the single-writer rule.
- `.tramado/annotations/` was added for comments and highlights that a student chooses to share
  (`product-ux §4.10`, "👥 Class" visibility). Private annotations stay in app data.
- Member `caps` is `{cpuOk, localModel: {id, speedRT} | null, cloud, volunteer}` instead of critique §7's
  `{model, cpuOk, speedRT, ac, volunteer}`: local model readiness and cloud transcription are separate
  capabilities, and power (`ac`) is live state, so it lives in `presence.power` (§8.4).
- `lecture.json` has `channels[]` and `consent[]` instead of critique §6's `speakers[]` and `consentRef`: a stereo
  online recording maps each channel to a speaker, and a recording may rely on several consent lines (`record` and
  `share`, class scope or lecture scope).
- Person keys, device signatures and derived IDs (§2.1, §6.6, §8.3.1) replace critique §7's trust-on-first-use
  binding and vouches, and manifest writer pinning: those could be defeated by any member who edits a file by hand
  or runs a modified Syncthing (review round 1).

### 5.2 Localised directory names

The four content directories (and the chat-attachments sub-directory) are created on first use with the
names below, in the language the class creator's app uses. Their actual names are recorded in the
`dirs` field of class metadata (§8.2), which is where **new** items go. Renaming them in a file manager
is allowed: discovery (§5.3) does not depend on names.

| Key | EN | PT-PT | ES |
|---|---|---|---|
| `lectures` | `Lectures` | `Aulas` | `Clases` |
| `documents` | `Documents` | `Documentos` | `Documentos` |
| `exams` | `Exams` | `Exames` | `Exámenes` |
| `notes` | `Notes` | `Notas` | `Notas` |
| `fromChat` (inside `documents`) | `From chat` | `Do chat` | `Del chat` |

Lecture directory names: `<YYYY-MM-DD HHmm> <title>`, using the recorder's local date and time when
recording started, then the sanitised title (§5.4). Exam directory names: the sanitised exam title.

### 5.3 Discovery algorithm

```
discover(root):
  require file root/.tramado/class.json  (format "tramado.class")   else: not a Tramado class
  walk root depth-first, at most 6 levels deep, skipping:
      .tramado/, .stfolder/, .stversions/, every directory whose name starts with "."
      the files of §4.5
  a directory containing lecture.json  -> lecture   (do not descend further)
  a directory containing audio.webm, transcript.json, transcript.md or transcript.vtt but no lecture.json
                                       -> pendingLecture: hidden, not indexed, not listed as documents
                                          (its manifest has not arrived yet; Syncthing does not order files)
  a directory containing exam.json     -> exam      (do not descend further)
  a *.md file under the notes dir (meta dirs.notes, any depth) -> class note
  every other regular file             -> document
  symbolic links are never followed and never listed
```

- Two manifests with the same `id`: keep the one whose writer check (§6) passes; if both pass, keep the
  one with the shorter class path (then the smaller path in string order). Flag the other as
  "duplicate copy" in diagnostics.
- A manifest whose `version` is newer than the reader knows: list the item read-only (§7.3).
- Files inside a lecture directory other than the ones in §5.1 are documents attached to that lecture.
  Files inside an exam directory that `exam.json` lists are the exam's originals; others are documents.

### 5.4 File and directory naming (cross-platform)

Every name that Tramado **creates or imports** goes through `sanitize`, so that a class folder syncs
to Windows, macOS and Linux members without errors. Names created by people outside Tramado are left
alone; Syncthing errors about them are shown to the user (sync spec §22).

```
sanitize(name, fallback):
  1. Unicode NFC.
  2. Replace each of  < > : " / \ | ? *  and every code point U+0000–U+001F and U+007F with "-".
  3. Collapse every run of Unicode White_Space into one U+0020 SPACE.
  4. Trim leading and trailing spaces; then remove trailing "." and " " characters until none remain.
  5. If the name starts with ".", replace that first "." with "_"   (no hidden or reserved names).
  6. Let base = the part before the first "."; if base, case-insensitively, is one of
       CON PRN AUX NUL COM1–COM9 LPT1–LPT9 COM¹ COM² COM³ LPT¹ LPT² LPT³
     then append "_" to base.
  7. If the name would be ignored or misread by Syncthing, append "_" before the extension:
       ends (case-insensitively) with .tmp .part .crdownload
       starts with ~$  .~lock.  .syncthing.  ~syncthing~
       contains .sync-conflict-
  8. Truncate to 120 UTF-8 bytes on a grapheme boundary, keeping an extension of up to 16 bytes.
  9. If empty, use fallback (e.g. "Untitled").

unique(dir, name):
  if a sibling exists whose NFC + Unicode case-fold equals name's, insert " (2)", " (3)", …
  before the extension until it is unique.
```

- The whole class path MUST NOT exceed 200 UTF-16 code units. When a new lecture or exam directory
  would exceed it, shorten the title part.
- Readers MUST compare names NFC-normalised (Syncthing's `autoNormalize` keeps NFC on disk).

---

## 6. Authorship and trust

Syncthing gives every member full write access to the whole folder. "One writer per file" is therefore
a convention that a buggy or hostile member could break. This was verified: a member overwrote another
member's chat file and the forgery synced to everyone, with `modifiedBy` naming the forger; a member also
deleted another member's file, and the deletion reached its owner with `modifiedBy` naming the deleter.
Tramado detects such writes and deletions and ignores them. Two layers protect machine files:

- **Authorship by `modifiedBy`** (§6.2) stops members who use an unmodified Syncthing. It covers every machine file.
- **Signatures** (§6.6) also stop members who run a modified Syncthing, which can put any `modifiedBy` in what it
  sends. They cover the records that decide who is in the class and who may do what: `class.json`, `meta/*`,
  `members/*`, `bans/*`, and every line of `consent/*` and `mod/*`.

### 6.1 Writer of each machine file

| Path | Writer | Signed (§6.6) |
|---|---|---|
| `.tramado/<dir>/<deviceId>.json[l]`, `.tramado/<dir>/<objectId>/<deviceId>.json[l]`, `.tramado/<dir>/<deviceId>/<YYYY-MM>.jsonl` | The device named in the path. | `meta`, `members`, `bans` (whole file); `consent`, `mod` (every line) |
| `.tramado/class.json` | `createdBy.deviceId` in the file, which MUST derive `classId` (§2.1). | yes |
| `lecture.json` | `recordedBy.deviceId` in the file, which MUST derive `id` (§2.1). | no |
| `exam.json` | `importedBy.deviceId` in the file, which MUST derive `id` (§2.1). | no |
| `transcript.json`, `transcript.md`, `transcript.vtt` | `writer.deviceId` in `transcript.json` (the transcript owner, §8.8). | no |
| `audio.webm` | The writer of the sibling `lecture.json`. | no (its SHA-256 is in `lecture.json`) |
| Everything else (documents, exam originals, notes) | Anyone. Not authorship-checked. | no |

### 6.2 The rule

A version of a machine file is **trusted** only if Syncthing says that the writer's device made **that version**:
`GET /rest/db/file` → `local.modifiedBy` equals the `ShortId` of the file's writer **and** `local.blocksHash`
equals the block hash of the bytes the reader actually read (sync spec §12.1 defines the hash). The
`modifiedBy` of a `RemoteChangeDetected` event is only a hint that something changed, never the verdict:
events and the database can still describe an older version than the bytes on disk (measured: new bytes on
disk 268 ms after the write, the event at 274 ms, the database entry at 277 ms). How Tramado checks this is
in sync spec §12.

Refinements:

1. **Same content is fine.** If `modifiedBy` does not match but the file's SHA-256 equals the last
   trusted content of that path, it stays trusted (for example, another device only changed
   permissions, or a deleted file was restored from a trashcan by someone else; the trust cache keeps the
   entries of deleted machine files for 31 days for this reason).
2. **Trusted prefix of append-only files.** For a `*.jsonl` file, the reader remembers the byte length
   and SHA-256 of the last trusted content. If a foreign write keeps that prefix byte-for-byte, the prefix
   stays trusted and only the bytes after it are dropped.
3. **Manifests are bound to their creator.** For files whose writer is named inside the file (`class.json`,
   `lecture.json`, `exam.json`), the reader recomputes the item's ID from the named writer device and the
   manifest's `idNonce` (§2.1). A mismatch makes the file untrusted, whoever wrote it, so no member can make
   itself the creator of an existing class, lecture or exam. `transcript.json` names its writer in `writer`;
   the reader pins it the first time it trusts the file (kept in the trust cache) and accepts a different
   writer only when one of these holds:
   - the new file's `round` is greater than the pinned one and a trusted transcribe claim of that round by the
     new writer exists (re-transcription, sync spec §14.7);
   - (v1.1, transcript corrections) the new writer won a fold claim (§8.10) **and** the reader itself sees the
     fold trigger of sync spec §14.8 (the previous owner `left()`, or was last seen more than 7 days ago).
4. **Deletions are checked like writes.** A deletion of a machine file takes effect only if its
   `modifiedBy` (`GET /rest/db/file` → `local.deleted == true` and `local.modifiedBy`) equals the writer's
   `ShortId`. Otherwise readers keep the last trusted content, and the writer restores its file (self-heal,
   sync spec §12.3). Because a deleted file is gone from disk, readers keep the last trusted bytes of
   `class.json`, `members/*`, `meta/*`, `bans/*` and `mod/*` (each at most 64 KiB) in the trust cache
   (`private/<classId>/trusted/<class path>`, architecture §13.2). Writers never delete `class.json`, `meta/*`,
   `bans/*`, `mod/*` or `consent/*` in v1, so readers ignore every deletion of them.
5. **Untrusted content is ignored**, never shown as if it came from the named device. Diagnostics say
   "A classmate's computer changed Ana's chat file" (`SYNC_FOREIGN_WRITE`).
6. **Records belong to the writer's person, not to their own `memberId`.** Every record that carries a
   `memberId` (chat, consent, edits, answers, annotations, mod, bans, meta, claims, markers, presence) MUST
   carry the `memberId` bound (§8.3.1) to the device that writes the file. Readers attribute a record to the
   person bound to the file's writer device, never to the record's own `memberId`. A record whose `memberId`
   differs is shown as "Unverified ({deviceName})" and never counts for authority (organiser operations,
   `@everyone`, unpin, hide, consent, Thanks, bans). A writer device with no valid binding is "Unverified" for
   all its records.
7. **No rollback.** A signed whole-file record (`meta/*`, `members/*`, `bans/*`) whose `hlc` is lower than the
   `hlc` of the last trusted version of the same path is ignored, even when its signature verifies (it is an
   old version replayed by someone else). For `class.json`, any version that differs from the trusted one is
   ignored unless it is a fork or a rotation by the trusted creator's own device (§8.1), which changes `classId`.

### 6.3 Readers without Syncthing

A tool that reads a class folder without access to a Syncthing instance that holds it (a folder copied
by hand, synced by another tool, or a class that was never shared) cannot check `modifiedBy`. It MUST:

- verify signatures and derived IDs where they exist (§2.1, §6.6); a valid signature proves who wrote a
  signed record even without Syncthing;
- treat every other machine file as **unverified** and say so in its UI if it shows authorship;
- never use unverified files to make security decisions (admission, bans, organiser rights);
- still apply every other rule in this document.

Tramado itself, for a local-only class, treats all files as written by the local device.

### 6.4 Writing from other tools

A third-party tool that writes into a shared class MUST write machine files only under the paths of the
device that will sync them (its own Syncthing device ID), and MUST NOT write those paths while Tramado is
running on the same device (Tramado keeps a private mirror of its own files and would overwrite foreign
changes). Signed records need the device key (§6.6), which only that device's Syncthing and Tramado hold.
Ordinary files (documents, notes) may be written at any time.

### 6.5 Honest limits

- `modifiedBy` is plain Syncthing metadata: the device that makes a change writes it, and every device that
  forwards the change relays it unchanged. Receivers cannot check it. A member who runs a modified Syncthing
  (its source is public) can therefore put **any** device's `ShortId` there. Against such a member only the
  signed records (§6.6) are protected: the roster and person bindings, class settings, organisers, bans,
  consent and moderation. Chat, transcripts, edits, answers, annotations, claims, presence and the lecture and
  exam manifests can be forged by such a member until v1.1 signs them as well (every JSON file and JSONL line
  reserves the field `sig`; v1 writers MUST NOT write `sig` outside §6.1's signed files, and v1 readers MUST
  ignore it there).
- Ordinary files (documents, lecture folders, notes) can be changed or deleted by any member.
  Trashcan versioning keeps 30 days of deleted and replaced files (sync spec §6.2).
- A device's identity is its Syncthing key. A copy of the key files on another computer is the same device to
  everyone; sync spec §2.5 refuses to start such a copy.
- A soft ban (§8.19) cannot take files away from the banned person, and a banned person who makes a new person
  key on a new computer is a new person to the class (sync spec §18.1).

### 6.6 Signatures

```ts
interface Sig {
  cert: string;    // base64 (RFC 4648, padded) of the DER of the writer device's Syncthing certificate (cert.pem; Ed25519 in Syncthing v2, ~420 bytes)
  value: string;   // base64 of the 64-byte Ed25519 signature made with the device's Syncthing key (key.pem)
}
```

The signed message is

```
UTF-8("tramado-sig-v1") || 0x00 || UTF-8(classId) || 0x00 || UTF-8(class path of the file) || 0x00 || JCS(record without "sig")
```

where JCS is RFC 8785 canonical JSON and, for a JSONL line, the record is the line's object. The prefix makes
these signatures useless anywhere else (TLS signs content that starts with 64 spaces), and the class ID and path
stop a signed record from being replayed in another class or file. In a class with `rotatedFrom` (§8.1), a JSONL
line signed under an earlier class ID of the rotation chain is also valid.

**Verifying** (every reader, before any other use of a signed record):

1. `deviceId(cert)` — the canonical device ID of `SHA-256(DER)` (Syncthing's encoding: base32 without padding,
   Luhn check characters, dashes) — MUST equal the file's writer (§6.1).
2. The DER MUST contain exactly one Ed25519 SubjectPublicKeyInfo, found by its 12-byte prefix
   `30 2a 30 05 06 03 2b 65 70 03 21 00`; the 32 bytes after it are the public key.
3. The Ed25519 signature MUST verify with that key over the message above.

A signed record that fails any step, or that has no `sig`, is untrusted (§6.2 rule 5). v1 writers MUST sign the
records marked in §6.1; v1 readers ignore an unsigned version of them.

Member files also carry a **person proof**, made with the person key, which binds the device to a person
(§8.3.1).

---

## 7. Versioning and compatibility

### 7.1 Record types in v1

| `format` | `version` | File |
|---|---|---|
| `tramado.class` | 1 | `.tramado/class.json` |
| `tramado.meta` | 1 | `.tramado/meta/<deviceId>.json` |
| `tramado.member` | 1 | `.tramado/members/<deviceId>.json` |
| `tramado.presence` | 1 | `.tramado/presence/<deviceId>.json` |
| `tramado.consent` | 1 | lines of `.tramado/consent/<deviceId>.jsonl` |
| `tramado.lecture` | 1 | `lecture.json` |
| `tramado.transcript` | 1 | `transcript.json` |
| `tramado.transcript-edit` | 1 | lines of `.tramado/edits/<lectureId>/<deviceId>.jsonl` |
| `tramado.claim` | 1 | `.tramado/claims/…/<deviceId>.json` |
| `tramado.markers` | 1 | `.tramado/markers/<lectureId>/<deviceId>.json` |
| `tramado.exam` | 1 | `exam.json` |
| `tramado.exam-edit` | 1 | lines of `.tramado/exam-edits/<examId>/<deviceId>.jsonl` |
| `tramado.answers` | 1 | `.tramado/answers/<examId>/<deviceId>.json` |
| `tramado.chat` | 1 | lines of `.tramado/chat/<deviceId>/<YYYY-MM>.jsonl` |
| `tramado.annotation` | 1 | lines of `.tramado/annotations/<deviceId>/<YYYY-MM>.jsonl` |
| `tramado.mod` | 1 | lines of `.tramado/mod/<deviceId>.jsonl` |
| `tramado.bans` | 1 | `.tramado/bans/<deviceId>.json` |

### 7.2 Minor and major changes

- **Minor change** (adding an optional field, adding an enum value that old readers can skip): the
  `version` number stays the same. The document's own version goes to 1.1, 1.2, …
- **Major change** (anything an old reader would misread): `version` + 1.
- **Writers negotiate.** Each device lists in its member file (§8.3) the highest `version` it can read
  for each `format`. A writer MUST write the highest version that **every** device in the class roster
  can read, falling back to the oldest version it can still write. So a class with one member on an old
  Tramado keeps working for everyone.

### 7.3 Newer formats (`NEWER_FORMAT`)

| Situation | Reader behaviour |
|---|---|
| A manifest (`lecture.json`, `exam.json`, `transcript.json`) has a newer `version` | Show the item read-only with the banner "Made with a newer Tramado — update to edit". Never rewrite it, never fold edits into it. |
| `class.json` has a newer `version` | Open the whole class read-only with the same banner. Keep syncing it. |
| A JSONL line has a newer `version` or an unknown `type` | Skip the line. Show a count: "3 messages need a newer Tramado". |
| A per-device JSON file (`members`, `meta`, `presence`, `bans`, `answers`, `markers`, `claims`) has a newer `version` | Use only the frozen fields (§4.2). For `members`, the device still counts as a roster member. For `claims`, a claim with a newer version counts as a live `working` claim of that device, so that this reader never competes with a newer transcriber. Ignore everything else in the file. |

The error code for all of these is `NEWER_FORMAT`.

---

## 8. File formats

Notation: TypeScript-style declarations. `field?:` means optional (may be absent); `T | null` means
present but possibly `null`. Types in `PascalCase` are defined in §2 or in this section. Each format
lists its writer, when it is written, and an example. IDs, nonces and signatures in examples are illustrative:
they do not verify.

### 8.1 `.tramado/class.json` (write-once)

```ts
interface ClassFile {
  format: "tramado.class";
  version: 1;
  classId: ClassId;                 // = classId(createdBy.deviceId, idNonce), §2.1
  idNonce: Nonce;
  specVersion: "1.0" | "1.1";       // this document's version when the class was created
  createdAt: Instant;
  createdBy: { memberId: MemberId; deviceId: DeviceId; name: string };   // name ≤ 64 chars
  initialName: string;              // ≤ 120 chars; the live name is in meta (§8.2)
  rotatedFrom?: ClassId;            // set when the class was re-created to remove someone (sync spec §18.2, v1.1)
  forkedFrom?: ClassId;             // set when a copy of a class became a class of its own (sync spec §17)
  sig: Sig;                         // by createdBy.deviceId (§6.6)
}
```

- Writer: the creating device, once. Nobody rewrites it. If it is missing on a device that has the class,
  that device does **not** recreate it; it waits for it to arrive from a peer (it is in every copy).
  Two exceptions write a new `class.json` at the same path, with a new `idNonce` and the `classId` derived from the
  writing device, which makes it a new class:
  - a class rotation (sync spec §18.2, v1.1): the rotating organiser's device, with `rotatedFrom` = old ID;
  - a fork (sync spec §17): a device that keeps a copy of a class it left, or adopts a copied class folder whose
    `.tramado/members/` holds other devices' files, with `forkedFrom` = old ID. A fork is written only while the
    folder is not shared.
- `classId` MUST equal the Syncthing folder ID when the class is shared. A mismatch means the folder was
  copied from another class: Tramado shows "This folder belongs to another class" and does not share it.

```json
{
  "format": "tramado.class",
  "version": 1,
  "classId": "tramado-geznkyujw4ofedwinfcmzl2rim",
  "idNonce": "q4m2zx7k3v5hbnw6r2yjc7aefg",
  "specVersion": "1.1",
  "createdAt": "2026-10-01T09:12:44.512Z",
  "createdBy": { "memberId": "k3q7mzx2v4hbtnw5r6yjc2aefg", "deviceId": "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2", "name": "Ana Ribeiro" },
  "initialName": "Teoria Geral do Direito Civil",
  "sig": { "cert": "MIIBnzCCAVGgAwIBAgII…", "value": "2Xb0…==" }
}
```

### 8.2 `.tramado/meta/<deviceId>.json` (class metadata, last-writer-wins per field)

Shared class settings are a set of **LWW registers**. Each device writes only its own file, holding the
values it set and the HLC of each change. The effective value of a field is the register with the
greatest HLC across all trusted meta files (filtered by authority, below).

```ts
interface Reg<T> { value: T; hlc: Hlc }

interface MetaFile {
  format: "tramado.meta";
  version: 1;
  deviceId: DeviceId;
  memberId: MemberId;
  fields: {
    name?:           Reg<string>;                 // 1–120 chars
    shortName?:      Reg<string>;                 // 1–12 chars, e.g. "TGDC"
    colour?:         Reg<ColourHex>;
    icon?:           Reg<IconName>;
    lecturer?:       Reg<string | null>;          // ≤ 80 chars
    term?:           Reg<string | null>;          // ≤ 40 chars, e.g. "2026/27 · S1"
    language?:       Reg<Lang | "auto">;          // language spoken in lectures; "auto" = detect
    description?:    Reg<string | null>;          // ≤ 2 000 chars
    vocabulary?:     Reg<string | null>;          // ≤ 500 chars; names and terms passed to the speech model as its initial prompt
    dirs?:           Reg<{ lectures: string; documents: string; exams: string; notes: string; fromChat: string }>;
    askBeforeAdmit?: Reg<boolean>;                // sync spec §9.3; organisers only
    largeClassAck?:  Reg<boolean>;                // the "large class" warning was acknowledged
  };
  organiserOps: Array<{ op: "add" | "remove"; memberId: MemberId; hlc: Hlc }>;   // append-only within the file
  hlc: Hlc;                         // stamped at every rewrite (no-rollback rule, §6.2 rule 7)
  sig: Sig;                         // §6.6
}
```

**Validation.** Readers MUST treat a register as absent when its value violates its type or length, and also when:
- `dirs`: any value differs from `sanitize(value)` (§5.4), contains `/`, starts with `.`, or two of the five values
  are equal (case-insensitively, NFC);
- `name`, `shortName`, `lecturer`, `term`: not NFC, or containing a C0/C1 control character or one of
  U+202A–U+202E, U+2066–U+2069 (bidi overrides; `name` becomes the Syncthing folder label on every device).

**Authority.** Every member may set any field except `askBeforeAdmit`, which counts only when the device that wrote
it was bound to a person who was an organiser **at the register's HLC** (the replay state below at that stamp).
Readers apply this filter before taking the maximum.

**Organisers** are computed by replaying all `organiserOps` from all trusted meta files in HLC order:

```
S = { class.json.createdBy.memberId }
vacated = memberIds all of whose bound devices have left()   # observed by this reader; never shrinks (kept in the trust cache)
for op in all organiserOps sorted by hlc:
  author = person bound to the device whose file holds op      # §8.3.1; a device that left keeps its last binding for ops
                                                               #   stamped before it left
  valid  = author ∈ S
        or (op.op == "add" and op.memberId == author and S ⊆ vacated)   # "Become an organiser"
  if valid and op.op == "add" and author ∉ S: S = S − vacated  # the vacancy clause also drops the departed organisers
  if valid: op.op == "add" ? S.add(op.memberId) : S.remove(op.memberId)
organisers = S
```

The vacancy clause lets anyone "Become an organiser" once every organiser has left (`critique G6`). Vacancy is
monotonic: an organiser who leaves and later rejoins is not an organiser again until a current organiser adds them,
and the ops of whoever stepped in stay valid. `vacated` can differ briefly between devices while departures sync.

Colours offered by Tramado (`trama-ui §2.4`): `#e5484d #f76b15 #f5a524 #8db600 #30a46c #12a594
#0090c8 #3e63dd #6e56cf #ab4aba #d6409f #8d8d86`.

```json
{"format":"tramado.meta","version":1,"deviceId":"AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2",
 "memberId":"k3q7mzx2v4hbtnw5r6yjc2aefg",
 "fields":{"name":{"value":"Teoria Geral do Direito Civil","hlc":"001790845964512-00000-ab4z76w"},
           "shortName":{"value":"TGDC","hlc":"001790845964512-00001-ab4z76w"},
           "colour":{"value":"#3e63dd","hlc":"001790845964512-00002-ab4z76w"},
           "icon":{"value":"scale","hlc":"001790845964512-00003-ab4z76w"},
           "language":{"value":"pt-PT","hlc":"001790845964512-00004-ab4z76w"},
           "dirs":{"value":{"lectures":"Aulas","documents":"Documentos","exams":"Exames","notes":"Notas","fromChat":"Do chat"},"hlc":"001790845964512-00005-ab4z76w"}},
 "organiserOps":[{"op":"add","memberId":"k3q7mzx2v4hbtnw5r6yjc2aefg","hlc":"001790845964512-00006-ab4z76w"}],
 "hlc":"001790845964512-00006-ab4z76w","sig":{"cert":"MIIBnzCCAVGgAwIBAgII…","value":"7Hq1…=="}}
```

### 8.3 `.tramado/members/<deviceId>.json` (roster)

One file per device that is a member of the class. Creating it means "this device is in the class";
deleting it means "this device left" (sync spec §17).

```ts
interface MemberFile {
  format: "tramado.member";
  version: 1;
  deviceId: DeviceId;                 // MUST equal the device ID in the path
  memberId: MemberId;
  name: string;                       // person's display name, 1–64 chars
  colour?: ColourHex;                 // person's avatar colour (Settings › Profile); absent = derived from memberId
  deviceName: string;                 // e.g. "Ana's laptop", 1–64 chars
  joinedAt: Instant;                  // set once; display only
  hlc: Hlc;                           // stamped at every rewrite (no-rollback rule, §6.2 rule 7)
  addresses: string[];                // ≤ 8 Syncthing addresses this device listens on (sync spec §11.2)
  caps: {
    cpuOk: boolean;                   // can run local transcription at all
    localModel: null | { id: ModelId; speedRT: number };  // active installed model (registry id, §2) and measured × real time
    cloud: boolean;                   // cloud transcription is enabled and consented on this device
    volunteer: "off" | "plugged" | "always";              // EFFECTIVE auto-claim policy (sync spec §14.3): "off" while
                                                          // no local model is installed and automatic cloud use is off
  };
  person: PersonProof;                // §8.3.1
  vouches: DeviceId[];                // informational: other devices of the same person this device knows; not used for binding
  formats: Record<string, number>;    // highest readable version per format, e.g. {"tramado.chat":1,…}
  app: { name: "Tramado" | string; version: string; platform: "linux" | "macos" | "windows" | string };
  sig: Sig;                           // §6.6
}
```

The device rewrites its file when any field changes (addresses at most once every 5 minutes).

#### 8.3.1 Binding devices to people (person keys)

Each person has an Ed25519 **person key**, created at onboarding and kept by the app outside every class folder
(architecture §13.3). `memberId = memberId(personPub)` (§2.1). Every member file proves its binding:

```ts
interface PersonProof {
  pub: string;     // base64url (no padding) of the 32-byte person public key
  sig: string;     // base64url of Ed25519(person key, UTF-8("tramado-member-v1|" + classId + "|" + deviceId + "|" + memberId))
  revoked?: Array<{ deviceId: DeviceId; sig: string }>;   // v1.1: devices this person unbinds;
                   // sig over UTF-8("tramado-revoke-v1|" + classId + "|" + deviceId + "|" + memberId)
}
```

A device D is **bound** to person M when D's trusted, signed member file has `memberId: M`,
`memberId(person.pub) == M`, and `person.sig` verifies for D, the class and M. D stops being bound when another
trusted member file of person M lists D in `person.revoked` with a valid signature. There is no trust on first use
and no tie-break: two devices can only be bound to M if both hold M's person key.

Devices whose member file claims M without a valid proof are shown as "Unverified device claiming to be Ana"; their
content is labelled with the device name and never counts for M's authority. A person's display name and colour
are those of the bound device file with the greatest `hlc`. A device that left (sync spec §10 `left()`) keeps the
binding of its last trusted member file (kept in the trust cache, §6.2 rule 4) for records stamped before it left.

The person key leaves the computer only when its owner pairs another computer (sync spec §19, v1.1), inside the
pairing code. A lost person key means a new person to every class.

```json
{"format":"tramado.member","version":1,
 "deviceId":"AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2",
 "memberId":"k3q7mzx2v4hbtnw5r6yjc2aefg","name":"Ana Ribeiro","colour":"#12a594","deviceName":"Ana's laptop",
 "joinedAt":"2026-10-01T09:12:44.512Z","hlc":"001793721438157-00000-ab4z76w",
 "addresses":["tcp://192.168.1.20:22117","relay://95.216.157.10:22067/?id=NZRTFEN-…"],
 "caps":{"cpuOk":true,"localModel":{"id":"turbo","speedRT":2.7},"cloud":false,"volunteer":"plugged"},
 "person":{"pub":"Jb3x…(43 chars)","sig":"q0Zm…(86 chars)"},
 "vouches":["LGTQI2N-C7CZ54U-LP7HIBQ-VR4TCWO-YY67AJF-SXWTCG5-QLJA5Q4-X4KTTQO"],
 "formats":{"tramado.class":1,"tramado.meta":1,"tramado.member":1,"tramado.presence":1,"tramado.consent":1,
            "tramado.lecture":1,"tramado.transcript":1,"tramado.transcript-edit":1,"tramado.claim":1,
            "tramado.markers":1,"tramado.exam":1,"tramado.exam-edit":1,"tramado.answers":1,"tramado.chat":1,
            "tramado.annotation":1,"tramado.mod":1,"tramado.bans":1},
 "app":{"name":"Tramado","version":"0.1.0","platform":"linux"},
 "sig":{"cert":"MIIBnzCCAVGgAwIBAgII…","value":"c9Lr…=="}}
```

### 8.4 `.tramado/presence/<deviceId>.json` (live activity)

Overwritten in place. Written on every change of activity, and every 60 s **only while** an activity
is running (heartbeat). An idle device writes nothing, so big classes do not churn.

```ts
interface PresenceFile {
  format: "tramado.presence";
  version: 1;
  deviceId: DeviceId;
  memberId: MemberId;
  seq: number;                  // +1 at every write; readers judge staleness by watching seq change
  hlc: Hlc;
  updatedAt: Instant;           // display only
  power: "ac" | "battery" | "unknown";
  activity: {
    recording?:    { draftId: Ulid; startedAt: Instant; mode: "room" | "online"; title?: string };
    transcribing?: { lectureId: Ulid; progress: number /* 0..1 */; etaMs?: number };
    editing?:      { path: ClassPath; since: Instant };   // a class note being edited (§8.21)
  };
  heartbeatS: 60 | 0;           // 60 while any activity is set, 0 when idle
}
```

Staleness is judged by the reader's own clock (sync spec §13): an activity whose `seq` has not changed
for 3 minutes is shown as "may be asleep or offline" and is not used for decisions. Readers also ignore an
activity whose `updatedAt` is more than 24 hours older than their own clock (a crashed device's leftover).
`draftId` is the ULID that the lecture will get when it is published.

### 8.5 `.tramado/consent/<deviceId>.jsonl` (consent log, append-only)

```ts
interface ConsentLine {
  format: "tramado.consent";
  version: 1;
  id: Ulid;
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;              // the person who confirmed
  kind: "record" | "share" | "revoke";
  scope: "class" | "lecture";      // "class" = "Remember for this class"
  lectureId?: Ulid;                // when scope == "lecture"; the lecture's (draft) id
  share?: "audio+transcript" | "transcript-only";   // when kind == "share"
  revokes?: { deviceId: DeviceId; id: Ulid };       // when kind == "revoke": the line it revokes (any device's log)
  textId: string;                  // catalog key of the consent sentence, e.g. "record.dialog.consent.v1"
  textLang: Lang;
  text: string;                    // the exact sentence the person ticked, as shown (≤ 500 chars)
  lecturer?: string;               // the lecturer named in the sentence, if any
  sig: Sig;                        // §6.6
}
```

Every recording start writes a `record` line (and a `share` line in a shared class) with `scope: "lecture"`;
"Remember for this class" writes them with `scope: "class"`. A class-scope record applies to lectures recorded in
that class until revoked. A `revoke` line counts when written by the person who wrote the revoked line or by an
organiser (at the revoke line's HLC). `lecture.json` points
to the records it relied on (`consent`, §8.6). The text is stored verbatim because consent wording
may change between app versions (`critique R16`).

### 8.6 `lecture.json` (lecture manifest)

```ts
interface LectureFile {
  format: "tramado.lecture";
  version: 1;
  id: Ulid;                                        // = itemId(recording start ms, recordedBy.deviceId, idNonce), §2.1
  idNonce: Nonce;
  title: string;                                   // 1–200 chars
  startedAt: Instant;
  durationMs: number;
  mode: "room" | "online" | "import";
  language: Lang | "auto";
  recordedBy: { memberId: MemberId; deviceId: DeviceId; name: string };
  audio: null | {
    file: "audio.webm";
    shared: boolean;                // false = "transcript only": the audio stayed on the recorder's computer
    codec: "opus"; container: "webm";
    sampleRate: 16000;
    channels: 1 | 2;
    bitrate: number;                // bits per second: 24000 or 16000 ("storage saver") mono, 32000 stereo
    size: number;                   // bytes of audio.webm
    sha256: Hex64;                  // of audio.webm
  };
  audioDeletedAt?: Instant;         // set when the audio was deleted "for everyone" (audio is then null)
  channels: Array<{ index: number; speaker: "lecture" | "me" | "class" }>;   // mono: [{0,"lecture"}]; stereo online: [{0,"me"},{1,"class"}]
  pauses: Array<{ atMs: number; wallFrom: Instant; wallTo: Instant }>;     // audio time of each pause
  consent: Array<{ deviceId: DeviceId; id: Ulid }>;                          // consent lines relied on (§8.5)
  import?: { fileName: string; mime: string; hadVideo: boolean };           // mode == "import"
  duplicateOf?: Ulid;               // "Mark as duplicate of …" (critique R22); never transcribed automatically (sync spec §14.2)
  updatedAt: Instant;
}
```

- Writer: the recorder device (or the importing device). It rewrites the file only to change `title`,
  `audio`/`audioDeletedAt`, or `duplicateOf`. A member may have renamed or moved the lecture directory, so every
  write relative to a manifest (this file, `audio.webm`, `transcript.*`) first finds the directory by the manifest's
  `id` and never creates missing parent directories; if the directory is gone, the writer re-runs discovery.
- Markers are **not** in `lecture.json` (they are private; shared copies are in §8.11).
- Peers may receive `lecture.json` before `audio.webm` (Syncthing does not order files). A device MUST
  NOT start transcribing until the local `audio.webm` has exactly `audio.size` bytes and SHA-256
  `audio.sha256`.
- If the recorder has left and an organiser removed the audio, readers honour the mod line
  `audio-removed` (§8.18) as if `audio` were `null`.

```json
{
  "format": "tramado.lecture",
  "version": 1,
  "id": "01JBX4Q7Z5W8M2E3C9R6T0YH2K",
  "idNonce": "h7c2pq5x3m4kzw6n2v7bjr4yta",
  "title": "Aula 7 — Responsabilidade civil",
  "startedAt": "2026-11-03T10:15:02.000Z",
  "durationMs": 5402320,
  "mode": "room",
  "language": "pt-PT",
  "recordedBy": { "memberId": "k3q7mzx2v4hbtnw5r6yjc2aefg", "deviceId": "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2", "name": "Ana Ribeiro" },
  "audio": { "file": "audio.webm", "shared": true, "codec": "opus", "container": "webm", "sampleRate": 16000,
             "channels": 1, "bitrate": 24000, "size": 7148032, "sha256": "9f2c…(64 hex)" },
  "channels": [ { "index": 0, "speaker": "lecture" } ],
  "pauses": [ { "atMs": 2701000, "wallFrom": "2026-11-03T11:00:03.000Z", "wallTo": "2026-11-03T11:10:41.000Z" } ],
  "consent": [ { "deviceId": "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2", "id": "01JA0C2Y6R2W0G5QYV4X7K9M1T" } ],
  "updatedAt": "2026-11-03T11:46:10.221Z"
}
```

### 8.7 `audio.webm`

WebM (Matroska) with one Opus track: 16 kHz input, mono 24 kbps (16 kbps with "storage saver") or stereo 32 kbps (L = me, R = class),
60 ms packets, `CodecDelay` = pre-skip, Cues for seeking (`audio-pipeline §2.7`). It is written once
(staged in `.tramado/tmp/`, then renamed) and **never modified**. Replacing it is a delete plus a new
lecture. The Ogg recording journal is private and never in the class folder.

### 8.8 `transcript.json`, `transcript.md`, `transcript.vtt`

```ts
interface TranscriptFile {
  format: "tramado.transcript";
  version: 1;
  lectureId: Ulid;
  round: number;                     // transcription round (re-transcribe = new round, sync spec §14.7)
  revision: number;                  // 1 after transcription; +1 at every fold of edits
  audioSha256: Hex64 | null;         // the audio it was made from; null for imported text transcripts
  language: Lang;
  writer: { deviceId: DeviceId; memberId: MemberId };    // current transcript owner
  transcribedBy: { deviceId: DeviceId; memberId: MemberId; name: string; at: Instant };
  engine: {
    kind: "local" | "cloud" | "import";
    name: string;                    // "whisper.cpp", "openrouter", "vtt"
    version?: string;                // "1.8.3"
    model?: string;                  // local: the ggml file stem, "ggml-large-v3-turbo-q5_0"; cloud: "openai/whisper-large-v3-turbo"
    modelId?: ModelId;               // local only: the registry id, "turbo" (§2)
    modelSha256?: Hex64;
    vad?: string;                    // "silero-v5.1.2"
  };
  speakers: Array<{ id: string; label: string }>;        // ids: "lecture" | "me" | "class" | "spk_<n>"
  segments: Segment[];               // sorted by startMs
  folded: Record<DeviceId, Hlc>;     // per device: HLC of the last edit line folded into this file (§8.9)
  updatedAt: Instant;
}

interface Segment {
  id: SegmentId;
  startMs: number;
  endMs: number;
  speaker: string;                   // a speakers[].id
  text: string;
  words?: Array<{ startMs: number; endMs: number; text: string; p: number /* 0..1 */ }>;  // only if available
  merged?: SegmentId[];              // ids merged into this one (old anchors redirect here)
  editHlc?: { text?: Hlc; speaker?: Hlc };               // HLC of the last folded edit per field (LWW)
}
```

Rules:

- Writer: the **transcript owner** = the device in `writer.deviceId`. It is first the winner of the
  transcription claim, later possibly (v1.1) the winner of a fold claim (§8.10, sync spec §14.8). It is also
  the only writer of `transcript.md` and `transcript.vtt`, which it regenerates (debounced 5 s) whenever
  `transcript.json` changes. A device that is not the winner of the current round never writes `transcript.*`
  for that round, even when its own job finished (sync spec §14.5).
- Order of publication: `transcript.json` first, then `.md` and `.vtt`, then the claim status `done`.
- A transcript whose `audioSha256` differs from `lecture.json`'s `audio.sha256` is **stale** and is shown
  with a warning.
- `transcript.md` and `transcript.vtt` are for people and other tools. Tramado reads only the JSON.
  Editing them by hand has no effect: they are overwritten.

`transcript.md`, exactly (labels in Portuguese when the transcript `language` matches `pt` (any region), in Spanish
when it matches `es`, otherwise in English; §2 `Lang` matching):

```markdown
<!-- Generated by Tramado from transcript.json (revision 3). Edits to this file are overwritten. -->
# Aula 7 — Responsabilidade civil

*2026-11-03 · 1:30:02 · gravado por Ana Ribeiro · whisper.cpp large-v3-turbo*

**[00:00:12] Professor:** Vamos ver o artigo 483.º do Código Civil. O primeiro pressuposto é o facto voluntário.

**[00:01:05] Professor:** …
```

A paragraph joins consecutive segments of the same speaker until there is a gap of 2 s or more, or the
paragraph reaches 60 s. The timestamp is the first segment's `startMs` as `HH:MM:SS`. The speaker
label is the `speakers[].label`.

`transcript.vtt`, exactly (one cue per segment; cue identifier = segment id; `&`, `<`, `>` escaped as
`&amp;`, `&lt;`, `&gt;`; the sequence `-->` inside text is written `--&gt;`):

```
WEBVTT

s_8k2Lq
00:00:12.340 --> 00:00:17.810
<v Professor>Vamos ver o artigo 483.º do Código Civil.
```

### 8.9 `.tramado/edits/<lectureId>/<deviceId>.jsonl` (transcript corrections)

Any member may correct a transcript. Corrections are operations in the editor's own log; the transcript
owner folds them into `transcript.json`. Tramado 0.1 shows transcripts read-only and writes no edit lines
(architecture §1.1); readers still apply lines written by newer apps exactly as below.

```ts
interface TranscriptEditLine {
  format: "tramado.transcript-edit";
  version: 1;
  id: Ulid;
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;
  lectureId: Ulid;
  round: number;                 // the transcript round this edit applies to; other rounds ignore it
  baseRevision: number;          // the transcript revision the editor was looking at
  op: "set_text" | "set_speaker" | "split" | "merge" | "label_speaker";
  segment?: SegmentId;           // all ops except label_speaker
  base?: Hex40;                  // set_text: SHA-1 of the segment text being replaced
  text?: string;                 // set_text: new text
  speaker?: string;              // set_speaker: a speakers[].id
  atChar?: number;               // split: UTF-16 offset in the segment text where the new segment starts
  atMs?: number;                 // split: start time of the new segment
  newId?: SegmentId;             // split: id of the new (second) segment
  with?: SegmentId;              // merge: the following segment, merged into `segment`
  speakerId?: string;            // label_speaker: which speaker
  label?: string;                // label_speaker: new label, ≤ 40 chars
}
```

**Effective transcript** (computed identically by the owner when folding and by every reader for display):

```
effective(transcript, logs):
  ops = all trusted lines from all edits/<lectureId>/*.jsonl
        where op.round == transcript.round
        and op.hlc > transcript.folded[device of the log] (or the device has no entry)
  sort ops by hlc
  for op in ops:
    seg = find(op.segment), following `merged` redirects (a merged-away id maps to the segment that absorbed it)
    if op needs a segment and seg is missing: drop op (record in diagnostics)
    switch op.op:
      set_text:      if op.hlc > (seg.editHlc.text ?? ""): seg.text = op.text; seg.editHlc.text = op.hlc
                     if op.base != sha1(old text): mark seg "edited concurrently — review"
      set_speaker:   if op.hlc > (seg.editHlc.speaker ?? ""): seg.speaker = op.speaker; seg.editHlc.speaker = op.hlc
      split:         if 0 < op.atChar < len(seg.text) and op.newId unused:
                       new = {id: op.newId, startMs: op.atMs, endMs: seg.endMs, speaker: seg.speaker,
                              text: seg.text[op.atChar:].trim()}
                       seg.text = seg.text[:op.atChar].trim(); seg.endMs = op.atMs; insert new after seg
                       (words are split at op.atMs)
      merge:         w = find(op.with); if w exists and w != seg:
                       seg.text = seg.text + " " + w.text; seg.endMs = max(seg.endMs, w.endMs)
                       seg.merged += [w.id] + (w.merged ?? []); remove w
      label_speaker: speakers[op.speakerId].label = op.label   (LWW by hlc per speaker)
  return transcript
```

**Fold** (owner only, debounced 5 minutes after the last new edit): write `effective(...)` as the new
`transcript.json` with `revision + 1` and `folded[d]` = the greatest folded HLC of each device `d`, then
regenerate `.md` and `.vtt`. Edit logs are never truncated in v1 (they are small, and annotation anchors
replay them).

### 8.10 `.tramado/claims/<lectureId>/<deviceId>.json` and `claims/<lectureId>.fold/<deviceId>.json`

The claim files of the "only one person transcribes" protocol. The algorithm is in sync spec §14; this
is the file format.

```ts
interface ClaimFile {
  format: "tramado.claim";
  version: 1;
  kind: "transcribe" | "fold";       // "transcribe" lives in claims/<lectureId>/, "fold" in claims/<lectureId>.fold/
  lectureId: Ulid;
  round: number;                     // ≥ 1; claims of older rounds are ignored
  deviceId: DeviceId;
  memberId: MemberId;
  claimedAt: EpochMs;                // max(local now, greatest claimedAt seen for this lecture + 1)
  status: "claimed" | "working" | "done" | "released" | "failed";
  heartbeat: number;                 // +1 at every rewrite while claimed or working
  updatedAt: Instant;                // display only; never used to judge staleness
  audioSha256: Hex64 | null;         // transcribe: the audio being transcribed
  engine?: { kind: "local" | "cloud"; model: string };
  progress?: number;                 // 0..1
  etaMs?: number;
  supersedes?: Array<{ deviceId: DeviceId; heartbeat: number }>;   // stale claims this claim takes over
  error?: string;                    // status "failed": an error code from the shared taxonomy
  finishedAt?: Instant;              // status "done"
  transcriptRevision?: number;       // status "done"
}
```

`engine.model` is a registry `ModelId` (§2) for `local` and the OpenRouter model id for `cloud`.

Retention: a device that loses deletes its claim at once. The current transcript owner keeps its latest `done`
claim (transcribe or fold, about 400 bytes) for as long as that claim names the current `transcript.json`
`writer` and `round`; a `done` claim superseded by a later round or owner is deleted after 7 days. A `failed` or
`released` claim is deleted after 24 hours.

```json
{"format":"tramado.claim","version":1,"kind":"transcribe","lectureId":"01JBX4Q7Z5W8M2E3C9R6T0YH2K","round":1,
 "deviceId":"TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT","memberId":"b6xq2l4p7vjk3m5n2c7hzr4wte",
 "claimedAt":1793721438157,"status":"working","heartbeat":14,"updatedAt":"2026-11-03T12:10:38.157Z",
 "audioSha256":"9f2c…","engine":{"kind":"local","model":"turbo"},"progress":0.4,"etaMs":1500000}
```

### 8.11 `.tramado/markers/<lectureId>/<deviceId>.json` (shared markers, opt-in)

Markers are private by default (app data). Only when the student turns on "Share my markers" does the
device write this file (v1.1; Tramado 0.1 keeps markers private and does not write it).

```ts
interface MarkersFile {
  format: "tramado.markers";
  version: 1;
  lectureId: Ulid;
  deviceId: DeviceId;
  memberId: MemberId;
  hlc: Hlc;
  markers: Array<{
    id: Ulid;
    atMs: number;                    // audio time the marker points at (raw tap time minus the reflex offset)
    rawMs: number;                   // audio time of the tap
    kind: "important" | "confused" | "exam" | "todo" | "note";   // readers show any other value as "note"
    note?: string;                   // ≤ 200 chars
  }>;
}
```

### 8.12 `exam.json` (exam manifest and questions)

```ts
interface ExamFile {
  format: "tramado.exam";
  version: 1;
  id: Ulid;                                         // = itemId(creation ms, importedBy.deviceId, idNonce), §2.1
  idNonce: Nonce;
  title: string;                                    // 1–200 chars
  type: "quiz" | "test" | "midterm" | "final" | "resit" | "special" | "oral" | "practice" | "assignment" | "other";
                                                    // readers MUST read the 1.0 value "exam" as "final"
  status: "upcoming" | "paper";                     // upcoming = a date to count down to; paper = has questions
  date: LocalDateTime | null;
  allDay: boolean;                                  // true = no time was given; `date` is local midnight of that day
  durationMin: number | null;
  room: string | null;                              // ≤ 80 chars
  weight: number | null;                            // percentage of the final grade, 0–100, when it is a plain number
  weightText: string | null;                        // ≤ 20 chars, as the student typed it ("40 %", "2 valores"); shown when set
  academicYear?: string;                            // e.g. "2025/26"
  covers: Array<{ kind: "lecture"; lectureId: Ulid } | { kind: "document"; path: ClassPath; sha256: Hex64 }>;
  coversText: string | null;                        // ≤ 500 chars, free text ("Aulas 1–8; arts. 1.º–24.º")
  rules: string[];                                  // e.g. "Permitida a consulta de legislação não anotada"
  scale: { max: number; unit: string } | null;      // e.g. { "max": 20, "unit": "valores" }
  extraPoints?: Array<{ label: string; points: number }>;   // printed bonus or "presentation" points, label ≤ 80 chars
  files: Array<{ path: ClassPath; sha256: Hex64; size: number; mime: string; pages?: number }>;
  importedBy: { memberId: MemberId; deviceId: DeviceId; name: string };
  createdAt: Instant;
  extraction: null | {
    method: "pdf-text" | "docx" | "ocr" | "typed";
    model?: string;                                 // model that extracted (and OCR'd) the questions
    at: Instant;
    reviewedAt: Instant | null;                     // the mandatory review screen was confirmed
    reviewedBy: MemberId | null;
  };
  questions: Question[];                            // flat list in display order; tree via `parent`
  revision: number;                                 // +1 at every rewrite
  examFieldHlc?: Record<string, Hlc>;               // LWW stamps of folded exam-level edits
  folded: Record<DeviceId, Hlc>;                    // per device: last exam-edit line folded in (§8.13)
  updatedAt: Instant;
}

interface Question {
  id: QuestionId;
  number: string;                 // label as printed: "1", "2", "2a", "II", "II.a"
  parent: QuestionId | null;      // container question, if any
  group: string | null;           // group heading as printed, e.g. "Grupo II"
  kind: "case" | "essay" | "short" | "multiple_choice" | "true_false" | "comment" | "calculation" | "other" | "container";
  text: string;                   // verbatim question text, without the number and the points
  points: number | null;          // for a container: its total
  options: Array<{ key: string; text: string }>;   // multiple_choice: [{"key":"A","text":"…"}]; otherwise []
  choose: number | null;          // container only: "answer `choose` of the children" (choose-N groups)
  source: { file: ClassPath; page: number } | null; // where the question is printed (physical page, 1-based)
  answerKey: string | null;       // official answer if known (e.g. "B", "Verdadeiro"), ≤ 2 000 chars
  fieldHlc?: Record<string, Hlc>; // LWW stamps of folded edits per field
}
```

- Writer: the importer device. It rewrites `exam.json` when its own user edits the exam and when it folds
  exam-edits (debounced 5 minutes). Manifest-relative writes find the exam directory by `id` first (§8.6).
- Container questions (`kind: "container"`) are not answered themselves; their children are.
- `status: "upcoming"` entries have `questions: []` and usually no `files`.

```json
{
  "format": "tramado.exam", "version": 1,
  "id": "01JC1T9WQ2N8B5V3H7X4M6R0ZE", "idNonce": "z2k7m4q9x3v5bnw6r2yjc7hefa",
  "title": "TGDC — Exame época normal — 2025/06/20",
  "type": "final", "status": "paper",
  "date": "2025-06-20T09:00:00+01:00", "allDay": false, "durationMin": 120, "room": null, "weight": 60, "weightText": null, "academicYear": "2024/25",
  "covers": [], "coversText": null, "rules": ["Permitida a consulta de legislação não anotada"],
  "scale": { "max": 20, "unit": "valores" },
  "files": [ { "path": "Exames/TGDC — Exame época normal — 2025-06-20/exame.pdf", "sha256": "41aa…", "size": 182311, "mime": "application/pdf", "pages": 2 } ],
  "importedBy": { "memberId": "b6xq2l4p7vjk3m5n2c7hzr4wte", "deviceId": "TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT", "name": "Bruno Costa" },
  "createdAt": "2026-11-02T20:01:13.004Z",
  "extraction": { "method": "pdf-text", "model": "google/gemma-4-31b-it:free", "at": "2026-11-02T20:01:40.000Z", "reviewedAt": "2026-11-02T20:03:02.000Z", "reviewedBy": "b6xq2l4p7vjk3m5n2c7hzr4wte" },
  "questions": [
    { "id": "q_7fK2aZ", "number": "I", "parent": null, "group": "Grupo I", "kind": "case", "text": "António vendeu a Bento…", "points": 8, "options": [], "choose": null, "source": { "file": "Exames/TGDC — Exame época normal — 2025-06-20/exame.pdf", "page": 1 }, "answerKey": null },
    { "id": "q_Lm3p9Q", "number": "II", "parent": null, "group": "Grupo II", "kind": "container", "text": "Responda a duas das três questões seguintes.", "points": 6, "options": [], "choose": 2, "source": { "file": "Exames/TGDC — Exame época normal — 2025-06-20/exame.pdf", "page": 1 }, "answerKey": null },
    { "id": "q_x81Fae", "number": "II.a", "parent": "q_Lm3p9Q", "group": "Grupo II", "kind": "short", "text": "Distinga erro-vício de erro na declaração.", "points": 3, "options": [], "choose": null, "source": { "file": "Exames/TGDC — Exame época normal — 2025-06-20/exame.pdf", "page": 1 }, "answerKey": null }
  ],
  "revision": 1, "folded": {}, "updatedAt": "2026-11-02T20:03:02.000Z"
}
```

### 8.13 `.tramado/exam-edits/<examId>/<deviceId>.jsonl` (question corrections)

Members other than the importer correct questions and exam details here. The importer folds them into
`exam.json`; readers apply unfolded lines for display, exactly like transcript edits. Tramado 0.1 writes no
exam-edit lines (only the importer edits an exam, architecture §1.1); readers apply them.

```ts
interface ExamEditLine {
  format: "tramado.exam-edit";
  version: 1;
  id: Ulid;
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;
  examId: Ulid;
  baseRevision: number;
  op: "set_exam" | "set_question" | "add_question" | "delete_question";
  field?: string;          // set_exam: one of title,type,status,date,allDay,durationMin,room,weight,weightText,academicYear,
                           //           covers,coversText,rules,scale,extraPoints
                           // set_question: one of number,parent,group,kind,text,points,options,choose,source,answerKey
  value?: unknown;         // the new value, same type as in §8.12
  questionId?: QuestionId; // set_question, delete_question
  question?: Question;     // add_question (a new, unused id)
  after?: QuestionId | null; // add_question: insert after this question (null = at the start)
}
```

Merge: sort all unfolded lines by HLC; `set_*` is LWW per (question, field) against `fieldHlc` /
`examFieldHlc`; `delete_question` is final (a deleted id never comes back; deleting a container deletes
its children); `add_question` with an id already present is ignored.

### 8.14 `.tramado/answers/<examId>/<deviceId>.json` (shared AI answers)

AI answers are shared so that classmates don't spend their own free quota answering again
(`critique G11`). One file per device per exam; it holds the latest answer of this device for each
question.

```ts
interface AnswersFile {
  format: "tramado.answers";
  version: 1;
  examId: Ulid;
  deviceId: DeviceId;
  memberId: MemberId;            // who asked
  hlc: Hlc;
  updatedAt: Instant;
  answers: Answer[];             // at most one per questionId
}

interface Answer {
  id: Ulid;
  questionId: QuestionId;
  questionSha1: Hex40;           // SHA-1 of the question text answered; a different current text = "question changed since"
  examRevision: number;
  hlc: Hlc;
  at: Instant;
  text: string;                  // Markdown with [S#] citation markers (§8.15); ≤ 20 000 chars
  citations: Citation[];
  choice?: string;               // multiple_choice / true_false: the chosen key, e.g. "B"
  generalKnowledge: Array<[number, number]>;   // UTF-16 ranges of `text` not supported by any source (shown as "not in your materials")
  model: string;                 // the model that actually answered, e.g. "dots-studio/dots-3-note-preview:free"
  requestedModel: string;        // the first model of the chain
  privacy: "standard" | "no-training" | "zdr" | "custom-host";
  mode: "quick" | "deep";
  scope: "materials" | "materials+general";
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
}
```

Private marks ("right / partly / wrong") are **not** here; they stay in app data.

### 8.15 Citations and locators (shared object)

Used in AI answers (§8.14), AI chat replies (§8.16) and annotations (§8.17). A citation must survive
renamed and changed files (`critique G13`), so it stores the path **and** the content hash **and** a
quote.

```ts
interface Citation {
  ref: string;                   // marker used in the text: "S1", "S2", …  (regex ^S\d{1,3}$)
  source: SourceRef;
  locator: Locator;
  quote: TextQuote | null;
  pin?: string;                  // pin-point text from the marker, e.g. "n.º 3" in "[S4, n.º 3]"
  label: string;                 // human label at creation time, e.g. "Código Civil.pdf · p. 52 · art. 251.º"
}

type SourceRef =
  | { kind: "document"; path: ClassPath; sha256: Hex64 }
  | { kind: "lecture";  lectureId: Ulid; audioSha256: Hex64 | null; transcriptRevision: number }
  | { kind: "exam";     examId: Ulid; questionId?: QuestionId }
  | { kind: "note";     path: ClassPath; sha256: Hex64 };

type Locator =
  | { type: "page";    page: number; pageLabel?: string }                 // physical page, 1-based; printed label if different
  | { type: "article"; article: string; pages: [number, number] | null }  // "483.º", "251.º-A"; physical page range
  | { type: "slide";   slide: number }                                    // 1-based
  | { type: "segment"; segmentId: SegmentId; startMs: number; endMs: number; charStart?: number; charEnd?: number }
  | { type: "heading"; path: string[]; paragraph?: number }               // DOCX/MD: heading path, 1-based paragraph under it
  | { type: "text";    start: number; end: number; extractor: string }   // offsets in the extracted text of `extractor` version
  | { type: "whole" };

interface TextQuote { exact: string; prefix: string; suffix: string }  // exact ≤ 300 chars; prefix/suffix ≤ 32 chars
```

**Citation markers in text** are `[S#]`, never `[1]` (law texts contain literal `[1]` footnotes). Lists
and pin-points are allowed: `[S1]`, `[S1, S4]`, `[S4, n.º 3]`. Parse with:

```
/\[(S\d+(?:\s*,\s*S\d+)*)(?:\s*,\s*([^\]]{1,40}))?\]/g     # group 1: refs, group 2: pin-point
```

A ref that has no entry in `citations` is a hallucinated citation: render it struck through.
UIs number the chips 1..n in order of first appearance.

**Resolving** a citation: (1) by `source.path` (or `lectureId`/`examId`) if that file's SHA-256 still
equals `source.sha256`; (2) else by SHA-256 anywhere in the class (the file was moved or renamed);
(3) else by searching `quote.exact` (disambiguated by `prefix`/`suffix`) in the class index, flagging
"the source changed since this answer"; (4) else show the `label` greyed out as "source not found".
For lectures, a `segment` locator re-anchors through `merged` redirects and the quote; playback always
works from `startMs` because the audio never changes.

### 8.16 `.tramado/chat/<deviceId>/<YYYY-MM>.jsonl` (class chat)

Append-only, one file per device per month. `YYYY-MM` is the UTC month of the `ms` part of the line's **HLC**
(which is never behind anything the device has observed, so a device with a slow clock does not write into an old
month). Past months are never appended to; lines that edit, delete or react to an old message go into the current
month.

```ts
interface ChatBase {
  format: "tramado.chat";
  version: 1;
  type: "message" | "edit" | "delete" | "reaction" | "thanks" | "ai";
  id: Ulid;                      // unique id of this line
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;            // MUST be the person bound to the device in the path (§6.2 rule 6)
  redacted?: true;               // see "Deleting" below
}
interface MsgRef { deviceId: DeviceId; id: Ulid }   // a message is addressed by its author device + line id

interface ChatMessage extends ChatBase {
  type: "message";
  text: string;                  // Markdown-lite (bold, italic, lists, code, links); ≤ 8 000 chars; tokens below
  replyTo?: MsgRef;
  mentions?: Array<MemberId | "everyone" | "ai">;   // must match the <@…> tokens in text
  attachments?: Array<{ path: ClassPath; name: string; size: number; sha256: Hex64; mime: string }>;  // ≤ 10
}
interface ChatEdit     extends ChatBase { type: "edit";   target: MsgRef; text: string; mentions?: ChatMessage["mentions"] }
interface ChatDelete   extends ChatBase { type: "delete"; target: MsgRef }
interface ChatReaction extends ChatBase { type: "reaction"; target: MsgRef; emoji: string; op: "add" | "remove" }  // emoji: one grapheme, ≤ 16 bytes
interface ChatThanks   extends ChatBase { type: "thanks"; to: MemberId; lectureId: Ulid }   // "👏 Thank Ana for transcribing"
interface ChatAi       extends ChatBase {
  type: "ai";
  replyTo?: MsgRef;              // the question message ("@AI …"), when the question was asked in chat
  question?: string;             // ≤ 2 000 chars; REQUIRED when replyTo is absent (an answer posted from Ask)
  status: "ok" | "error";
  text: string;                  // answer with [S#] markers; "" when status is "error"
  citations: Citation[];
  model: string;                 // model that answered
  requestedModel: string;
  privacy: "standard" | "no-training" | "zdr" | "custom-host";
  error?: string;                // error code when status is "error"
}
```

**Tokens in `text`:** `<@k3q7mzx2v4hbtnw5r6yjc2aefg>` (a member), `<@everyone>`, `<@ai>`. Readers that
do not render tokens show the member's display name. `@everyone` notifies only when the author was an
organiser at the line's HLC.

**Semantics:**

- A message is identified by `(deviceId of its file, id)`; two lines with the same `id` in different devices'
  files are two different messages.
- Display order: by display key, then by the tie-break of §3.2. The display key of a message is its `hlc`; for a
  reply whose parent is loaded it is `max(hlc, succ(parent's display key))`, so a reply never shows above its
  parent. Displayed time: `ms`. A sender whose stamps are more than 5 minutes ahead of the reader's clock gets the
  clock hint of §3.4 on its lines.
- `edit`, `delete`: honoured only if the target message's author device is bound to the same `memberId`
  as the line's device (a person may edit from another of their computers). The edit with the greatest
  HLC wins. `delete` is final and beats every edit.
- `reaction`: state per (reacting member, target, emoji) is the line with the greatest HLC (`add` or
  `remove`).
- `ai`: written by the **asker's** device only, after it ran the request with its own key, using shared
  class materials only (an answer that cites the asker's private notes is never posted).
- **Attachments** are copied first into `<documents>/<fromChat>/` (sanitised, unique names); the chat
  line references them by path and hash.
- **Deleting "for everyone":** the author appends `delete`, then SHOULD redact the original line by
  rewriting its month file (whole-file atomic write; the file stays single-writer) with that line
  replaced by `{"format","version","type":"message","id","hlc","ms","memberId","redacted":true}`.
  Readers treat `redacted` lines as deleted. Syncthing's trashcan on other devices keeps the
  pre-redaction copy of the file until that file next changes (at most one older copy per path).
- Readers load the two most recent months of every device, any month file that changes (whatever its month),
  and older months on demand. An `edit`, `delete` or `reaction` whose target is not loaded yet is kept and applied
  when it is.
- Tramado 0.1 writes `message`, `edit`, `delete`, `thanks` and `ai` lines; it reads `reaction` lines but writes
  them from v1.1 (architecture §1.1).

```
{"format":"tramado.chat","version":1,"type":"message","id":"01JBXA7D1W3Q8K5N2M9R4T6Y0C","hlc":"001793721438157-00000-ab4z76w","ms":1793721438157,"memberId":"k3q7mzx2v4hbtnw5r6yjc2aefg","text":"<@ai> o que disse o professor sobre a reserva mental?","mentions":["ai"]}
{"format":"tramado.chat","version":1,"type":"ai","id":"01JBXA7J0P5E2V7C9B3N8M1K4Q","hlc":"001793721447902-00000-ab4z76w","ms":1793721447902,"memberId":"k3q7mzx2v4hbtnw5r6yjc2aefg","replyTo":{"deviceId":"AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2","id":"01JBXA7D1W3Q8K5N2M9R4T6Y0C"},"status":"ok","text":"Na aula 6 o professor definiu a reserva mental como … [S1]. O art. 244.º CC … [S2, n.º 2].","citations":[{"ref":"S1","source":{"kind":"lecture","lectureId":"01JBX4Q7Z5W8M2E3C9R6T0YH2K","audioSha256":"9f2c…","transcriptRevision":3},"locator":{"type":"segment","segmentId":"s_8k2Lq","startMs":2472000,"endMs":2479500},"quote":{"exact":"a reserva mental é a divergência intencional","prefix":"portanto ","suffix":" entre"},"label":"Aula 6 · 41:12"},{"ref":"S2","source":{"kind":"document","path":"Documentos/Código Civil.pdf","sha256":"77d0…"},"locator":{"type":"article","article":"244.º","pages":[52,52]},"quote":null,"label":"Código Civil.pdf · p. 52 · art. 244.º"}],"model":"google/gemma-4-31b-it:free","requestedModel":"google/gemma-4-31b-it:free","privacy":"no-training"}
```

### 8.17 `.tramado/annotations/<deviceId>/<YYYY-MM>.jsonl` (shared comments and highlights)

Only annotations a student explicitly shares ("👥 Class"). Same month rule as chat.

```ts
interface AnnotationLine {
  format: "tramado.annotation";
  version: 1;
  type: "add" | "edit" | "delete";
  id: Ulid;                      // id of this line
  annotationId: Ulid;            // = id for "add"; the annotation edited/deleted otherwise
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;
  kind?: "comment" | "highlight";             // add
  target?: { source: SourceRef; locator: Locator; quote: TextQuote };   // add
  colour?: "important" | "confused" | "exam" | "todo" | "other";        // highlight colour by meaning
  body?: string;                 // comment text, Markdown-lite, ≤ 8 000 chars (add, edit)
  ai?: { model: string };        // add: written by "Annotate with AI"; rendered in the AI style with the model's name
}
```

The same line shape is used for **private** annotations, which stay in app data (architecture §13.2). Tramado
0.1 writes private annotations only; shared annotation files are written and displayed from v1.1.

Edit/delete rules are the same as chat (author's person only; greatest HLC wins; delete is final).
Re-anchoring follows `audio-pipeline §5.5`: exact quote in the segment, then nearest occurrence,
then fuzzy match, then the time range (marked "approximate").

### 8.18 `.tramado/mod/<deviceId>.jsonl` (moderation log)

```ts
interface ModLine {
  format: "tramado.mod";
  version: 1;
  type: "pin" | "unpin" | "hide" | "unhide" | "audio-removed" | "rotate";
  id: Ulid;
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;
  target?: MsgRef;               // pin, unpin, hide, unhide
  lectureId?: Ulid;              // audio-removed
  reason?: string;               // ≤ 200 chars
  newClassIdSha256?: Hex64;      // rotate: SHA-256 of the UTF-8 new ClassId (the ID itself is never written here)
  newLabel?: string;             // rotate
  excluded?: Array<{ memberId: MemberId; deviceIds: DeviceId[] }>;   // rotate: who is left out (device IDs are not secret)
  sig: Sig;                      // §6.6, every line
}
```

Tramado 0.1 writes no mod lines (pins, hides, audio removal by organisers and rotation are v1.1, architecture
§1.1); readers honour the lines below.

| Line | Honoured when written by | Effect |
|---|---|---|
| `pin` | any member | Message shown in the pins strip. |
| `unpin` | the member who pinned it, or an organiser | Removes the pin. State per target = greatest HLC among honoured pin/unpin lines. |
| `hide` / `unhide` | an organiser | Hides the message for everyone ("hidden by an organiser"). From a non-organiser it is shown to organisers only, as a suggestion. |
| `audio-removed` | an organiser or the recorder's person | Readers treat `lecture.json.audio` as `null` and may delete `audio.webm`. Used when the recorder has left. |
| `rotate` | an organiser | Announces that the class moved to a new class ID (sync spec §18.2). |

### 8.19 `.tramado/bans/<deviceId>.json` (soft ban list)

```ts
interface BansFile {
  format: "tramado.bans";
  version: 1;
  deviceId: DeviceId;
  memberId: MemberId;
  hlc: Hlc;
  updatedAt: Instant;
  entries: Array<{
    target: { deviceId: DeviceId } | { memberId: MemberId };
    state: "banned" | "unbanned";
    hlc: Hlc;
    reason?: string;             // ≤ 200 chars
  }>;
  sig: Sig;                      // §6.6
}
```

Effective bans: an entry counts when the device whose file holds it was bound to a person who was an organiser
**at the entry's HLC** (§8.2 replay; a device that left keeps its last binding for entries stamped before it left,
so the bans of an organiser who graduates stay in force). Per target, the counting entry with the greatest HLC
decides. A banned `memberId` bans every device whose member file **claims** that `memberId`, bound or not. What
every member's app then does is in sync spec §18.1.

### 8.20 `.tramado/invites/<deviceId>.json` (reserved)

Reserved for v1.1 revocable invites (device-name token, `critique C8`). v1 writers MUST NOT create it;
v1 readers MUST ignore it.

### 8.21 Class notes and conflict copies

- Class notes are Markdown files (`*.md`, UTF-8) under the notes directory. Any member may edit any note.
  There is no machine format.
- Editors SHOULD save at most every 2 s, with an atomic write, and SHOULD set `presence.activity.editing`
  while a note is open, so others see "Bruno is editing this note".
- When two devices change the same note before syncing, Syncthing keeps one version under the original
  name and the other as `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>.<ext>` on every device.
  The `ShortId` in that name is **not** the author of the losing text. Tramado shows a compare dialog;
  sync spec §16 has the procedure.
- Conflict copies of machine files (anything under `.tramado/`, `lecture.json`, `exam.json`,
  `transcript.*`) are never shown. Their writer deletes them and rewrites the canonical file.

---

## 9. Deletion, retention and compaction

### 9.1 How each thing is removed

| What | How | "For everyone"? | Undo |
|---|---|---|---|
| Document, lecture directory, exam directory, note | Delete the files (Syncthing propagates the deletion). | Yes; the UI says so. | Syncthing trashcan on every member, 30 days (sync spec §22.1). |
| "Remove from this computer only" | Add a per-device ignore line, **then** delete the local copy (§11.2). | No. | Remove the ignore line. |
| Audio only ("delete audio, keep transcript") | Recorder deletes `audio.webm` and rewrites `lecture.json` with `audio: null`, `audioDeletedAt`. If the recorder has left: an organiser's `audio-removed` mod line. | Yes. | Trashcan. |
| Chat message, annotation | `delete` line (tombstone) + optional redaction of the original line. | Yes. | None. |
| My membership | Delete my `members/<me>.json` (sync spec §17). | — | Join again. |
| Claim | The claiming device deletes its file (§8.10). | — | — |
| Pins, hides, bans | Opposite line or entry with a greater HLC. | Yes. | Opposite line. |

### 9.2 Retention and growth

| File | Growth | Policy |
|---|---|---|
| `chat/<dev>/<YYYY-MM>.jsonl` | ~300 B per message | Monthly files; past months immutable except redaction. No compaction. |
| `annotations/<dev>/<YYYY-MM>.jsonl` | small | As chat. |
| `presence/<dev>.json` | overwritten | Writes only while active (§8.4). |
| `claims/…/<dev>.json` | one per claimant | §8.10 retention. |
| `edits/<lecture>/<dev>.jsonl`, `exam-edits/<exam>/<dev>.jsonl` | append-only | Folded by the owner; never truncated in v1. |
| `consent/<dev>.jsonl`, `mod/<dev>.jsonl` | append-only, tiny | Never truncated. |
| Files of a device that `left()` more than 30 days ago | — | **Any** member MAY delete that device's `presence`, `claims` and `markers` files. This is the only exception to single-writer, and it is safe because the writer has gone. A reader honours such a deletion only if it recorded `left()` of that device itself at least 30 days earlier (otherwise §6.2 rule 4 applies). `chat`, `annotations`, `meta`, `consent`, `mod`, `bans`, `edits`, `exam-edits` and `answers` are kept: they are history, or they still carry values readers rely on. |

---

## 10. Private data mirror and self-heal (summary)

Each device keeps a private copy of every machine file of 1 MiB or less that it writes (in app data,
architecture §13.2), except `transcript.*`, whose ownership can change hands (sync spec §14.5). For `audio.webm`
it keeps only `{size, sha256}`. When it sees a foreign write to, or a foreign deletion of, one of its own files
whose content differs from the mirror (SHA-256), it rewrites the canonical copy from the mirror; `audio.webm` is
restored from the local trashcan, which keeps the replaced version (sync spec §12.3). Claims and presence files
older than their retention (§8.10, §9.2) are never restored. Other tools never need to read the mirror.

---

## 11. Managed `.stignore`

`.stignore` is per device and is **not** synced. Tramado sets it over Syncthing's REST API on every
device at every start (it is idempotent), never through a synced include file (any member could edit
that and make everyone ignore files).

### 11.1 Managed block (exact)

```
// Tramado managed ignores (v1)
(?d).DS_Store
(?d)Thumbs.db
(?d)desktop.ini
(?d)._*
/.tramado/tmp
*.tmp
*.part
*.crdownload
(?d)~$*
(?d).~lock.*#
(?d)*.swp
```

Patterns without a leading `/` match at any depth (verified: Syncthing expands `*.tmp` to `*.tmp`,
`**/*.tmp`, `*.tmp/**`, `**/*.tmp/**`). `(?d)` lets Syncthing delete the ignored file when it blocks a
directory deletion.

### 11.2 Per-device additions

After the managed block, Tramado appends this device's own lines. It keeps their **inputs** in app data
(`classes.json`, architecture §5.1): `skipAudio: true` emits `(?d)/**/audio.webm`, and `localIgnores` holds class
paths, each emitted as `(?d)/` + path:

```
// Tramado per-device (v1)
// skip audio files
(?d)/**/audio.webm
// removed from this computer only
(?d)/Documentos/Código Civil anotado.pdf
```

- `(?d)/**/audio.webm` is present only when "Skip audio files" is on for this class on this device.
- "Remove from this computer only" adds one anchored line per path (`(?d)/` + class path).
- `.stignore` comments are lines starting with `//`; `#` does **not** start a comment (only the
  `#include` directive), so nothing may follow a pattern on its line.

### 11.3 User lines

Lines after `// User patterns (kept by Tramado)` are preserved unchanged. Everything above that marker
is rewritten by Tramado.

---

## 12. Private, per-device data (not part of the folder)

Not part of the format. Everything private lives in per-device app directories, never inside a class folder:
the identity and the person key, preferences, the class registry, AI keys, the Syncthing home, speech models,
recording journals, partial transcriptions, the HLC state, private notes, annotations, markers, marks, practice,
Ask history, the trust cache (with its kept copies of signed files, §6.2 rule 4), the self-heal mirror (§10) and
the caches. **Architecture §13** ("Caches, private data and preferences") is the single list of these files and
their exact shapes; this section only fixes where the three roots are. Paths use Tauri's directories for the
identifier `eu.thehumanloop.tramado`. When the environment variable `TRAMADO_DATA_DIR` is set, the three roots
become `$TRAMADO_DATA_DIR/config`, `…/data` and `…/cache` (development and end-to-end tests).

| Root | Linux | macOS | Windows |
|---|---|---|---|
| `app_config_dir` | `~/.config/eu.thehumanloop.tramado/` | `~/Library/Application Support/eu.thehumanloop.tramado/` | `%APPDATA%\eu.thehumanloop.tramado\` |
| `app_local_data_dir` | `~/.local/share/eu.thehumanloop.tramado/` | `~/Library/Application Support/eu.thehumanloop.tramado/` | `%LOCALAPPDATA%\eu.thehumanloop.tramado\` |
| `app_cache_dir` | `~/.cache/eu.thehumanloop.tramado/` | `~/Library/Caches/eu.thehumanloop.tramado/` | `%LOCALAPPDATA%\eu.thehumanloop.tramado\` |

---

## 13. Conformance checklist

A **reader** conforms if it: finds the class by `class.json`; finds lectures and exams by manifest;
skips the files of §4.5; ignores unknown fields and skippable values; handles newer versions as in §7.3;
merges per-device files as specified (LWW registers, HLC ordering, edit replay, tombstones); verifies
signatures, person proofs and derived IDs (§2.1, §6.6, §8.3.1); attributes records to the writer device's
person (§6.2 rule 6); and either checks authorship (§6.2) or labels content as unverified (§6.3).

A **writer** conforms if it also: writes only files whose writer it is (§6.1); uses atomic writes and
single-call appends (§4.4); sanitises names it creates (§5.4); keeps unknown fields when rewriting;
stamps HLCs as in §3 (including the override rule of §3.4); signs the records of §6.1; derives class, lecture
and exam IDs (§2.1); writes the version every roster member can read (§7.2); and never puts private
data in the class folder.

---

## 14. Open questions (each with the default v1 uses)

| # | Question | Default in v1 |
|---|---|---|
| 1 | Signatures on chat, edits, answers, annotations, claims, presence and manifests. | v1.1 (`sig` reserved, §6.5). v1 signs `class.json`, `meta`, `members`, `bans`, `consent` and `mod` (§6.6). |
| 2 | Should shared annotations ship in 0.1 or 1.1? | Format is defined now (§8.17). Readers SHOULD display trusted shared annotations read-only with the author's name; Tramado 0.1 neither writes nor displays them (v1.1). |
| 3 | Keep a history of AI answers per question instead of only the latest per device? | Only the latest per device and question. |
| 4 | Truncating edit logs after folding. | Never in v1. |
| 5 | A synced "private" folder per member for notes across own devices. | Not in v1 (a separate, unshared Syncthing folder in v1.1, outside this format). |
| 6 | Character offsets in locators and edits: UTF-16 code units vs code points. | UTF-16 code units (what JavaScript strings index), everywhere in this document. |
