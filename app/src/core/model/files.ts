// Every record type of the class folder format, transcribed from docs/spec/class-folder-v1.md §8
// (verbatim declarations, exported), plus the invite and pairing payloads of the sync spec (§7.1, §19)
// and the private per-device files of architecture §13. Storage shapes only: view models live in
// services/types/viewModels.ts. Frozen fields (format, version, deviceId, memberId, sig) never change.

import type {
  ClassId, ClassPath, ColourHex, DeviceId, EpochMs, Hex40, Hex64, Hlc, IconName, Instant, Lang, LocalDateTime,
  MemberId, ModelId, Nonce, QuestionId, SegmentId, ShortId, Ulid,
} from './ids';

/** Marker kinds (architecture §1.2): the one export; platform/types/speech.ts and viewModels.ts import it. */
export type MarkerKind = 'important' | 'confused' | 'exam' | 'todo' | 'note';
export const MARKER_KINDS: readonly MarkerKind[] = ['important', 'confused', 'exam', 'todo', 'note'];

// ── folder spec §6.6 ──
export interface Sig {
  cert: string;    // base64 (RFC 4648, padded) of the DER of the writer device's Syncthing certificate
  value: string;   // base64 of the 64-byte Ed25519 signature made with the device's Syncthing key
}

// ── folder spec §8.1 ──
export interface ClassFile {
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

// ── folder spec §8.2 ──
export interface Reg<T> { value: T; hlc: Hlc }

export interface MetaFile {
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

// ── folder spec §8.3 ──
export interface MemberFile {
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

// ── folder spec §8.3 ──
export interface PersonProof {
  pub: string;     // base64url (no padding) of the 32-byte person public key
  sig: string;     // base64url of Ed25519(person key, UTF-8("tramado-member-v1|" + classId + "|" + deviceId + "|" + memberId))
  revoked?: Array<{ deviceId: DeviceId; sig: string }>;   // v1.1: devices this person unbinds;
                   // sig over UTF-8("tramado-revoke-v1|" + classId + "|" + deviceId + "|" + memberId)
}

// ── folder spec §8.4 ──
export interface PresenceFile {
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

// ── folder spec §8.5 ──
export interface ConsentLine {
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

// ── folder spec §8.6 ──
export interface LectureFile {
  format: "tramado.lecture";
  version: 1;
  id: Ulid;                                        // = itemId(recording start ms, recordedBy.deviceId, idNonce), §2.1
  idNonce: Nonce;
  title: string;                                   // 1–200 chars
  startedAt: Instant;
  utcOffsetMin?: number;           // G2: the recorder's UTC offset at startedAt, minutes east (transcript.md's local date, §8.6)
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

// ── folder spec §8.8 ──
export interface TranscriptFile {
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
  speakers: Array<{ id: string; label: string; labelHlc?: Hlc }>;   // ids: "lecture" | "me" | "class" | "spk_<n>"; labelHlc: G2, §8.9
  segments: Segment[];               // sorted by startMs
  folded: Record<DeviceId, Hlc>;     // per device: HLC of the last edit line folded into this file (§8.9)
  updatedAt: Instant;
}

export interface Segment {
  id: SegmentId;
  startMs: number;
  endMs: number;
  speaker: string;                   // a speakers[].id
  text: string;
  words?: Array<{ startMs: number; endMs: number; text: string; p: number /* 0..1 */ }>;  // only if available
  merged?: SegmentId[];              // ids merged into this one (old anchors redirect here)
  editHlc?: { text?: Hlc; speaker?: Hlc };               // HLC of the last folded edit per field (LWW)
}

// ── folder spec §8.9 ──
export interface TranscriptEditLine {
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

// ── folder spec §8.10 ──
export interface ClaimFile {
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

// ── folder spec §8.11 ──
export interface MarkersFile {
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

// ── folder spec §8.12 ──
export interface ExamFile {
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

export interface Question {
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

// ── folder spec §8.13 ──
export interface ExamEditLine {
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

// ── folder spec §8.14 ──
export interface AnswersFile {
  format: "tramado.answers";
  version: 1;
  examId: Ulid;
  deviceId: DeviceId;
  memberId: MemberId;            // who asked
  hlc: Hlc;
  updatedAt: Instant;
  answers: Answer[];             // at most one per questionId
}

export interface Answer {
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

// ── folder spec §8.15 ──
export interface Citation {
  ref: string;                   // marker used in the text: "S1", "S2", …  (regex ^S\d{1,3}$)
  source: SourceRef;
  locator: Locator;
  quote: TextQuote | null;
  pin?: string;                  // pin-point text from the marker, e.g. "n.º 3" in "[S4, n.º 3]"
  label: string;                 // human label at creation time, e.g. "Código Civil.pdf · p. 52 · art. 251.º"
}

export type SourceRef =
  | { kind: "document"; path: ClassPath; sha256: Hex64 }
  | { kind: "lecture";  lectureId: Ulid; audioSha256: Hex64 | null; transcriptRevision: number }
  | { kind: "exam";     examId: Ulid; questionId?: QuestionId }
  | { kind: "note";     path: ClassPath; sha256: Hex64 };

export type Locator =
  | { type: "page";    page: number; pageLabel?: string }                 // physical page, 1-based; printed label if different
  | { type: "article"; article: string; pages: [number, number] | null }  // "483.º", "251.º-A"; physical page range
  | { type: "slide";   slide: number }                                    // 1-based
  | { type: "segment"; segmentId: SegmentId; startMs: number; endMs: number; charStart?: number; charEnd?: number }
  | { type: "heading"; path: string[]; paragraph?: number }               // DOCX/MD: heading path, 1-based paragraph under it
  | { type: "text";    start: number; end: number; extractor: string }   // offsets in the extracted text of `extractor` version
  | { type: "whole" };

export interface TextQuote { exact: string; prefix: string; suffix: string }  // exact ≤ 300 chars; prefix/suffix ≤ 32 chars

// ── folder spec §8.16 ──
export interface ChatBase {
  format: "tramado.chat";
  version: 1;
  type: "message" | "edit" | "delete" | "reaction" | "thanks" | "ai";
  id: Ulid;                      // unique id of this line
  hlc: Hlc;
  ms: EpochMs;
  memberId: MemberId;            // MUST be the person bound to the device in the path (§6.2 rule 6)
  redacted?: true;               // see "Deleting" below
}
export interface MsgRef { deviceId: DeviceId; id: Ulid }   // a message is addressed by its author device + line id

export interface ChatMessage extends ChatBase {
  type: "message";
  text: string;                  // Markdown-lite (bold, italic, lists, code, links); ≤ 8 000 chars; tokens below
  replyTo?: MsgRef;
  mentions?: Array<MemberId | "everyone" | "ai">;   // must match the <@…> tokens in text
  attachments?: Array<{ path: ClassPath; name: string; size: number; sha256: Hex64; mime: string }>;  // ≤ 10
}
export interface ChatEdit     extends ChatBase { type: "edit";   target: MsgRef; text: string; mentions?: ChatMessage["mentions"] }
export interface ChatDelete   extends ChatBase { type: "delete"; target: MsgRef }
export interface ChatReaction extends ChatBase { type: "reaction"; target: MsgRef; emoji: string; op: "add" | "remove" }  // emoji: one grapheme, ≤ 16 bytes
export interface ChatThanks   extends ChatBase { type: "thanks"; to: MemberId; lectureId: Ulid }   // "👏 Thank Ana for transcribing"
export interface ChatAi       extends ChatBase {
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

/** Every chat line (architecture §11.1: the union of the six). */
export type ChatLine = ChatMessage | ChatEdit | ChatDelete | ChatReaction | ChatThanks | ChatAi;

// ── folder spec §8.17 ──
export interface AnnotationLine {
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

// ── folder spec §8.18 ──
export interface ModLine {
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

// ── folder spec §8.19 ──
export interface BansFile {
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

// ── sync spec §7.1 ──
export interface InviteV1 {
  v: 1;
  f: ClassId;                          // the folder ID (the capability)
  l: string;                           // class name, ≤ 120 chars
  s?: string;                          // short name, ≤ 12
  c: ColourHex;                        // class colour
  i: IconName;                         // lucide icon
  lt?: string;                         // lecturer, ≤ 80
  tm?: string;                         // term, ≤ 40
  lg?: Lang;                           // language of lectures
  m: MemberId;                         // inviter
  n: string;                           // inviter display name, ≤ 64
  d: Array<{                           // 1–3 member devices to dial
    id: string;                        // dashless device ID, 56 chars [A-Z2-7]
    a: string[];                       // 0–5 addresses: tcp://, quic://, relay:// (with ?id=)
  }>;
  t: number;                           // created, Unix seconds
  x?: number;                          // advisory expiry, Unix seconds (§7.4)
}

// ── sync spec §19 (v1.1: the type exists so readers can recognise a pairing code) ──
export interface PairV1 {
  v: 1;
  m: MemberId;
  n: string;
  d: { id: string; a: string[] };
  pk: string;
  k: string;
  f: Array<{ f: ClassId; l: string; c: ColourHex; i: IconName }>;
  t: number;
  x: number;
}

// ── Private per-device files (architecture §13, folder spec §12) ──
export interface IdentityFile {
  format: 'tramado.identity'; version: 1;
  memberId: MemberId; name: string; deviceName: string; colour: ColourHex | null; personPub: string; createdAt: Instant;
}
export interface HlcFile { format: 'tramado.hlc'; version: 1; ceilingMs: number }
export interface TrustCacheEntry {
  sha256: Hex64; length: number; prefixSha256: Hex64; blocksHash: string; size: number; mtimeMs: number;
  hlc?: Hlc; deletedAt?: Instant;
}
export interface TrustCacheFile {
  format: 'tramado.trust-cache'; version: 1;
  files: Record<ClassPath, TrustCacheEntry>;
  pinnedTranscriptWriters: Record<Ulid, { deviceId: DeviceId; round: number }>;
  left: Record<DeviceId, { at: Instant; hlc: Hlc }>;
  vacated: MemberId[];
}
/** private/<classId>/markers/<lectureId>.json: the MarkersFile shape, kept on this computer only. */
export type PrivateMarkersFile = MarkersFile;
/** private/<classId>/exams/<examId>.json (architecture §13.2). */
export interface MarksFile {
  format: 'tramado.exam-private'; version: 1;
  myAnswers: Record<QuestionId, string>;
  correct: Record<QuestionId, string>;
  marks: Record<QuestionId, 'right' | 'partly' | 'wrong' | 'unsure'>;
  revealed: Record<QuestionId, true>;
  inPractice: Record<QuestionId, true>;
  hints: Record<QuestionId, { text: string; citations: Citation[]; model: string; at: Instant }>;
  practice: Record<QuestionId, { last: Instant; result: 'again' | 'gotIt'; count: number }>;
}
/** One line of private/<classId>/ask/<threadId>.jsonl (the AskTurn of services/types/ask.ts, stored). */
export interface AskHistoryLine {
  format: 'tramado.ask'; version: 1;
  id: Ulid; question: string;
  scope: { kinds: Array<SourceRef['kind']>; lectureId?: Ulid; docPath?: ClassPath };
  answer: string; citations: Citation[]; model: string | null; status: 'running' | 'ok' | 'error'; error: string | null; at: Instant;
}
