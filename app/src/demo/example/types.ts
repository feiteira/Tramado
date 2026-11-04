// The shapes of the fictional demo content (UX §7.3). Everything here is invented: people, laws, exams and
// lectures. `demo/seed.ts` turns these objects into spec-conformant class folders, private data and app files
// (folder spec §8, architecture §13); `example.test.ts` checks every citation, marker and route key.
//
// Times are local wall times in Europe/Lisbon written as `YYYY-MM-DDTHH:MM` (see `time.ts`): the demo's clock
// zone, so the fixtures read exactly as UX §7.3 lists them.
import type { ColourHex, IconName, Lang, ModelId, SegmentId } from '../../core/model/ids';
import type { MarkerKind } from '../../core/model/files';

export type { MarkerKind };

/** A member key of UX §7.3: `ana` is me (this computer). */
export type MemberKey = 'ana' | 'bruno' | 'carla' | 'jamie' | 'diogo';
export type ClassKey = 'law' | 'bio' | 'stats' | 'hist';
/** `HH:MM`-style local wall time in Europe/Lisbon, e.g. `2026-10-20T10:00`. */
export type LocalTime = string;

export interface DemoDevice {
  /** Slot of the memory platform's test key pool (platform/memory/keys.ts); slot 0 is this computer. */
  pool: number;
  /** The device ID that slot gives (committed; `example.test.ts` recomputes it). */
  deviceId: string;
  name: string;
  /** Last seen, for the sync fake (UX §7.3); null = online or this computer. */
  lastSeen: LocalTime | null;
}

export interface DemoMember {
  key: MemberKey;
  name: string;
  /** Slot of the person key in the pool (32–63); every device of one person proves with the same key. */
  personPool: number;
  memberId: string;
  devices: DemoDevice[];
  /** What the member file says (folder spec §8.3 `caps`). */
  caps: { cpuOk: boolean; localModel: null | { id: ModelId; speedRT: number }; cloud: boolean; volunteer: 'off' | 'plugged' | 'always' };
}

/** A transcript segment as the fixtures write it (folder spec §8.8, without words). */
export interface DemoSegment { id: SegmentId; startMs: number; endMs: number; speaker: string; text: string }

/** A key segment of UX §7.3: id, time and text (the end follows from the words, `fill.ts`). */
export interface KeySegment { id: SegmentId; at: string /* H:MM:SS */; text: string; speaker?: string }

/** A private marker (architecture §13.2 `markers/<lectureId>.json`). */
export interface DemoMarker { at: string /* H:MM:SS */; kind: MarkerKind; note?: string }

/** A source a citation points at, by demo key. */
export type DemoSource =
  | { kind: 'document'; doc: string; locator: { type: 'page'; page: number } | { type: 'article'; article: string; page: number } | { type: 'slide'; slide: number } }
  | { kind: 'lecture'; lecture: string; segment: SegmentId };

/** A citation of an AI answer (folder spec §8.15), by demo keys; `seed.ts` resolves paths, hashes and the quote's context. */
export interface DemoCitation { ref: string; source: DemoSource; quote: string; pin?: string }

export interface DemoAiAnswer {
  text: string;
  citations: DemoCitation[];
  model: string;
  requestedModel: string;
  by: MemberKey;
  at: LocalTime;
  scope: 'materials' | 'materials+general';
  /** Sentences of `text` not supported by any source (folder spec §8.14 `generalKnowledge`). */
  unverified?: string[];
  choice?: string;
}

export interface DemoTranscript {
  /** Who transcribed (and owns `transcript.json`). */
  by: MemberKey;
  device: number;          // index into the member's devices
  model: ModelId;
  at: LocalTime;
  revision: number;
  keySegments: KeySegment[];
  /** What whisper wrote for a key segment before a classmate's pending correction (folder spec §8.9). */
  original?: Record<SegmentId, string>;
  /** Filler (`fill.ts`): the language pool and the speaker of filler segments. */
  filler: { lang: 'pt' | 'en' | 'es'; speaker: string; seed: number };
}

export interface DemoClaim {
  by: MemberKey;
  device: number;
  status: 'working' | 'done';
  progress?: number;
  etaMs?: number;
  heartbeat: number;
}

/** A pending transcript correction (folder spec §8.9 `set_text`), written by a classmate. */
export interface DemoEdit { by: MemberKey; device: number; at: LocalTime; segment: SegmentId; text: string }

export interface DemoLecture {
  key: string;
  title: string;
  startedAt: LocalTime;
  durationMs: number;
  mode: 'room' | 'online' | 'import';
  language: Lang;
  recordedBy: MemberKey;
  /** Speakers of the transcript (folder spec §8.8 `speakers`). */
  speakers: Array<{ id: string; label: string }>;
  channels: Array<{ index: number; speaker: 'lecture' | 'me' | 'class' }>;
  transcript: DemoTranscript | null;
  claim: DemoClaim | null;
  edits?: DemoEdit[];
  /** My private markers. */
  markers: DemoMarker[];
  /** My private highlights (annotations.jsonl), by segment and quote. */
  highlights?: Array<{ segment: SegmentId; quote: string; colour: 'important' | 'confused' | 'exam' | 'todo' | 'other'; at: LocalTime }>;
  /** My private AI summary (lectures/<id>.json `summary`). */
  summary?: { at: LocalTime; model: string; answer: string; citations: DemoCitation[] };
  /** `lecture=<key>&cite=1` opens as from this citation. */
  cite?: { segment: SegmentId; quote: string };
}

export interface DemoDoc {
  key: string;
  /** Path below the class's documents directory (its `dirs.documents`). */
  path: string;
  /** The committed binary in demo/assets/. */
  asset: string;
  mime: string;
  addedBy: MemberKey;
  addedAt: LocalTime;
  pages: number | null;
  /** "Only on this computer" (a local ignore, folder spec §11.2). */
  localOnly?: boolean;
}

export interface DemoQuestion {
  key: string;             // route key (`q=`): I, IIa, …, 1…4; the container is `II`
  id: string;              // QuestionId
  number: string;
  parent: string | null;   // key of the container
  group: string | null;
  kind: 'case' | 'essay' | 'short' | 'multiple_choice' | 'true_false' | 'comment' | 'calculation' | 'other' | 'container';
  text: string;
  points: number | null;
  options?: Array<{ key: string; text: string }>;
  choose?: number;
  page?: number;
  answer?: DemoAiAnswer;
  /** My private state (architecture §13.2 `exams/<examId>.json`). */
  mine?: {
    draft?: string; correct?: string; mark?: 'right' | 'partly' | 'wrong' | 'unsure'; revealed?: boolean; inPractice?: boolean;
    practice?: { last: LocalTime; result: 'again' | 'gotIt'; count: number };
  };
}

export interface DemoExam {
  key: string;
  title: string;
  type: 'quiz' | 'test' | 'midterm' | 'final' | 'resit' | 'special' | 'oral' | 'practice' | 'assignment' | 'other';
  status: 'upcoming' | 'paper';
  date: LocalTime | null;
  allDay?: boolean;
  durationMin?: number;
  room?: string;
  weight?: number;
  weightText?: string;
  coversText?: string;
  rules?: string[];
  scale?: { max: number; unit: string };
  extraPoints?: Array<{ label: string; points: number }>;
  /** The original file (an asset) inside the exam's directory, for papers. */
  file?: { name: string; asset: string; mime: string; pages: number };
  importedBy: MemberKey;
  createdAt: LocalTime;
  extraction?: { method: 'pdf-text' | 'docx' | 'ocr' | 'typed'; model?: string; at: LocalTime; reviewedAt: LocalTime };
  questions: DemoQuestion[];
}

export interface DemoMessage {
  n: number;
  at: LocalTime;
  by: MemberKey;
  kind: 'message' | 'ai' | 'thanks';
  text?: string;
  replyTo?: number;
  /** Member keys or 'ai' / 'everyone' mentioned with `<@…>` tokens; `{@key}` in `text` marks where. */
  mentions?: Array<MemberKey | 'ai' | 'everyone'>;
  attachment?: string;     // a doc key
  ai?: DemoAiAnswer;
  thanks?: { lecture: string; to: MemberKey };
  pinnedBy?: MemberKey;
}

export interface DemoNote {
  key: string;
  title: string;
  /** Class notes live in the notes directory; private notes in private/<classId>/notes/. */
  private: boolean;
  name: string;
  /** Markdown; `{lecture:<key>}` and `{doc:<key>}` are replaced by the ids and paths the seed derives. */
  body: string;
  by: MemberKey;
  at: LocalTime;
  /** With `conflict=1`: the losing version Syncthing keeps as a conflict copy (folder spec §8.21). */
  conflict?: { by: MemberKey; at: LocalTime; body: string };
  /** Presence `editing` of this note (with `sync=fake`). */
  editingBy?: MemberKey;
}

export interface DemoAskThread {
  key: string;
  at: LocalTime;
  question: string;
  answer: string;
  model: string;
  citations: DemoCitation[];
}

export interface DemoConsent { by: MemberKey; at: LocalTime }

export interface DemoClass {
  key: ClassKey;
  name: string;
  shortName: string;
  colour: ColourHex;
  icon: IconName;
  lecturer: string | null;
  term: string | null;
  language: Lang;
  shared: boolean;
  archived: boolean;
  createdAt: LocalTime;
  /** Members other than me, with when each device joined. */
  members: Array<{ key: MemberKey; device: number; joinedAt: LocalTime }>;
  organisers: MemberKey[];
  /** Class-scope consent records (record + share), one pair per recorder. */
  consents: DemoConsent[];
  documents: DemoDoc[];
  lectures: DemoLecture[];
  exams: DemoExam[];
  chat: DemoMessage[];
  /** My read marker: the last message I have read (by `n`). */
  readUpTo: number | null;
  notes: DemoNote[];
  ask: DemoAskThread[];
}
