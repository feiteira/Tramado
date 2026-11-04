// Tolerant reading of class-folder records (folder spec §4.2, §4.3, §7.3). `parseRecord` checks the
// envelope and reports unknown top-level fields (kept on rewrite by `mergeUnknown`); deep validation
// of each record type belongs to the services that use it. `parseJsonl` reads append-only files
// incrementally and never trusts a trailing line without '\n'.
import { isNewer, type FormatName } from './formats';
import type {
  AnnotationLine, AnswersFile, BansFile, ChatLine, ClaimFile, ClassFile, ConsentLine, ExamEditLine, ExamFile, LectureFile,
  MarkersFile, MemberFile, MetaFile, ModLine, PresenceFile, TranscriptEditLine, TranscriptFile,
} from './files';

export interface Parsed<T> { ok: boolean; value: T | null; newer: boolean; unknown: string[] }

export interface RecordTypes {
  'tramado.class': ClassFile;
  'tramado.meta': MetaFile;
  'tramado.member': MemberFile;
  'tramado.presence': PresenceFile;
  'tramado.consent': ConsentLine;
  'tramado.lecture': LectureFile;
  'tramado.transcript': TranscriptFile;
  'tramado.transcript-edit': TranscriptEditLine;
  'tramado.claim': ClaimFile;
  'tramado.markers': MarkersFile;
  'tramado.exam': ExamFile;
  'tramado.exam-edit': ExamEditLine;
  'tramado.answers': AnswersFile;
  'tramado.chat': ChatLine;
  'tramado.annotation': AnnotationLine;
  'tramado.mod': ModLine;
  'tramado.bans': BansFile;
}
export type RecordOf<F extends FormatName> = RecordTypes[F];

const ENVELOPE = ['format', 'version', 'sig'];
/** Top-level fields of each record type (folder spec §8); anything else is "unknown" and kept on rewrite. */
export const KNOWN_FIELDS: Readonly<Record<FormatName, readonly string[]>> = {
  'tramado.class': ['classId', 'idNonce', 'specVersion', 'createdAt', 'createdBy', 'initialName', 'rotatedFrom', 'forkedFrom'],
  'tramado.meta': ['deviceId', 'memberId', 'fields', 'organiserOps', 'hlc'],
  'tramado.member': ['deviceId', 'memberId', 'name', 'colour', 'deviceName', 'joinedAt', 'hlc', 'addresses', 'caps', 'person', 'vouches', 'formats', 'app'],
  'tramado.presence': ['deviceId', 'memberId', 'seq', 'hlc', 'updatedAt', 'power', 'activity', 'heartbeatS'],
  'tramado.consent': ['id', 'hlc', 'ms', 'memberId', 'kind', 'scope', 'lectureId', 'share', 'revokes', 'textId', 'textLang', 'text', 'lecturer'],
  'tramado.lecture': ['id', 'idNonce', 'title', 'startedAt', 'utcOffsetMin', 'durationMs', 'mode', 'language', 'recordedBy', 'audio', 'audioDeletedAt', 'channels', 'pauses', 'consent', 'import', 'duplicateOf', 'updatedAt'],
  'tramado.transcript': ['lectureId', 'round', 'revision', 'audioSha256', 'language', 'writer', 'transcribedBy', 'engine', 'speakers', 'segments', 'folded', 'updatedAt'],
  'tramado.transcript-edit': ['id', 'hlc', 'ms', 'memberId', 'lectureId', 'round', 'baseRevision', 'op', 'segment', 'base', 'text', 'speaker', 'atChar', 'atMs', 'newId', 'with', 'speakerId', 'label'],
  'tramado.claim': ['kind', 'lectureId', 'round', 'deviceId', 'memberId', 'claimedAt', 'status', 'heartbeat', 'updatedAt', 'audioSha256', 'engine', 'progress', 'etaMs', 'supersedes', 'error', 'finishedAt', 'transcriptRevision'],
  'tramado.markers': ['lectureId', 'deviceId', 'memberId', 'hlc', 'markers'],
  'tramado.exam': ['id', 'idNonce', 'title', 'type', 'status', 'date', 'allDay', 'durationMin', 'room', 'weight', 'weightText', 'academicYear', 'covers', 'coversText', 'rules', 'scale', 'extraPoints', 'files', 'importedBy', 'createdAt', 'extraction', 'questions', 'revision', 'examFieldHlc', 'folded', 'updatedAt'],
  'tramado.exam-edit': ['id', 'hlc', 'ms', 'memberId', 'examId', 'baseRevision', 'op', 'field', 'value', 'questionId', 'question', 'after'],
  'tramado.answers': ['examId', 'deviceId', 'memberId', 'hlc', 'updatedAt', 'answers'],
  'tramado.chat': ['type', 'id', 'hlc', 'ms', 'memberId', 'redacted', 'text', 'replyTo', 'mentions', 'attachments', 'target', 'emoji', 'op', 'to', 'lectureId', 'question', 'status', 'citations', 'model', 'requestedModel', 'privacy', 'error'],
  'tramado.annotation': ['type', 'id', 'annotationId', 'hlc', 'ms', 'memberId', 'kind', 'target', 'colour', 'body', 'ai'],
  'tramado.mod': ['type', 'id', 'hlc', 'ms', 'memberId', 'target', 'lectureId', 'reason', 'newClassIdSha256', 'newLabel', 'excluded'],
  'tramado.bans': ['deviceId', 'memberId', 'hlc', 'updatedAt', 'entries'],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks the envelope of `raw` against `format`. A record of a newer major version is returned with
 * `newer: true` (readers use its frozen fields only, §7.3); a wrong format or a broken envelope is
 * `ok: false`.
 */
export function parseRecord<F extends FormatName>(format: F, raw: unknown): Parsed<RecordOf<F>> {
  const fail: Parsed<RecordOf<F>> = { ok: false, value: null, newer: false, unknown: [] };
  if (!isObject(raw) || raw.format !== format) return fail;
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return fail;
  const known = new Set([...ENVELOPE, ...KNOWN_FIELDS[format]]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  return { ok: true, value: raw as unknown as RecordOf<F>, newer: isNewer(format, version), unknown };
}

/** A parser for one format, in the shape ClassStore.readJson/readJsonl take. */
export const parserFor =
  <F extends FormatName>(format: F) =>
  (raw: unknown): Parsed<RecordOf<F>> =>
    parseRecord(format, raw);

export interface JsonlLine { offset: number; length: number; value?: unknown; error?: 'too-long' | 'unparseable' }

/**
 * Splits JSONL bytes from `from` (a byte offset at a line start). Returns every complete line with its
 * byte offset and length (including '\n'), and `consumed` = the offset after the last complete line:
 * a trailing line without '\n' is not returned (it may be half-written, §4.3). Lines over 65 536 bytes
 * and lines that do not parse as a JSON object carry an `error` instead of a value.
 */
export function parseJsonl(bytes: Uint8Array, from = 0): { lines: JsonlLine[]; consumed: number } {
  const lines: JsonlLine[] = [];
  const dec = new TextDecoder('utf-8', { fatal: false });
  let start = from;
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    const length = i + 1 - start;
    if (length > 65_536) lines.push({ offset: start, length, error: 'too-long' });
    else {
      const text = dec.decode(bytes.subarray(start, i)).replace(/\r$/, '');
      if (text.trim() === '') {
        // An empty line is not a record; skip it silently.
      } else {
        try {
          const value: unknown = JSON.parse(text);
          if (isObject(value)) lines.push({ offset: start, length, value });
          else lines.push({ offset: start, length, error: 'unparseable' });
        } catch {
          lines.push({ offset: start, length, error: 'unparseable' });
        }
      }
    }
    start = i + 1;
  }
  return { lines, consumed: start };
}

/**
 * Folder spec §4.3: a writer rewriting a file it owns keeps the fields it does not understand.
 * Returns `next` plus every top-level field of `prev` that `next` lacks and the format does not know.
 */
export function mergeUnknown<T extends object>(prev: unknown, next: T): T {
  if (!isObject(prev)) return next;
  const format = typeof prev.format === 'string' && prev.format in KNOWN_FIELDS ? (prev.format as FormatName) : null;
  const known = new Set([...ENVELOPE, ...(format ? KNOWN_FIELDS[format] : [])]);
  const out: Record<string, unknown> = { ...(next as Record<string, unknown>) };
  for (const [k, v] of Object.entries(prev)) if (!known.has(k) && !(k in out)) out[k] = v;
  return out as T;
}
