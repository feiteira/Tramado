// LectureService (architecture §11.2): the lectures of one class as UX view models, the lecture view's detail
// (effective transcript, markers, radar, legal references, audio), the recorder's manifest actions, private
// markers, export, and transcript corrections (folder spec §8.9; in 0.1 since the 2026-11-04 scope change):
// edit lines, the owner's debounced fold and the take-over fold of a new owner (sync spec §14.8). No DOM.
import { PlatformError, toPlatformError } from '../core/errors';
import { newSegmentId, newUlid } from '../core/ids';
import { compactJson } from '../core/json';
import { isUlid, shortIdOf, type ClassId, type ClassPath, type DeviceId, type Hex64, type SegmentId, type Ulid } from '../core/model/ids';
import { MARKER_KINDS, type LectureFile, type MarkersFile, type TranscriptEditLine, type TranscriptFile } from '../core/model/files';
import { mergeUnknown, parserFor } from '../core/model/parse';
import { classifyPath, writerFromPath } from '../core/model/paths';
import { instant, parseRfc3339 } from '../core/model/time';
import { probableDuplicate, STALE_MS } from '../core/speech/volunteer';
import { replay, type EditLog, type ReplayInfo } from '../core/transcript/effective';
import { editLogPath, labelSpeakerOp, mergeOp, normalizeLabel, normalizeText, setSpeakerOp, setTextOp, splitOp, splitTime, MAX_SEGMENT_CHARS, type EditStamp } from '../core/transcript/edits';
import { fold as foldTranscript } from '../core/transcript/fold';
import { engineLabel, isSpeakerId } from '../core/transcript/labels';
import { examRadar } from '../core/transcript/radar';
import { legalRefs } from '../core/transcript/references';
import { renderMarkdown, renderText, renderVtt } from '../core/transcript/render';
import type { AudioSource, Marker, Platform } from '../platform/types';
import type { AppContext } from './context';
import { Store, type ReadableStore } from './store';
import type { AppServices, ClassStore, IndexedItem } from './types/common';
import type { AskTurn } from './types/ask';
import type { ClaimView } from './types/sync';
import type { EffectiveTranscript, LectureDetail, LectureService } from './types/lectures';
import type { DeviceRef, LectureView, MarkerKind, TranscriptionState } from './types/viewModels';

/** The owner folds corrections this long after the last new one (folder spec §8.9). */
export const FOLD_DEBOUNCE_MS = 5 * 60_000;
/** Waveform buckets of the lecture timeline (UX §3.5.2). */
export const PEAK_BUCKETS = 1200;

// ── private per-device files (architecture §13.2) ──────────────────────────────────────────────

export interface LecturePrivateFile {
  format: 'tramado.lecture-private'; version: 1;
  summary: AskTurn | null; terms: AskTurn | null; removedAutoMarks: number[];
  /** T-LECTURES addition: the recorder chose "Let a classmate do it" / "Not now": never claimed automatically here. */
  noAutoClaim?: boolean;
  /** T-LECTURES addition: the 24 h "Nobody has transcribed it yet" notice was shown. */
  nudgedAt?: string;
}

const dec = new TextDecoder();
const enc = new TextEncoder();

export async function readPrivateJson<T>(platform: Platform, classId: ClassId, path: string): Promise<T | null> {
  try {
    const bytes = await platform.privateFiles.read(classId, path);
    return bytes ? (JSON.parse(dec.decode(bytes)) as T) : null;
  } catch {
    return null;
  }
}
export async function writePrivateJson(platform: Platform, classId: ClassId, path: string, value: unknown): Promise<void> {
  await platform.privateFiles.write(classId, path, enc.encode(compactJson(value)));
}
export const privateLecturePath = (id: Ulid) => `lectures/${id}.json`;
export const privateMarkersPath = (id: Ulid) => `markers/${id}.json`;

export async function readLecturePrivate(platform: Platform, classId: ClassId, id: Ulid): Promise<LecturePrivateFile> {
  const f = await readPrivateJson<Partial<LecturePrivateFile>>(platform, classId, privateLecturePath(id));
  return {
    ...(f ?? {}), format: 'tramado.lecture-private', version: 1, summary: f?.summary ?? null, terms: f?.terms ?? null,
    removedAutoMarks: Array.isArray(f?.removedAutoMarks) ? f!.removedAutoMarks.filter((x) => typeof x === 'number') : [],
  };
}
export async function updateLecturePrivate(platform: Platform, classId: ClassId, id: Ulid, f: (p: LecturePrivateFile) => LecturePrivateFile): Promise<void> {
  await writePrivateJson(platform, classId, privateLecturePath(id), f(await readLecturePrivate(platform, classId, id)));
}

// ── what LectureService knows about each lecture (shared with the TranscriptionQueue) ─────────

/** One lecture as read from the class, with everything the queue and the views need. */
export interface LectureRecord {
  id: Ulid; item: IndexedItem; dir: ClassPath;
  lecture: LectureFile; lectureNewer: boolean;
  /** The trusted transcript.json (its last trusted version), if any. */
  transcript: TranscriptFile | null; transcriptNewer: boolean;
  /** transcript.json as on disk, trusted or not: what automatic claims must not duplicate (sync spec §14.2). */
  onDisk: { audioSha256: Hex64 | null; round: number; writer: DeviceId | null } | null;
  untrustedTranscript: boolean;
  logs: EditLog[]; effective: EffectiveTranscript | null; info: ReplayInfo | null;
  /** Size of the local audio.webm (null = absent). */
  audioSize: number | null; audioPath: ClassPath;
  /** The greatest round among this lecture's transcribe claim files (R_max with the transcript's). */
  round: number;
  claims: ClaimView[]; winner: ClaimView | null;
  /** Error codes of failed claims, by device; devices that already hold a finished transcript. */
  claimErrors: Record<DeviceId, string>; holders: DeviceId[];
  markers: Marker[]; priv: LecturePrivateFile;
}

export interface LectureServiceImpl extends LectureService {
  /** The records behind `list`, after the last refresh (TranscriptionQueue). */
  records(): ReadonlyMap<Ulid, LectureRecord>;
  /** Re-reads the class now and resolves when the views are up to date (tests, the queue). */
  refresh(): Promise<void>;
  /** Resolves when no refresh is running or pending (tests). */
  idle(): Promise<void>;
  /** Stops the timers (the class left the library). */
  dispose(): void;
}

const parseLecture = parserFor('tramado.lecture');
const parseTranscript = parserFor('tramado.transcript');
const parseEdit = parserFor('tramado.transcript-edit');

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const errorMessage = (e: unknown) => toPlatformError(e).message;

export function createLectureService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): LectureServiceImpl {
  const { platform, clock } = ctx;
  const { store, classId } = cls;
  const list = new Store<LectureView[]>([]);
  const details = new Map<Ulid, Store<LectureDetail | null>>();
  let records = new Map<Ulid, LectureRecord>();
  const manifestCache = new Map<ClassPath, { size: number; mtimeMs: number; value: LectureFile; newer: boolean }>();
  const claimSubs = new Map<Ulid, () => void>();
  const foldTimers = new Map<Ulid, { timer: () => void; ops: number }>();
  const peaks = new Map<string, number[] | 'loading' | 'failed'>();
  const refTargets = new Map<string, { path: ClassPath; page: number | null } | null | 'loading'>();
  const offs: Array<() => void> = [];
  const folding = new Set<Promise<unknown>>();
  let disposed = false;

  const me = () => ctx.device.get()?.deviceId ?? '';
  const myName = () => ctx.identity.get()?.name ?? '';
  const classServices = () => {
    try {
      return app().forClass(classId);
    } catch {
      return null;
    }
  };

  // ── refresh gate: one at a time, a trailing one when asked while running ──
  let running: Promise<void> | null = null;
  let again = false;
  function schedule(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await load();
        } catch (e) {
          ctx.log('error', 'lectures: refresh failed', { classId, error: errorMessage(e) });
        }
      } while (again && !disposed);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  offs.push(store.onChange(['lecture', 'transcript', 'edits', 'claims', 'audio', 'members', 'markers'], () => void schedule()));
  offs.push(store.state.subscribe(() => {
    if (store.state.get().status === 'ready' && records.size === 0 && store.state.get().index.lectures.size > 0) void schedule();
  }));
  // Other services' stores, subscribed once they exist (the per-class services are created together).
  queueMicrotask(() => {
    if (disposed) return;
    try {
      offs.push(app().transcription.state.subscribe(() => void schedule()));
    } catch {
      // no transcription queue (tests that build only this service)
    }
    try {
      offs.push(app().forClass(classId).info.detail.subscribe(() => void schedule()));
    } catch {
      // class services not available
    }
  });

  // ── reading ──

  async function readLecture(item: IndexedItem): Promise<{ value: LectureFile; newer: boolean } | null> {
    const hit = manifestCache.get(item.manifest);
    if (hit && hit.size === item.size && hit.mtimeMs === item.mtimeMs) return hit;
    const loaded = await store.readJson(item.manifest, parseLecture);
    if (!loaded || loaded.value.id !== item.id) return null;
    const v = { size: item.size, mtimeMs: item.mtimeMs, value: loaded.value, newer: loaded.newer };
    manifestCache.set(item.manifest, v);
    return v;
  }

  async function readLogs(id: Ulid): Promise<EditLog[]> {
    const logs: EditLog[] = [];
    for (const path of store.state.get().index.machine.keys()) {
      const info = classifyPath(path);
      if (info.kind !== 'edits' || info.objectId !== id) continue;
      const deviceId = writerFromPath(path);
      if (!deviceId) continue;
      const r = await store.readJsonl(path, parseEdit);
      logs.push({ deviceId, lines: r.lines.map((l) => l.value as TranscriptEditLine) });
    }
    return logs;
  }

  /** The greatest round among the lecture's transcribe claims, and the error codes of failed ones. */
  async function claimFiles(id: Ulid): Promise<{ round: number; errors: Record<DeviceId, string> }> {
    let round = 0;
    const errors: Record<DeviceId, string> = {};
    for (const path of store.state.get().index.machine.keys()) {
      const info = classifyPath(path);
      if (info.kind !== 'claims' || info.objectId !== id || info.fold) continue;
      const c = await store.readJson(path, parserFor('tramado.claim')).catch(() => null);
      if (!c) continue;
      if (Number.isInteger(c.value.round) && c.value.round > round) round = c.value.round;
      if (c.value.status === 'failed' && typeof c.value.error === 'string') errors[c.value.deviceId] = c.value.error;
    }
    return { round, errors };
  }

  /** "Finished on Ana's computer — waiting for it to arrive": who already has the transcript (sync spec §14.4). */
  async function holdersOf(path: ClassPath): Promise<DeviceId[]> {
    if (!store.state.get().entry.shared) return [];
    try {
      const [info] = await platform.sync.fileInfo(classId, [path]);
      return info && !info.globalDeleted ? info.availability : [];
    } catch {
      return [];
    }
  }

  async function readMarkers(id: Ulid): Promise<Marker[]> {
    const f = await readPrivateJson<MarkersFile>(platform, classId, privateMarkersPath(id));
    const markers = Array.isArray(f?.markers) ? f!.markers : [];
    return markers
      .filter((m) => m && isUlid(m.id) && typeof m.atMs === 'number')
      .map((m) => ({ id: m.id, atMs: m.atMs, rawMs: typeof m.rawMs === 'number' ? m.rawMs : m.atMs, kind: (MARKER_KINDS as readonly string[]).includes(m.kind) ? m.kind : 'note', ...(m.note ? { note: m.note } : {}) }))
      .sort((a, b) => a.atMs - b.atMs);
  }

  function watchClaims(id: Ulid) {
    if (claimSubs.has(id)) return;
    const cs = classServices();
    if (!cs) return;
    claimSubs.set(id, cs.claims.claims(id, 'transcribe').subscribe(() => void schedule()));
  }

  async function readRecord(item: IndexedItem): Promise<LectureRecord | null> {
    const lec = await readLecture(item);
    if (!lec) return null;
    const id = item.id;
    const dir = item.dir;
    const tPath = `${dir}/transcript.json` as ClassPath;
    const bytes = await store.readBytes(tPath).catch(() => null);
    let onDisk: LectureRecord['onDisk'] = null;
    if (bytes) {
      try {
        const raw = JSON.parse(dec.decode(bytes)) as Partial<TranscriptFile>;
        if (raw && raw.format === 'tramado.transcript' && raw.lectureId === id) {
          onDisk = { audioSha256: typeof raw.audioSha256 === 'string' ? raw.audioSha256 : null, round: Number.isInteger(raw.round) ? raw.round! : 1, writer: raw.writer?.deviceId ?? null };
        }
      } catch {
        onDisk = null;
      }
    }
    const loaded = bytes ? await store.readJson(tPath, parseTranscript).catch(() => null) : null;
    const transcript = loaded && loaded.value.lectureId === id && Array.isArray(loaded.value.segments) ? loaded.value : null;
    // A transcript is on disk but no version of it ever passed the authorship check: it is not shown.
    const untrustedTranscript = !!onDisk && !transcript;
    const logs = transcript ? await readLogs(id) : [];
    const audioSha = lec.value.audio?.sha256 ?? null;
    const r = transcript ? replay(transcript, logs, { audioSha256: audioSha, newer: loaded!.newer }) : null;
    const effective: EffectiveTranscript | null = r ? { ...r.transcript, correctedBy: namesFor(r.info.touched) } : null;
    const audioPath = `${dir}/audio.webm` as ClassPath;
    const stat = await platform.fs.stat(classId, audioPath).catch(() => null);
    watchClaims(id);
    const cs = classServices();
    const claims = cs ? cs.claims.claims(id, 'transcribe').get() : [];
    const winner = cs ? cs.claims.winner(id, 'transcribe') : null;
    const files = await claimFiles(id);
    const holders = winner?.status === 'done' && !transcript ? await holdersOf(tPath) : [];
    return {
      id, item, dir, lecture: lec.value, lectureNewer: lec.newer, transcript, transcriptNewer: loaded?.newer ?? false, onDisk, untrustedTranscript,
      logs, effective, info: r?.info ?? null, audioSize: stat && !stat.isDir ? stat.size : null, audioPath,
      round: Math.max(files.round, transcript?.round ?? 0, onDisk?.round ?? 0, 1), claimErrors: files.errors, holders,
      claims, winner, markers: await readMarkers(id), priv: await readLecturePrivate(platform, classId, id),
    };
  }

  // ── people ──

  function deviceRef(deviceId: DeviceId, fallbackName: string, memberId = ''): DeviceRef {
    const self = deviceId === me();
    if (self) {
      const id = ctx.identity.get();
      return { deviceId, deviceName: id?.deviceName || fallbackName, memberId: id?.memberId ?? memberId, memberName: id?.name || fallbackName, self };
    }
    const detail = (() => {
      try {
        return classServices()?.info.detail.get() ?? null;
      } catch {
        return null;
      }
    })();
    for (const p of [...(detail?.people ?? []), ...(detail?.unverified ?? [])]) {
      const d = p.devices.find((x) => x.deviceId === deviceId);
      if (d) return { deviceId, deviceName: d.deviceName, memberId: p.memberId, memberName: p.name, self };
    }
    return { deviceId, deviceName: fallbackName || shortIdOf(deviceId), memberId, memberName: fallbackName || shortIdOf(deviceId), self };
  }

  function namesFor(touched: Record<SegmentId, DeviceId[]>): Record<SegmentId, string[]> {
    const out: Record<SegmentId, string[]> = {};
    for (const [seg, devices] of Object.entries(touched)) out[seg] = [...new Set(devices.map((d) => deviceRef(d, shortIdOf(d)).memberName))];
    return out;
  }

  // ── views ──

  function audioState(r: LectureRecord): LectureView['audio'] {
    const a = r.lecture.audio;
    if (!a) return null;
    const recorder = r.lecture.recordedBy.deviceId === me();
    if (!a.shared) return recorder ? { present: true, arriving: false, skipped: false } : null;
    const present = r.audioSize === a.size;
    const skipped = !present && store.state.get().entry.skipAudio;
    return { present, arriving: !present && !skipped, skipped };
  }

  function transcriptionState(r: LectureRecord): TranscriptionState {
    const job = (() => {
      try {
        return app().transcription.state.get().job;
      } catch {
        return null;
      }
    })();
    if (job && job.classId === classId && job.lectureId === r.id && job.state === 'running') {
      const phase = job.phase === 'decoding' || job.phase === 'checking' || job.phase === 'vad' ? 'decoding' : 'transcribing';
      return { kind: 'local', phase, percent: Math.round(job.progress * 100), etaMin: job.etaMs === null ? null : Math.max(1, Math.ceil(job.etaMs / 60_000)) };
    }
    const t = r.transcript;
    if (t && t.round >= r.round) {
      const label = engineLabel(t.engine);
      return {
        kind: 'done', by: deviceRef(t.transcribedBy.deviceId, t.transcribedBy.name, t.transcribedBy.memberId), engine: t.engine.kind === 'cloud' ? 'cloud' : 'local',
        model: label.slice(t.engine.name.length).trim() || label, at: t.transcribedBy.at, revision: t.revision, pendingEdits: r.effective?.unfolded ?? 0,
      };
    }
    const w = r.winner;
    if (w) {
      const by = deviceRef(w.deviceId, w.who);
      if (w.status === 'done') return { kind: 'arriving', by, holders: r.holders.map((d) => deviceRef(d, shortIdOf(d))) };
      if (w.status === 'claimed' || w.status === 'working') {
        return { kind: 'claimed', by, percent: Math.round((w.progress ?? 0) * 100), etaMin: w.etaMs === null ? null : Math.max(1, Math.ceil(w.etaMs / 60_000)), quietMin: Math.floor(w.sinceMs / 60_000), health: w.health };
      }
    }
    const stale = r.claims.find((c) => (c.status === 'claimed' || c.status === 'working') && c.health === 'stale');
    if (stale) return { kind: 'claimed', by: deviceRef(stale.deviceId, stale.who), percent: Math.round((stale.progress ?? 0) * 100), etaMin: null, quietMin: Math.floor(Math.max(stale.sinceMs, STALE_MS) / 60_000), health: 'stale' };
    const failed = r.claims.find((c) => c.status === 'failed');
    if (failed) return { kind: 'failed', by: deviceRef(failed.deviceId, failed.who), code: r.claimErrors[failed.deviceId] ?? 'IO_ERROR' };
    const a = r.lecture.audio;
    if (!a) return r.lecture.audioDeletedAt ? { kind: 'unavailable', reason: 'audioDeleted' } : { kind: 'none' };
    if (!a.shared && r.lecture.recordedBy.deviceId !== me()) return { kind: 'unavailable', reason: 'transcriptOnlyElsewhere' };
    if (a.shared && r.audioSize !== a.size && !store.state.get().entry.skipAudio) return { kind: 'waitingAudio', have: r.audioSize ?? 0, size: a.size };
    return { kind: 'none' };
  }

  function markerCounts(markers: Marker[]): Record<MarkerKind, number> {
    const out = Object.fromEntries(MARKER_KINDS.map((k) => [k, 0])) as Record<MarkerKind, number>;
    for (const m of markers) out[m.kind] += 1;
    return out;
  }

  function autoMarkers(r: LectureRecord) {
    if (!r.effective) return [];
    const removed = new Set(r.priv.removedAutoMarks);
    return examRadar(r.effective, r.effective.language).filter((m) => !removed.has(m.atMs));
  }

  function viewOf(r: LectureRecord, all: Map<Ulid, LectureRecord>): LectureView {
    const l = r.lecture;
    const startMs = parseRfc3339(l.startedAt) ?? 0;
    const covered = (x: LectureRecord) => !!x.transcript || (!!x.winner && x.winner.status !== 'failed' && x.winner.status !== 'released');
    const dup = !l.duplicateOf && !r.transcript
      ? probableDuplicate({ id: r.id, startMs, durationMs: l.durationMs }, [...all.values()].filter((x) => x.id !== r.id).map((x) => ({ id: x.id, startMs: parseRfc3339(x.lecture.startedAt) ?? 0, durationMs: x.lecture.durationMs, covered: covered(x) })))
      : null;
    return {
      id: r.id, classId, title: l.title, startedAt: l.startedAt, durationMs: l.durationMs, mode: l.mode, language: l.language,
      recordedBy: deviceRef(l.recordedBy.deviceId, l.recordedBy.name, l.recordedBy.memberId),
      audio: audioState(r), transcription: transcriptionState(r), myMarkers: markerCounts(r.markers), autoExamMarks: autoMarkers(r).length,
      duplicateOf: l.duplicateOf ?? null, probableDuplicateOf: dup, newerFormat: r.lectureNewer || r.transcriptNewer, untrustedTranscript: r.untrustedTranscript,
    };
  }

  function audioSource(r: LectureRecord): AudioSource | null {
    const a = r.lecture.audio;
    if (!a) return null;
    if (!a.shared) return r.lecture.recordedBy.deviceId === me() ? { kind: 'private', recordingId: r.id } : null;
    return r.audioSize === a.size ? { kind: 'class', classId, path: r.audioPath } : null;
  }

  function loadPeaks(r: LectureRecord, source: AudioSource): number[] | null {
    const speech = platform.speech;
    const sha = r.lecture.audio?.sha256;
    if (!speech || !sha) return null;
    const hit = peaks.get(sha);
    if (Array.isArray(hit)) return hit;
    if (!hit) {
      peaks.set(sha, 'loading');
      void speech.peaks(source, PEAK_BUCKETS).then(
        (p) => {
          peaks.set(sha, p);
          void schedule();
        },
        () => peaks.set(sha, 'failed'),
      );
    }
    return null;
  }

  function resolveRef(article: string, code: string | null): { path: ClassPath; page: number | null } | null {
    const key = `${article}|${code ?? ''}`;
    const hit = refTargets.get(key);
    if (hit !== undefined) return hit === 'loading' ? null : hit;
    refTargets.set(key, 'loading');
    const number = article.replace(/[^\d].*$/, '');
    void (async () => {
      try {
        const passages = await app().search.passages(classId, `artigo ${number} art. ${number}`, { kinds: ['document'], limit: 20 });
        const p = passages.find((x) => x.locator.type === 'article' && x.locator.article.replace(/[^\dA-Za-z]/g, '').startsWith(article.replace(/[^\dA-Za-z]/g, '')) && x.source.kind === 'document');
        const target = p && p.source.kind === 'document' && p.locator.type === 'article' ? { path: p.source.path, page: p.locator.pages?.[0] ?? null } : null;
        refTargets.set(key, target);
      } catch {
        refTargets.set(key, null);
      }
      void schedule();
    })();
    return null;
  }

  function detailOf(r: LectureRecord, view: LectureView): LectureDetail {
    const source = audioSource(r);
    let audioUrl: string | null = null;
    if (source) {
      try {
        audioUrl = platform.media.url(source);
      } catch {
        audioUrl = null;
      }
    }
    const t = r.effective;
    const refs = t ? legalRefs(t, t.language).map((x) => ({ ...x, target: resolveRef(x.article, x.code) })) : [];
    return {
      view, lecture: r.lecture, transcript: t, audioUrl, peaks: source ? loadPeaks(r, source) : null, markers: r.markers,
      autoMarkers: autoMarkers(r), references: refs, aiNotes: { summary: r.priv.summary, terms: r.priv.terms },
      canEdit: canEdit(r), isOwner: !!r.transcript && r.transcript.writer.deviceId === me(),
    };
  }

  function canEdit(r: LectureRecord): boolean {
    return !!r.transcript && !r.transcriptNewer && !r.lectureNewer && r.transcript.round >= r.round && !!me() && !!ctx.identity.get();
  }

  async function load(): Promise<void> {
    const st = store.state.get();
    if (st.status !== 'ready') {
      if (st.status === 'missing' || st.status === 'error') list.set([]);
      return;
    }
    const next = new Map<Ulid, LectureRecord>();
    for (const item of st.index.lectures.values()) {
      const r = await readRecord(item).catch((e: unknown) => {
        ctx.log('warn', 'lectures: unreadable lecture', { classId, path: item.manifest, error: errorMessage(e) });
        return null;
      });
      if (r) next.set(r.id, r);
    }
    records = next;
    for (const [id, off] of claimSubs) if (!next.has(id)) {
      off();
      claimSubs.delete(id);
    }
    const views = [...next.values()].map((r) => viewOf(r, next)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    if (!sameJson(views, list.get())) list.set(views);
    for (const [id, s] of details) {
      const r = next.get(id);
      const v = views.find((x) => x.id === id);
      const d = r && v ? detailOf(r, v) : null;
      if (!sameJson(d, s.get())) s.set(d);
    }
    for (const r of next.values()) scheduleFold(r);
  }

  // ── the owner's fold ──

  function scheduleFold(r: LectureRecord) {
    const mineOwner = !!r.transcript && r.transcript.writer.deviceId === me() && !r.transcriptNewer && r.transcript.round >= r.round;
    const pending = mineOwner ? (r.info?.ops ?? 0) : 0;
    const cur = foldTimers.get(r.id);
    if (pending === 0) {
      cur?.timer();
      foldTimers.delete(r.id);
      return;
    }
    if (cur && cur.ops === pending) return;   // no new edit since the timer started
    cur?.timer();
    const timer = clock.setTimeout(() => {
      foldTimers.delete(r.id);
      const p = foldNow(r.id, false)
        .catch((e: unknown) => ctx.log('warn', 'lectures: fold failed', { classId, lectureId: r.id, error: errorMessage(e) }))
        .finally(() => folding.delete(p));
      folding.add(p);
    }, FOLD_DEBOUNCE_MS);
    foldTimers.set(r.id, { timer, ops: pending });
  }

  async function foldNow(id: Ulid, takeOver: boolean): Promise<number | null> {
    await schedule();
    const r = records.get(id);
    if (!r || !r.transcript || r.transcriptNewer || r.lectureNewer) return null;
    const deviceId = me();
    const identity = ctx.identity.get();
    if (!deviceId || !identity) return null;
    if (!takeOver) {
      // A returning former owner checks the current writer and the fold claims before writing (sync spec §14.8).
      if (r.transcript.writer.deviceId !== deviceId) return null;
      const foldWinner = classServices()?.claims.winner(id, 'fold') ?? null;
      if (foldWinner && !foldWinner.mine) return null;
    }
    const out = foldTranscript(r.transcript, r.logs, { at: instant(clock.now()), ...(takeOver ? { writer: { deviceId, memberId: identity.memberId } } : {}) });
    if (!out) return null;
    await writeTranscriptFiles(r, out.transcript);
    await schedule();
    return out.transcript.revision;
  }

  /** transcript.json, then .md, then .vtt (folder spec §8.8), into the lecture's current directory. */
  async function writeTranscriptFiles(r: LectureRecord, t: TranscriptFile): Promise<void> {
    const dir = store.state.get().index.lectures.get(r.id)?.dir ?? r.dir;
    await store.writeJson(`${dir}/transcript.json`, t, { own: true });
    await store.writeText(`${dir}/transcript.md`, renderMarkdown(t, r.lecture), { own: true });
    await store.writeText(`${dir}/transcript.vtt`, renderVtt(t), { own: true });
  }

  // ── actions ──

  async function record(id: Ulid): Promise<LectureRecord> {
    if (!records.has(id)) await schedule();
    const r = records.get(id);
    if (!r) throw new PlatformError('NOT_FOUND', `no lecture ${id}`);
    return r;
  }

  async function recorderOnly(id: Ulid): Promise<LectureRecord> {
    const r = await record(id);
    if (r.lectureNewer) throw new PlatformError('NEWER_FORMAT', 'this lecture was made with a newer Tramado');
    if (r.lecture.recordedBy.deviceId !== me()) throw new PlatformError('PERMISSION_DENIED', `only ${r.lecture.recordedBy.name}'s computer can change this lecture`, { name: r.lecture.recordedBy.name });
    return r;
  }

  async function rewriteLecture(r: LectureRecord, patch: (l: LectureFile) => LectureFile): Promise<void> {
    const raw = await store.readJson(r.item.manifest, parseLecture);
    const current = raw?.value ?? r.lecture;
    const next = mergeUnknown(current, { ...patch(current), updatedAt: instant(clock.now()) });
    manifestCache.delete(r.item.manifest);
    await store.writeJson(r.item.manifest, next, { own: true, manifest: true });
    await schedule();
  }

  async function editable(id: Ulid): Promise<LectureRecord & { transcript: TranscriptFile; effective: EffectiveTranscript }> {
    const r = await record(id);
    if (!r.transcript || !r.effective) throw new PlatformError('NOT_FOUND', 'this lecture has no transcript yet');
    if (r.transcriptNewer || r.lectureNewer) throw new PlatformError('NEWER_FORMAT', 'made with a newer Tramado');
    if (!canEdit(r)) throw new PlatformError('PERMISSION_DENIED', 'this transcript cannot be corrected now');
    return r as LectureRecord & { transcript: TranscriptFile; effective: EffectiveTranscript };
  }

  function stampFor(r: { transcript: TranscriptFile }, register: string | null | undefined, lww: boolean): EditStamp {
    const identity = ctx.identity.get();
    if (!identity) throw new PlatformError('INVALID', 'no identity yet');
    return {
      id: newUlid(clock.now(), ctx.rand), hlc: lww ? ctx.hlc.override(register ?? null) : ctx.hlc.tick(), ms: clock.now(), memberId: identity.memberId,
      transcript: { lectureId: r.transcript.lectureId, round: r.transcript.round, revision: r.transcript.revision },
    };
  }

  async function append(id: Ulid, line: TranscriptEditLine): Promise<void> {
    await store.appendLine(editLogPath(id, me()), line);
    await schedule();
  }

  const segmentOf = (r: { effective: EffectiveTranscript }, segmentId: SegmentId) => {
    const s = r.effective.segments.find((x) => x.id === segmentId) ?? r.effective.segments.find((x) => x.merged?.includes(segmentId));
    if (!s) throw new PlatformError('NOT_FOUND', `no segment ${segmentId}`);
    return s;
  };

  const service: LectureServiceImpl = {
    list,
    open(id) {
      let s = details.get(id);
      if (!s) {
        s = new Store<LectureDetail | null>(null);
        details.set(id, s);
        const r = records.get(id);
        const v = list.get().find((x) => x.id === id);
        if (r && v) s.set(detailOf(r, v));
        void schedule();
      }
      return s as ReadableStore<LectureDetail | null>;
    },
    async rename(id, title) {
      const t = title.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!t || [...t].length > 200) throw new PlatformError('INVALID', 'a title has 1–200 characters');
      const r = await recorderOnly(id);
      await rewriteLecture(r, (l) => ({ ...l, title: t }));
    },
    async markDuplicate(id, of) {
      if (of !== null && (!isUlid(of) || of === id)) throw new PlatformError('INVALID', 'not a lecture id');
      const r = await recorderOnly(id);
      await rewriteLecture(r, (l) => {
        const next = { ...l };
        if (of) next.duplicateOf = of;
        else delete next.duplicateOf;
        return next;
      });
    },
    async deleteLecture(id) {
      const r = await recorderOnly(id);
      if (r.dir) await store.remove(r.dir, { recursive: true });
      else for (const name of ['lecture.json', 'audio.webm', 'transcript.json', 'transcript.md', 'transcript.vtt']) await store.remove(name).catch(() => undefined);   // a lecture at the class root
      await store.remove(editLogPath(id, me())).catch(() => undefined);
      for (const p of [privateMarkersPath(id), privateLecturePath(id)]) await platform.privateFiles.remove(classId, p).catch(() => undefined);
      manifestCache.delete(r.item.manifest);
      await schedule();
    },
    async deleteAudio(id) {
      const r = await recorderOnly(id);
      if (!r.lecture.audio) return;
      if (r.lecture.audio.shared) await store.remove(r.audioPath).catch((e: unknown) => {
        if (toPlatformError(e).code !== 'NOT_FOUND') throw e;
      });
      else await platform.speech?.recorder.discard(id).catch(() => undefined);
      await rewriteLecture(r, (l) => ({ ...l, audio: null, audioDeletedAt: instant(clock.now()) }));
    },
    markers: {
      async add(id, m) {
        if (!(MARKER_KINDS as readonly string[]).includes(m.kind) || !Number.isFinite(m.atMs) || m.atMs < 0) throw new PlatformError('INVALID', 'not a marker');
        await record(id);
        const identity = ctx.identity.get();
        const markers = await readMarkers(id);
        const marker: Marker = { id: newUlid(clock.now(), ctx.rand), atMs: Math.round(m.atMs), rawMs: Math.round(m.rawMs ?? m.atMs), kind: m.kind, ...(m.note?.trim() ? { note: [...m.note.trim()].slice(0, 200).join('') } : {}) };
        await writeMarkers(id, [...markers, marker], identity?.memberId ?? '');
      },
      async remove(id, markerId) {
        const identity = ctx.identity.get();
        const markers = await readMarkers(id);
        await writeMarkers(id, markers.filter((m) => m.id !== markerId), identity?.memberId ?? '');
      },
      async removeAuto(id, atMs) {
        await updateLecturePrivate(platform, classId, id, (p) => ({ ...p, removedAutoMarks: [...new Set([...p.removedAutoMarks, Math.round(atMs)])] }));
        await schedule();
      },
    },
    async share(id, mode) {
      await app().recording.share(id, mode);
      await schedule();
    },
    async exportTranscript(id, format, pick) {
      const r = await record(id);
      if (!r.effective) throw new PlatformError('NOT_FOUND', 'this lecture has no transcript yet');
      const t = r.effective;
      const text = format === 'md' ? renderMarkdown(t, r.lecture) : format === 'vtt' ? renderVtt(t) : renderText(t, r.lecture.title);
      const tmp = `.tramado/tmp/export-${newUlid(clock.now(), ctx.rand).toLowerCase()}.part`;
      await platform.fs.write(classId, tmp, enc.encode(text), { own: true });
      try {
        await platform.fs.exportFile(classId, tmp, pick.token);
      } finally {
        await platform.fs.remove(classId, tmp).catch(() => undefined);
      }
    },
    edit: {
      async setText(id, segmentId, text) {
        const r = await editable(id);
        const seg = segmentOf(r, segmentId);
        const next = normalizeText(text);
        if ([...next].length > MAX_SEGMENT_CHARS) throw new PlatformError('INVALID', 'a line has at most 8 000 characters');
        if (next === seg.text && !r.effective.concurrent.includes(seg.id)) return;
        await append(id, setTextOp(stampFor(r, seg.editHlc?.text, true), seg.id, seg.text, next));
      },
      async setSpeaker(id, segmentId, speaker) {
        if (!isSpeakerId(speaker)) throw new PlatformError('INVALID', `not a speaker id: ${speaker}`);
        const r = await editable(id);
        const seg = segmentOf(r, segmentId);
        if (seg.speaker === speaker) return;
        await append(id, setSpeakerOp(stampFor(r, seg.editHlc?.speaker, true), seg.id, speaker));
      },
      async split(id, segmentId, atChar) {
        const r = await editable(id);
        const seg = segmentOf(r, segmentId);
        if (!Number.isInteger(atChar) || atChar <= 0 || atChar >= seg.text.length) throw new PlatformError('INVALID', 'split inside the line');
        const used = new Set(r.effective.segments.flatMap((s) => [s.id, ...(s.merged ?? [])]));
        for (const l of r.logs) for (const x of l.lines) if (x.newId) used.add(x.newId);
        let newId = newSegmentId(ctx.rand);
        while (used.has(newId)) newId = newSegmentId(ctx.rand);
        await append(id, splitOp(stampFor(r, null, false), seg.id, atChar, splitTime(seg, atChar), newId));
        return newId;
      },
      async merge(id, segmentId) {
        const r = await editable(id);
        const seg = segmentOf(r, segmentId);
        const i = r.effective.segments.indexOf(seg);
        const next = r.effective.segments[i + 1];
        if (!next) throw new PlatformError('INVALID', 'the last line has nothing to merge with');
        await append(id, mergeOp(stampFor(r, null, false), seg.id, next.id));
      },
      async labelSpeaker(id, speakerId, label) {
        if (!isSpeakerId(speakerId)) throw new PlatformError('INVALID', `not a speaker id: ${speakerId}`);
        const l = normalizeLabel(label);
        if (!l) throw new PlatformError('INVALID', 'a speaker label cannot be empty');
        const r = await editable(id);
        if (r.effective.speakers.find((s) => s.id === speakerId)?.label === l) return;
        await append(id, labelSpeakerOp(stampFor(r, r.info?.speakerHlc[speakerId] ?? null, true), speakerId, l));
      },
      async keep(id, segmentId) {
        const r = await editable(id);
        const seg = segmentOf(r, segmentId);
        await append(id, setTextOp(stampFor(r, seg.editHlc?.text, true), seg.id, seg.text, seg.text));
      },
    },
    fold: (id, opts) => foldNow(id, opts?.takeOver ?? false),
    records: () => records,
    refresh: () => schedule(),
    async idle() {
      for (let i = 0; i < 20 && (running || folding.size); i++) {
        if (folding.size) await Promise.all([...folding]);
        if (running) await running;
      }
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      for (const off of claimSubs.values()) off();
      for (const f of foldTimers.values()) f.timer();
      foldTimers.clear();
    },
  };

  async function writeMarkers(id: Ulid, markers: Marker[], memberId: string) {
    const file: MarkersFile = {
      format: 'tramado.markers', version: 1, lectureId: id, deviceId: me(), memberId, hlc: ctx.hlc.tick(),
      markers: [...markers].sort((a, b) => a.atMs - b.atMs).map((m) => ({ id: m.id, atMs: m.atMs, rawMs: m.rawMs, kind: m.kind, ...(m.note ? { note: m.note } : {}) })),
    };
    await writePrivateJson(platform, classId, privateMarkersPath(id), file);
    await schedule();
  }

  return service;
}
