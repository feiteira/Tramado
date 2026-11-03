// Class paths (folder spec §1, §4.5, §5.1): validation shared with Rust's tramado_base::confine
// through test-vectors/class-paths.json, and the classification of every machine path.
import { PlatformError } from '../errors';
import { isDeviceId, isUlid, type ClassPath, type DeviceId, type Ulid } from './ids';

export const MAX_CLASS_PATH_UNITS = 200;
// C0 controls and DEL. (C1 controls are allowed in names; Rust refuses only control characters too.)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Why `p` is not a valid class path, or null when it is (on the NFC form; see `normalizeClassPath`). */
export function classPathProblem(p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return 'empty';
  if (p.length > MAX_CLASS_PATH_UNITS) return 'too long';
  if (p.startsWith('/')) return 'absolute';
  if (p.includes('\\')) return 'backslash';
  if (CONTROL.test(p)) return 'control character';
  const segments = p.split('/');
  const inTmp = p.startsWith('.tramado/tmp/');
  for (const s of segments) {
    if (s === '') return 'empty segment';
    if (s === '.' || s === '..') return 'dot segment';
    if (s.startsWith('.st')) return 'syncthing name';
    const lower = s.toLowerCase();
    if (!inTmp && (lower.endsWith('.tmp') || lower.endsWith('.part'))) return 'temporary name';
  }
  return null;
}

/** NFC form of a class path (Syncthing keeps NFC on disk; readers compare NFC, folder spec §5.4). */
export const normalizeClassPath = (p: string): string => p.normalize('NFC');

/** Whether `p` (after NFC) is a valid class path. */
export const isValidClassPath = (p: string): boolean => classPathProblem(normalizeClassPath(p)) === null;

/** The NFC class path, or PlatformError INVALID. */
export function validateClassPath(p: string): ClassPath {
  const n = normalizeClassPath(p);
  const why = classPathProblem(n);
  if (why) throw new PlatformError('INVALID', `invalid class path (${why}): ${JSON.stringify(p)}`);
  return n;
}

export const joinClassPath = (...parts: string[]): ClassPath => parts.filter((x) => x !== '').join('/');
export const dirOf = (p: ClassPath): ClassPath => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p: ClassPath): string => p.slice(p.lastIndexOf('/') + 1);

/** Names a reader skips at any depth (folder spec §4.5), not counting `*.sync-conflict-*` copies. */
export function isSkippedName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name === '.stfolder' || name === '.stversions' || name === '.stignore' ||
    (name.startsWith('.syncthing.') && lower.endsWith('.tmp')) ||
    (name.startsWith('~syncthing~') && lower.endsWith('.tmp')) ||
    lower.endsWith('.tmp') || lower.endsWith('.part')
  );
}

export interface ConflictName { original: string; date: string; time: string; by: string }
const CONFLICT = /^(.*)\.sync-conflict-(\d{8})-(\d{6})-([A-Z2-7]{7})(\.[^.]*)?$/;

/** Parses Syncthing's `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>[.<ext>]`, or null. */
export function parseConflictName(name: string): ConflictName | null {
  const m = CONFLICT.exec(name);
  if (!m) return null;
  return { original: m[1]! + (m[5] ?? ''), date: m[2]!, time: m[3]!, by: m[4]! };
}

export type PathKind =
  | 'classFile' | 'meta' | 'members' | 'presence' | 'consent' | 'chat' | 'annotations' | 'claims' | 'edits' | 'markers'
  | 'examEdits' | 'answers' | 'mod' | 'bans' | 'invites'
  | 'lectureManifest' | 'transcriptJson' | 'transcriptMd' | 'transcriptVtt' | 'audio' | 'examManifest'
  | 'conflictCopy' | 'skipped' | 'tramadoOther' | 'content';

export interface PathInfo {
  kind: PathKind;
  deviceId?: DeviceId;      // the writer named by the path (per-device machine files)
  objectId?: string;        // lectureId / examId of claims, edits, markers, exam-edits, answers
  month?: string;           // YYYY-MM of chat and annotation files
  fold?: boolean;           // claims/<lectureId>.fold/<deviceId>.json
  conflictOf?: ClassPath;   // conflictCopy: the path it is a copy of
}

const DEVICE_JSON = /^([A-Z2-7]{7}(?:-[A-Z2-7]{7}){7})\.json$/;
const DEVICE_JSONL = /^([A-Z2-7]{7}(?:-[A-Z2-7]{7}){7})\.jsonl$/;
const MONTH = /^(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl$/;

function perDevice(kind: PathKind, file: string, re: RegExp, extra: Partial<PathInfo> = {}): PathInfo {
  const m = re.exec(file);
  return m && isDeviceId(m[1]) ? { kind, deviceId: m[1], ...extra } : { kind: 'tramadoOther' };
}

/** What a class path is (folder spec §5.1, §4.5). Never throws; invalid paths are 'skipped'. */
export function classifyPath(p: ClassPath): PathInfo {
  const path = normalizeClassPath(p);
  if (classPathProblem(path) && !path.startsWith('.tramado/tmp/')) return { kind: 'skipped' };
  const segs = path.split('/');
  const name = segs[segs.length - 1]!;
  if (segs[0] === '.tramado') {
    if (segs[1] === 'tmp') return { kind: 'skipped' };
    if (segs.length === 2 && name === 'class.json') return { kind: 'classFile' };
    const [, dir, a, b] = segs;
    if (segs.length === 3) {
      switch (dir) {
        case 'meta': return perDevice('meta', a!, DEVICE_JSON);
        case 'members': return perDevice('members', a!, DEVICE_JSON);
        case 'presence': return perDevice('presence', a!, DEVICE_JSON);
        case 'consent': return perDevice('consent', a!, DEVICE_JSONL);
        case 'mod': return perDevice('mod', a!, DEVICE_JSONL);
        case 'bans': return perDevice('bans', a!, DEVICE_JSON);
        case 'invites': return perDevice('invites', a!, DEVICE_JSON);
      }
    }
    if (segs.length === 4) {
      if (dir === 'chat' || dir === 'annotations') {
        const mm = MONTH.exec(b!);
        return isDeviceId(a) && mm ? { kind: dir, deviceId: a, month: mm[1] } : { kind: 'tramadoOther' };
      }
      if (dir === 'claims') {
        const fold = a!.endsWith('.fold');
        const id = fold ? a!.slice(0, -5) : a!;
        return isUlid(id) ? perDevice('claims', b!, DEVICE_JSON, { objectId: id, fold }) : { kind: 'tramadoOther' };
      }
      const byObject: Record<string, [PathKind, RegExp]> = {
        edits: ['edits', DEVICE_JSONL], markers: ['markers', DEVICE_JSON], 'exam-edits': ['examEdits', DEVICE_JSONL], answers: ['answers', DEVICE_JSON],
      };
      const hit = byObject[dir!];
      if (hit && isUlid(a)) return perDevice(hit[0], b!, hit[1], { objectId: a });
    }
    return { kind: 'tramadoOther' };
  }
  if (segs.some((s) => isSkippedName(s))) return { kind: 'skipped' };
  const conflict = parseConflictName(name);
  if (conflict) return { kind: 'conflictCopy', conflictOf: [...segs.slice(0, -1), conflict.original].join('/') };
  switch (name) {
    case 'lecture.json': return { kind: 'lectureManifest' };
    case 'transcript.json': return { kind: 'transcriptJson' };
    case 'transcript.md': return { kind: 'transcriptMd' };
    case 'transcript.vtt': return { kind: 'transcriptVtt' };
    case 'audio.webm': return { kind: 'audio' };
    case 'exam.json': return { kind: 'examManifest' };
  }
  return { kind: 'content' };
}

/** The writer device a path names (per-device machine files), or null (manifests name it inside). */
export function writerFromPath(p: ClassPath): DeviceId | null {
  return classifyPath(p).deviceId ?? null;
}

/** The object (lecture or exam) a per-object machine path belongs to, or null. */
export function objectOfPath(p: ClassPath): Ulid | null {
  return classifyPath(p).objectId ?? null;
}
