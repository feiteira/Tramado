// View models the screens consume (UX spec §2.12, §3.9.1, §3.10.1, §4.1, verbatim). Frozen after M0.
// Services map the storage shapes (core/model/files.ts) to these; screens never read files.
import type { MarkerKind } from '../../core/model/files';
import type { ClassIconName } from '../../core/model/icons';

export type { MarkerKind, ClassIconName };

// ── UX §2.12 ─────────────────────────────────────────────────────────────────────────────────────
export interface DeviceRef { deviceId: string; deviceName: string; memberId: string; memberName: string; self: boolean }
export type ClassSync =
  | { kind: 'local' } | { kind: 'upToDate' } | { kind: 'syncing'; files: number | null; bytesLeft: number | null }
  | { kind: 'waiting' } | { kind: 'paused' } | { kind: 'relay' } | { kind: 'missingFolder' }
  | { kind: 'problems'; count: number };
export interface ClassView {
  id: string; name: string; shortName: string; color: string; icon: ClassIconName;
  lecturer: string | null; term: string | null; language: string /* BCP 47, e.g. 'pt-PT'; 'auto' = detect */;
  vocabulary: string;                  // transcription hint (whisper initial prompt)
  shared: boolean; archived: boolean; path: string;
  sync: ClassSync; onlineMembers: number; memberCount: number;
  unread: number; mentions: number; recordingBy: DeviceRef | null;
  nextExams: ExamDateView[];           // future dates, ascending, max 3
  pins: PinView[];                     // newest first; always [] in 0.1 (pins are v1.1)
  notify: 'important' | 'all' | 'none'; askBeforeJoin: boolean; skipAudio: boolean;
  organisers: string[];                // memberIds
  newerFormat: boolean;                // G14: some files need a newer Tramado
}
export interface ExamDateView { examId: string; classId: string; title: string; kind: ExamKind; at: string /* ISO, local wall time */;
  allDay: boolean; room: string | null; covers: string | null; weight: string | null; practiceCount: number }
export type ExamKind = 'quiz' | 'test' | 'midterm' | 'final' | 'resit' | 'special' | 'oral' | 'practice';
export interface PinView { messageId: string; text: string; by: string; at: string }
export type TranscriptionState =
  | { kind: 'none' }                                         // nobody has claimed it
  | { kind: 'waitingAudio'; have: number; size: number }     // lecture.json arrived; audio still syncing
  | { kind: 'claimed'; by: DeviceRef; percent: number; etaMin: number | null; quietMin: number; health: 'healthy' | 'slow' | 'stale' }
                                                             // healthy < 2 min, slow 2–10 min, stale ≥ 10 min (sync spec §14.1 SLOW_MS/STALE_MS)
  | { kind: 'arriving'; by: DeviceRef; holders: DeviceRef[] } // finished on another computer, transcript still syncing (sync spec §14.4)
  | { kind: 'local'; phase: 'model' | 'decoding' | 'transcribing'; percent: number; etaMin: number | null }
  | { kind: 'done'; by: DeviceRef; engine: 'local' | 'cloud'; model: string; at: string; revision: number; pendingEdits: number }   // pendingEdits: 0 in 0.1
  | { kind: 'failed'; by: DeviceRef; code: string }
  | { kind: 'unavailable'; reason: 'transcriptOnlyElsewhere' | 'audioDeleted' | 'notShared' };
export interface LectureView {
  id: string; classId: string; title: string; startedAt: string; durationMs: number;
  mode: 'room' | 'online' | 'import'; language: string; recordedBy: DeviceRef;   // 'import' shows the `file-audio` icon
  audio: { present: boolean; arriving: boolean; skipped: boolean } | null;   // null = no audio published (transcript only / deleted)
  transcription: TranscriptionState; myMarkers: Record<MarkerKind, number>; autoExamMarks: number;
  duplicateOf: string | null; probableDuplicateOf: string | null;   // overlap > 50 % with a transcribed lecture (sync spec §14.3)
  newerFormat: boolean; untrustedTranscript: boolean;               // a transcript exists but failed the authorship check
}
export interface Quota { remaining: number; limit: number; used: number; resetsAt: string /* local ISO of next 00:00 UTC */;
  isFreeTier: boolean; creditLeft: number | null }
export interface ModelLabel { id: string; label: string /* "Gemma 4 31B (free)" */; free: boolean }

// ── UX §3.9.1 ────────────────────────────────────────────────────────────────────────────────────
export type QuestionKind = 'case' | 'essay' | 'short' | 'multiple_choice' | 'true_false' | 'comment' | 'calculation' | 'other';
export type Mark = 'right' | 'partly' | 'wrong' | 'unsure';
export interface ExamPaperView {
  examId: string; classId: string; title: string; kind: ExamKind; year: number | null; date: string | null;
  sourceRelPath: string | null;                        // original file in <Exams dir>/<title>/
  state: 'extracting' | 'review' | 'ready';            // 'review' until the Review screen was confirmed once
  rules: string[]; durationMin: number | null; scale: 'pt20' | 'es10' | 'points'; extraPoints: { label: string; points: number }[];
  questions: QuestionView[]; importedBy: DeviceRef; newerFormat: boolean;
  answers: { by: DeviceRef; model: ModelLabel; at: string; count: number }[];   // shared answer sets that exist (G11)
}
// Mapping from exam.json (folder spec §8.12): kind = type ('assignment'/'other' show as 'practice'); year = the first year of
// academicYear ("2024/25" → 2024), else the year of date, else null; scale = 'pt20' when {max:20, unit:'valores'},
// 'es10' when {max:10, unit:'puntos'}, else 'points'; extraPoints = extraPoints ?? []. mine.* comes from the private
// exams/<examId>.json (architecture §13.2): draft = myAnswers, correct, mark = marks (incl. 'unsure'), revealed,
// inPractice, practice = {result, last, count}; hint = the private hint (never shared).
export interface QuestionView {
  id: string; number: string /* 'I', 'II.a' */; text: string; points: number | null; kind: QuestionKind;
  group: { id: string; choose: number; label: string /* 'II' */ } | null;      // "answer 2 of a, b, c"
  ai: AiAnswerView | null; hint: AiAnswerView | null;
  mine: { draft: string; correct: string; mark: Mark | null; inPractice: boolean; revealed: boolean;
          practice: { lastResult: 'again' | 'gotIt' | null; lastAt: string | null; count: number } };   // private (D44)
}
export interface AiAnswerView {
  text: string;                       // Markdown with [S#] refs, as the model wrote it (trimmed)
  citations: Citation[];              // §4.1, in order of first appearance
  unverified: string[];               // sentences with no valid citation, when "general knowledge" was allowed
  model: ModelLabel; requested: ModelLabel; fallback: boolean;              // fallback = model ≠ first of chain
  askedBy: DeviceRef; at: string; mode: 'quick' | 'deep' | 'hint';
  grounded: number;                   // 0..1, sentences with ≥ 1 valid citation / all sentences
  insufficient: boolean;              // the model said the sources don't contain the answer
  sent: { passages: number; chars: number };
}

// ── UX §3.10.1 ───────────────────────────────────────────────────────────────────────────────────
export interface ChatMessageView {
  id: string; author: DeviceRef; at: string; text: string;               // Markdown-lite source
  kind: 'message' | 'ai' | 'thanks' | 'system';
  replyTo: { id: string; author: string; excerpt: string } | null;
  attachments: { relPath: string; name: string; size: number; arrived: boolean }[];
  mentions: { memberId: string | 'ai' | 'everyone'; name: string }[];
  ai?: AiAnswerView;                                                     // kind 'ai': answer, asker = author
  edited: boolean; deleted: boolean; hiddenBy: string | null; pinned: boolean;   // hiddenBy null and pinned false in 0.1 (v1.1)
  delivery: 'local' | 'sent';                                            // local = no other member device has it yet
  thanks?: { to: { memberId: string; name: string }; lectureId: string } | null;   // G1 (T-SYNC): kind 'thanks' — who was thanked, for which lecture
  examDate?: { kind: ExamKind; at: string } | null;                      // detected "Add to Exams?" chip (v1.1; null in 0.1)
  unverified: boolean;                                                   // the line's memberId is not the writer's person (folder spec §6.2 rule 6)
}
// id = `${deviceId}:${lineId}`; author is always the person bound to the file's device, or "Unverified ({deviceName})".
// 0.1 has no reactions, pins or hides (v1.1): their menu items and the pins strip are not shown.

// ── UX §4.1 (view-side citations; import them as ViewCitation / ViewSourceRef / ViewLocator next to the
//    storage types of core/model/files.ts, architecture §11.2) ──────────────────────────────────────
export type Locator =
  | { kind: 'page'; page: number; label?: string }                 // PDF physical page; label = printed page label
  | { kind: 'article'; label: string; page: number; pageEnd?: number } // "art. 18.º" (law texts)
  | { kind: 'slide'; slide: number }
  | { kind: 'time'; ms: number; endMs?: number; segmentId?: string }  // lecture transcript
  | { kind: 'question'; questionId: string; number: string }        // a question of another exam paper
  | { kind: 'heading'; path: string[] }                              // DOCX / Markdown heading path
  | { kind: 'none' };
export interface SourceRef {
  type: 'document' | 'lecture' | 'exam' | 'note';
  classId: string; title: string;              // file name without extension, lecture title, exam title, note title
  relPath?: string; sha256?: string;           // documents, exam originals, notes
  lectureId?: string; examId?: string; private?: boolean;   // private = My notes (never shared; chip shows a lock)
  locator: Locator;
  quote: { exact: string; prefix: string; suffix: string }; // ≤ 300 / 32 / 32 chars
}
export interface Citation {
  n: number;                   // 1..k, numbered by first appearance in the answer
  ref: string;                 // "S3" as used in the prompt
  pin: string | null;          // pin-point text after the ref: "[S4, n.º 3]" → "n.º 3"
  source: SourceRef | null;    // null when hallucinated
  status: 'ok' | 'moved' | 'changed' | 'missing' | 'hallucinated';
}
export type ViewLocator = Locator;
export type ViewSourceRef = SourceRef;
export type ViewCitation = Citation;
