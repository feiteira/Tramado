// RecordingService (architecture §11.2): the recorder with its consent lines (folder spec §8.5) and presence
// (§8.4), the input meter, publishing (`speech.recorder.publish`, then `lecture.json` with the audio's size and
// SHA-256, channels, pauses and consent refs, folder spec §8.6), "transcript only" and "keep it here for now",
// audio imports, and recovery at start-up. The lecture id is derived from this device and a nonce (§2.1); the
// nonce is kept in a private draft file from the first moment so a crashed recording can still be published.
import { PlatformError, toPlatformError } from '../core/errors';
import { itemIdOf, newNonce } from '../core/model/derive';
import type { LectureFile, MarkersFile } from '../core/model/files';
import type { ClassId, ClassPath, DeviceId, Lang, Nonce, Ulid } from '../core/model/ids';
import { fitClassPath, lectureDirName, unique } from '../core/model/sanitize';
import { instant, parseRfc3339 } from '../core/model/time';
import { renderMarkdown, renderVtt, utcOffsetMinAt } from '../core/transcript/render';
import { transcriptFromCues } from '../core/transcript/fromCues';
import { parseVtt } from '../core/import/vtt';
import type { TranscriptFile } from '../core/model/files';
import type { FinishedRecording, ImportEvent, Marker, Picked, PublishedAudio, RecorderEvent, ShareMode } from '../platform/types';
import type { AppContext } from './context';
import { privateMarkersPath, readPrivateJson, updateLecturePrivate, writePrivateJson, type LectureServiceImpl } from './lectures';
import { Store } from './store';
import type { ConsentInput } from './types/class';
import type { AppServices } from './types/common';
import type { ImportProgress, RecordingService, RecordingState, StopReason } from './types/recording';

type Transcribe = 'here' | 'cloud' | 'classmate' | 'later';

/** private/<classId>/drafts/<recordingId>.json: what a recording needs until its lecture.json exists. */
export interface RecordingDraftFile {
  format: 'tramado.recording-draft'; version: 1;
  recordingId: Ulid; classId: ClassId; idNonce: Nonce; startedAtMs: number; title: string;
  mode: 'room' | 'online' | 'import'; language: Lang | 'auto';
  consent: Array<{ deviceId: DeviceId; id: Ulid }>;
  share: ShareMode | null; transcribe: Transcribe | null;
  import?: { fileName: string; mime: string; hadVideo: boolean; lectureDir: ClassPath };
  /** INT: the subtitles picked with an import (UX §3.6.6), written as the transcript once the audio is in. */
  subtitles?: { fileName: string; text: string };
}
export const draftPath = (id: Ulid) => `drafts/${id}.json`;

const VIDEO = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
};
const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
const cleanTitle = (t: string, fallback: string) => {
  const s = t.normalize('NFC').replace(/\s+/g, ' ').trim();
  return [...(s || fallback.trim() || 'Untitled')].slice(0, 200).join('');
};

export interface RecordingServiceImpl extends RecordingService {
  /** Resolves when the asynchronous follow-ups (claims after publish, imports) settled (tests). */
  idle(): Promise<void>;
}

export function createRecordingService(ctx: AppContext, app: () => AppServices): RecordingServiceImpl {
  const { platform, clock } = ctx;
  const state = new Store<RecordingState | null>(null);
  const pending = new Store<FinishedRecording[]>([]);
  const meter = new Store<{ mic: RecordingState['status']['tracks']['mic']; system: RecordingState['status']['tracks']['system'] } | null>(null);
  const imports = new Store<ImportProgress[]>([]);
  const stopReason = new Store<StopReason | null>(null);
  const followUps = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    const q = p.catch((e: unknown) => ctx.log('warn', 'recording: follow-up failed', { error: toPlatformError(e).message })).finally(() => followUps.delete(q));
    followUps.add(q);
  };

  const speech = () => {
    const s = platform.speech;
    if (!s) throw new PlatformError('INVALID', 'recording is not available in this build');
    return s;
  };
  const me = () => {
    const device = ctx.device.get();
    const identity = ctx.identity.get();
    if (!device || !identity) throw new PlatformError('INVALID', 'no identity yet');
    return { deviceId: device.deviceId, memberId: identity.memberId, name: identity.name };
  };
  const classOf = (classId: ClassId) => app().forClass(classId);

  async function setPresence(classId: ClassId, recording: { draftId: Ulid; startedAt: string; mode: 'room' | 'online'; title?: string } | null) {
    try {
      await classOf(classId).presence.setActivity(recording ? { recording } : { recording: undefined });
    } catch (e) {
      ctx.log('warn', 'recording: presence not written', { error: toPlatformError(e).message });
    }
  }

  const readDraft = (classId: ClassId, id: Ulid) => readPrivateJson<RecordingDraftFile>(platform, classId, draftPath(id));
  const writeDraft = (d: RecordingDraftFile) => writePrivateJson(platform, d.classId, draftPath(d.recordingId), d);

  // INT review: markers undone after their recording stopped. Rust can only unmark a running recording, so its journal
  // still has them: they are left out of the pending list and of what publish() writes (this session).
  const unmarked = new Set<string>();
  const withoutUnmarked = (r: FinishedRecording): FinishedRecording =>
    unmarked.size && r.markers.some((m) => unmarked.has(m.id)) ? { ...r, markers: r.markers.filter((m) => !unmarked.has(m.id)) } : r;

  async function refreshPending(): Promise<FinishedRecording[]> {
    const s = platform.speech;
    if (!s) return [];
    const list = (await s.recorder.pending()).map(withoutUnmarked);
    pending.set(list);
    return list;
  }

  function onRecorder(e: RecorderEvent) {
    const cur = state.get();
    switch (e.type) {
      case 'status':
        if (cur) state.set({ ...cur, status: e.status });
        break;
      case 'warning':
        if (cur && !cur.warnings.includes(e.code)) state.set({ ...cur, warnings: [...cur.warnings, e.code] });
        break;
      case 'marker':
        if (cur && !cur.markers.some((m) => m.id === e.marker.id)) state.set({ ...cur, markers: [...cur.markers, e.marker] });
        break;
      case 'stopped':
        if (cur) {
          state.set(null);
          void setPresence(cur.classId, null);
          if (e.reason !== 'user') stopReason.set({ recordingId: cur.status.recordingId, classId: cur.classId, title: cur.title, reason: e.reason, code: e.code ?? null });
        }
        track(refreshPending());
        break;
    }
  }

  async function recordConsent(classId: ClassId, recordingId: Ulid, input: ConsentInput, remember: boolean, kind: 'record' | 'share') {
    const scope = remember ? 'class' : 'lecture';
    const line: ConsentInput = { ...input, kind, scope };
    if (scope === 'lecture') line.lectureId = recordingId;
    else delete line.lectureId;
    return classOf(classId).info.consent.record(line);
  }

  async function lectureDirFor(classId: ClassId, startedAtMs: number, title: string): Promise<ClassPath> {
    const store = classOf(classId).store;
    const parent = store.dir('lectures');
    await platform.fs.mkdir(classId, parent).catch(() => undefined);
    const siblings = (await platform.fs.list(classId, parent, { recursive: false }).catch(() => [])).map((e) => e.name);
    const name = unique(siblings, lectureDirName(startedAtMs, title, localZone()));
    const path = fitClassPath(parent, name);
    if (!path) throw new PlatformError('INVALID', 'the lectures folder path is too long');
    return path;
  }

  async function writeLecture(input: {
    draft: RecordingDraftFile; rec: Pick<FinishedRecording, 'startedAt' | 'language' | 'speakers' | 'pauses' | 'markers'> & { mode: LectureFile['mode'] };
    title: string; audio: PublishedAudio; share: 'audio+transcript' | 'transcript-only'; lectureDir: ClassPath;
    /** INT: the transcript to publish with the lecture (imported subtitles), written right after lecture.json. */
    transcript?: (lecture: LectureFile) => TranscriptFile | null;
  }): Promise<Ulid> {
    const who = me();
    const { draft, rec, audio } = input;
    const startMs = parseRfc3339(rec.startedAt) ?? draft.startedAtMs;
    let id = draft.recordingId;
    let nonce = draft.idNonce;
    if (id !== itemIdOf(draft.startedAtMs, who.deviceId, nonce)) {
      // The draft is not this device's (or was lost): a fresh derived id keeps the manifest trustworthy.
      nonce = newNonce(ctx.rand);
      id = itemIdOf(startMs, who.deviceId, nonce);
      ctx.log('warn', 'recording: draft did not derive the id; a new lecture id was made', { recordingId: draft.recordingId });
    }
    const channels: LectureFile['channels'] = rec.speakers.length ? rec.speakers.map((s) => ({ index: s.index, speaker: s.speaker })) : [{ index: 0, speaker: 'lecture' }];
    // `utcOffsetMin` (folder spec §8.6, G2): the recorder's UTC offset at startedAt, for the local date of transcript.md.
    // (LectureFile gains the field through the integrator; the parser keeps it as a field it does not know yet.)
    const lecture: LectureFile = {
      format: 'tramado.lecture', version: 1, id, idNonce: nonce, title: input.title, startedAt: instant(startMs), utcOffsetMin: utcOffsetMinAt(startMs), durationMs: Math.round(audio.durationMs),
      mode: rec.mode, language: rec.language, recordedBy: { memberId: who.memberId, deviceId: who.deviceId, name: who.name.slice(0, 64) },
      audio: {
        file: 'audio.webm', shared: input.share === 'audio+transcript', codec: 'opus', container: 'webm', sampleRate: 16000,
        channels: audio.channels, bitrate: audio.bitrate, size: audio.size, sha256: audio.sha256,
      },
      channels, pauses: rec.pauses, consent: draft.consent,
      ...(draft.import ? { import: { fileName: draft.import.fileName, mime: draft.import.mime, hadVideo: draft.import.hadVideo } } : {}),
      updatedAt: instant(clock.now()),
    };
    const store = classOf(draft.classId).store;
    await store.writeJson(`${input.lectureDir}/lecture.json`, lecture, { own: true, manifest: true });
    const transcript = input.transcript?.(lecture) ?? null;
    if (transcript) {
      // folder spec §8.8: transcript.json first, then .md and .vtt (no claim: round 1 is the importer's).
      await store.writeJson(`${input.lectureDir}/transcript.json`, transcript, { own: true });
      await store.writeText(`${input.lectureDir}/transcript.md`, renderMarkdown(transcript, lecture), { own: true });
      await store.writeText(`${input.lectureDir}/transcript.vtt`, renderVtt(transcript), { own: true });
    }
    if (rec.markers.length) {
      const markers: MarkersFile = {
        format: 'tramado.markers', version: 1, lectureId: id, deviceId: who.deviceId, memberId: who.memberId, hlc: ctx.hlc.tick(),
        markers: [...rec.markers].sort((a, b) => a.atMs - b.atMs).map((m) => ({ id: m.id, atMs: m.atMs, rawMs: m.rawMs, kind: m.kind, ...(m.note ? { note: m.note } : {}) })),
      };
      await writePrivateJson(platform, draft.classId, privateMarkersPath(id), markers);
    }
    const t = draft.transcribe;
    if (t === 'classmate' || t === 'later') await updateLecturePrivate(platform, draft.classId, id, (p) => ({ ...p, noAutoClaim: true }));
    await platform.privateFiles.remove(draft.classId, draftPath(draft.recordingId)).catch(() => undefined);
    const lectures = classOf(draft.classId).lectures as Partial<LectureServiceImpl>;
    await lectures.refresh?.();
    if (t === 'here' || t === 'cloud') {
      track(app().transcription.claim(draft.classId, id, t === 'here' ? 'local' : 'cloud'));
    }
    return id;
  }

  async function publish(recIn: FinishedRecording, opts: { title: string; share: ShareMode; transcribe: Transcribe }): Promise<Ulid> {
    const s = speech();
    const rec = withoutUnmarked(recIn);
    const title = cleanTitle(opts.title, rec.title);
    let draft = await readDraft(rec.classId, rec.recordingId);
    if (!draft) {
      // A journal from before this app kept drafts: the id cannot be re-derived, writeLecture makes a new one.
      draft = {
        format: 'tramado.recording-draft', version: 1, recordingId: rec.recordingId, classId: rec.classId, idNonce: newNonce(ctx.rand),
        startedAtMs: parseRfc3339(rec.startedAt) ?? clock.now(), title, mode: rec.mode, language: rec.language, consent: [], share: null, transcribe: null,
      };
    }
    draft = { ...draft, title, share: opts.share, transcribe: opts.transcribe };
    if (opts.share === 'none') {
      // "Nothing yet": nothing is written to the class; the recording stays pending on this computer.
      await writeDraft(draft);
      await refreshPending();
      return draft.recordingId;
    }
    const lectureDir = draft.import?.lectureDir ?? (await lectureDirFor(rec.classId, draft.startedAtMs, title));
    const audio = await s.recorder.publish({ recordingId: rec.recordingId, classId: rec.classId, lectureDir, share: opts.share });
    const id = await writeLecture({ draft, rec: { ...rec, mode: draft.mode === 'import' ? 'import' : rec.mode }, title, audio, share: opts.share, lectureDir });
    await refreshPending();
    return id;
  }

  /** Waits for an import's channel to finish, then writes its lecture.json. */
  function followImport(draft: RecordingDraftFile, title: string): { onEvent: (e: ImportEvent) => void; done: Promise<Ulid> } {
    let resolve!: (id: Ulid) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<Ulid>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const setProgress = (p: number | null) =>
      imports.update((xs) => (p === null ? xs.filter((x) => x.recordingId !== draft.recordingId) : xs.map((x) => (x.recordingId === draft.recordingId ? { ...x, progress: p } : x))));
    const onEvent = (e: ImportEvent) => {
      if (e.type === 'progress') setProgress(Math.max(0, Math.min(1, e.done)));
      else if (e.type === 'failed') {
        setProgress(null);
        reject(new PlatformError(e.code, e.message));
      } else {
        setProgress(null);
        const subs = draft.subtitles;
        writeLecture({
          draft, title, audio: e.audio, share: 'audio+transcript', lectureDir: draft.import!.lectureDir,
          rec: { startedAt: instant(draft.startedAtMs), language: draft.language, speakers: [], pauses: [], markers: [], mode: 'import' },
          ...(subs ? { transcript: (lecture: LectureFile) => subtitlesTranscript(lecture, subs) } : {}),
        }).then(resolve, reject);
      }
    };
    imports.update((xs) => [...xs.filter((x) => x.recordingId !== draft.recordingId), { recordingId: draft.recordingId, classId: draft.classId, name: draft.import!.fileName, title, progress: 0 }]);
    return { onEvent, done };
  }

  /** Imported subtitles → transcript.json (null, logged, when they hold no cue). */
  function subtitlesTranscript(lecture: LectureFile, subs: { fileName: string; text: string }): TranscriptFile | null {
    const identity = ctx.identity.get();
    const device = ctx.device.get();
    if (!identity || !device) return null;
    const t = transcriptFromCues(parseVtt(subs.text).cues, {
      lecture, writer: { deviceId: device.deviceId, memberId: identity.memberId, name: identity.name }, at: instant(clock.now()), rand: ctx.rand,
    });
    if (!t) ctx.log('warn', 'recording: the subtitles held no cue', { file: subs.fileName });
    return t;
  }

  /** The text of a picked .vtt (≤ 4 MiB), copied through the class's ignored tmp folder (picks are tokens, D-4). */
  async function readSubtitles(classId: ClassId, recordingId: Ulid, pick: Picked): Promise<{ fileName: string; text: string } | null> {
    if (pick.size !== null && pick.size > 4 * 1024 * 1024) return null;
    const tmp = `.tramado/tmp/${recordingId}.vtt`;
    try {
      await platform.fs.importFile(classId, pick.token, tmp);
      const bytes = await platform.fs.read(classId, tmp);
      return { fileName: pick.name, text: new TextDecoder().decode(bytes) };
    } catch (e) {
      ctx.log('warn', 'recording: the subtitles could not be read', { error: toPlatformError(e).message });
      return null;
    } finally {
      await platform.fs.remove(classId, tmp).catch(() => undefined);
    }
  }

  const service: RecordingServiceImpl = {
    state,
    pending,
    meter,
    imports,
    stopReason,
    async startMeter(req) {
      const s = speech();
      await s.meter.start(req, (e) => meter.set({ mic: e.mic, system: e.system }));
    },
    async stopMeter() {
      meter.set(null);
      await platform.speech?.meter.stop();
    },
    async start(input) {
      const s = speech();
      if (state.get()) throw new PlatformError('JOB_BUSY', 'already recording');
      stopReason.set(null);
      const who = me();
      const cls = classOf(input.classId);
      const startMs = clock.now();
      const idNonce = newNonce(ctx.rand);
      const recordingId = itemIdOf(startMs, who.deviceId, idNonce);
      const title = cleanTitle(input.title, 'Untitled');
      const draft: RecordingDraftFile = {
        format: 'tramado.recording-draft', version: 1, recordingId, classId: input.classId, idNonce, startedAtMs: startMs, title,
        mode: input.mode, language: input.language, consent: [], share: null, transcribe: null,
      };
      // The consent lines come first (folder spec §8.5): `record`, then `share` in a shared class.
      draft.consent.push(await recordConsent(input.classId, recordingId, input.consent.record, input.consent.remember, 'record'));
      if (input.consent.share && cls.store.state.get().entry.shared) {
        draft.consent.push(await recordConsent(input.classId, recordingId, input.consent.share, input.consent.remember, 'share'));
      }
      await writeDraft(draft);
      await setPresence(input.classId, { draftId: recordingId, startedAt: instant(startMs), mode: input.mode, title });
      const bitrate = input.mode === 'online' && input.includeMic ? 32000 : ctx.prefs.get('speech.bitrate') === '16000' ? 16000 : 24000;
      const offset = Number(ctx.prefs.get('speech.markerOffsetMs'));
      try {
        const status = await s.recorder.start(
          {
            recordingId, classId: input.classId, title, mode: input.mode, includeMic: input.mode === 'room' ? true : input.includeMic,
            inputDeviceId: input.inputDeviceId, language: input.language, bitrate, markerOffsetMs: Number.isFinite(offset) ? offset : 3000,
          },
          onRecorder,
        );
        state.set({ status, classId: input.classId, title, markers: [], warnings: [] });
      } catch (e) {
        await setPresence(input.classId, null);
        await platform.privateFiles.remove(input.classId, draftPath(recordingId)).catch(() => undefined);
        throw e;
      }
    },
    async pause() {
      const status = await speech().recorder.pause();
      const cur = state.get();
      if (cur) state.set({ ...cur, status });
    },
    async resume() {
      const status = await speech().recorder.resume();
      const cur = state.get();
      if (cur) state.set({ ...cur, status });
    },
    async mark(kind, note, atMs) {
      const marker: Marker = await speech().recorder.mark(kind, note, atMs);
      const cur = state.get();
      if (cur && !cur.markers.some((m) => m.id === marker.id)) state.set({ ...cur, markers: [...cur.markers, marker] });
      return marker;
    },
    async removeMarker(markerId) {
      if (state.get()) {
        try {
          await speech().recorder.unmark(markerId);
          const now = state.get();
          if (now) state.set({ ...now, markers: now.markers.filter((m) => m.id !== markerId) });
          return;
        } catch (e) {
          // The recording stopped between the click and the call: undo it in the recording waiting to be saved.
          if (state.get() || toPlatformError(e).code !== 'NOT_FOUND') throw e;
        }
      }
      // Stopped meanwhile: the marker is in the recording waiting to be saved; publish() leaves it out.
      unmarked.add(markerId);
      pending.update((xs) => xs.map(withoutUnmarked));
    },
    async stop() {
      const cur = state.get();
      const rec = await speech().recorder.stop();
      stopReason.set(null);
      state.set(null);
      if (cur) await setPresence(cur.classId, null);
      pending.update((xs) => [...xs.filter((x) => x.recordingId !== rec.recordingId), rec]);
      return rec;
    },
    publish,
    async importAudio(classId, pick, opts) {
      const s = speech();
      const who = me();
      const o = opts;
      const startMs = (opts.startedAt ? parseRfc3339(opts.startedAt) : null) ?? clock.now();
      const idNonce = newNonce(ctx.rand);
      const recordingId = itemIdOf(startMs, who.deviceId, idNonce);
      const title = cleanTitle(opts.title, pick.name.replace(/\.[^.]*$/, ''));
      const lectureDir = await lectureDirFor(classId, startMs, title);
      const consent: RecordingDraftFile['consent'] = [];
      if (o.consent) consent.push(await recordConsent(classId, recordingId, o.consent, false, 'share'));
      const language: Lang | 'auto' = o.language ?? ((app().library.classes.get().find((c) => c.id === classId)?.language as Lang | undefined) || 'auto');
      const draft: RecordingDraftFile = {
        format: 'tramado.recording-draft', version: 1, recordingId, classId, idNonce, startedAtMs: startMs, title, mode: 'import', language, consent,
        share: 'audio+transcript', transcribe: o.transcribe ?? 'later',
        import: { fileName: pick.name, mime: mimeOf(pick.name), hadVideo: VIDEO.test(pick.name) && opts.keepVideo, lectureDir },
      };
      if (o.subtitles) {
        const subs = await readSubtitles(classId, recordingId, o.subtitles);
        // The subtitles are the transcript: nobody transcribes the recording again.
        if (subs) Object.assign(draft, { subtitles: subs, transcribe: 'later' });
      }
      await writeDraft(draft);
      const follow = followImport(draft, title);
      try {
        await s.importAudio({ recordingId, pick: pick.token, classId, lectureDir, keepVideo: opts.keepVideo }, follow.onEvent);
      } catch (e) {
        imports.update((xs) => xs.filter((x) => x.recordingId !== recordingId));
        await platform.privateFiles.remove(classId, draftPath(recordingId)).catch(() => undefined);
        throw e;
      }
      return follow.done;
    },
    async discard(recordingId) {
      const rec = pending.get().find((r) => r.recordingId === recordingId);
      await speech().recorder.discard(recordingId);
      if (rec) await platform.privateFiles.remove(rec.classId, draftPath(recordingId)).catch(() => undefined);
      pending.update((xs) => xs.filter((x) => x.recordingId !== recordingId));
      await refreshPending();
    },
    async recover() {
      const s = platform.speech;
      if (!s) return;
      const status = await s.recorder.attach(onRecorder);
      if (status) {
        const draft = await readDraft(status.classId, status.recordingId);
        state.set({ status, classId: status.classId, title: draft?.title ?? '', markers: [], warnings: [] });
        if (draft) await setPresence(status.classId, { draftId: status.recordingId, startedAt: instant(draft.startedAtMs), mode: draft.mode === 'online' ? 'online' : 'room', title: draft.title });
      }
      const list = await refreshPending();
      for (const r of list.filter((x) => x.state === 'recovered')) {
        const name = app().library.classes.get().find((c) => c.id === r.classId)?.name ?? '';
        void Promise.resolve().then(() => app().notifications.notify('recording', 'notify.recordingInterrupted', { class: name }, `recovered-${r.recordingId}`)).catch(() => undefined);
      }
      // Imports that kept converting in Rust while the webview reloaded.
      for (const c of app().library.classes.get()) {
        const names = await platform.privateFiles.list(c.id, 'drafts').catch(() => [] as string[]);
        for (const n of names) {
          const draft = await readPrivateJson<RecordingDraftFile>(platform, c.id, n.includes('/') ? n : `drafts/${n}`);
          if (!draft?.import || imports.get().some((x) => x.recordingId === draft.recordingId) || list.some((p) => p.recordingId === draft.recordingId)) continue;
          const follow = followImport(draft, draft.title);
          const ok = await s.attachImport(draft.recordingId, follow.onEvent).catch(() => false);
          if (ok) track(follow.done);
          else imports.update((xs) => xs.filter((x) => x.recordingId !== draft.recordingId));
        }
      }
    },
    async share(recordingId, mode) {
      const list = await refreshPending();
      const rec = list.find((r) => r.recordingId === recordingId);
      if (!rec) throw new PlatformError('NOT_FOUND', 'no recording kept on this computer with this id');
      const draft = await readDraft(rec.classId, recordingId);
      return publish(rec, { title: draft?.title ?? rec.title, share: mode, transcribe: draft?.transcribe ?? 'later' });
    },
    async idle() {
      for (let i = 0; i < 10 && followUps.size; i++) await Promise.all([...followUps]);
    },
  };
  return service;
}
