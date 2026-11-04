// TranscriptionQueue (architecture §11.2; sync spec §14): which lectures this computer may transcribe
// (eligibility §14.2, with the SHA-256 check of the local audio), volunteering with capability delays and the
// one-time notice (§14.3), claim rounds through the class's ClaimEngine, the job in Rust (`platform.speech`),
// and the order of publication on success: transcript.json → .md → .vtt → claim `done` (§14.5, folder spec
// §8.8). A device that is not the winner of its round never writes transcript.*; a lost claim cancels the
// job; finished results are taken again after a restart. Re-transcription is a new round (§14.7).
import { PlatformError, toPlatformError, type ErrorCode } from '../core/errors';
import { uuid } from '../core/ids';
import type { ClaimFile, TranscriptFile } from '../core/model/files';
import type { ClassId, ClassPath, Hex64, Ulid } from '../core/model/ids';
import { parserFor } from '../core/model/parse';
import { baseName, dirOf, parseConflictName } from '../core/model/paths';
import { instant, parseRfc3339 } from '../core/model/time';
import {
  effectiveVolunteer, eligibility, jitterMs, volunteerDelayMs, UNCLAIMED_NUDGE_MS, type EligibilityFacts, type IneligibleReason, type PowerSource, type VolunteerPref,
} from '../core/speech/volunteer';
import { fromResult } from '../core/transcript/fromResult';
import { renderMarkdown, renderVtt } from '../core/transcript/render';
import type { ModelId, SpeechInfo, TranscribeEvent, TranscribeRequest, TranscriptionResult } from '../platform/types';
import type { AppContext } from './context';
import { inLecture, updateLecturePrivate, type LectureRecord, type LectureServiceImpl } from './lectures';
import { Store } from './store';
import type { AppServices, ClassServices } from './types/common';
import type { TranscribePhase, TranscriptionQueue, TranscriptionQueueState } from './types/transcription';

type Engine = 'local' | 'cloud';

interface Job {
  classId: ClassId; lectureId: Ulid; jobId: string; title: string; engine: Engine; modelId: ModelId | null; round: number;
  phase: TranscribePhase | null; progress: number; etaMs: number | null; startedAt: string;
  offLost: () => void; lastPresenceMs: number; finishing: boolean;
}

const key = (classId: ClassId, lectureId: Ulid) => `${classId}/${lectureId}`;
const MODEL_IDS: readonly ModelId[] = ['turbo', 'small', 'large-v3'];
const asVolunteer = (v: string): VolunteerPref => (v === 'off' || v === 'always' ? v : 'plugged');
const PRESENCE_EVERY_MS = 60_000;
const CAUGHT_UP_MS = 60_000;
/** Release (not fail) a claim when the job could not start for a reason of this computer, not of the lecture. */
const RELEASE_CODES: readonly ErrorCode[] = ['JOB_BUSY', 'MODEL_NOT_DOWNLOADED', 'AI_NO_KEY', 'CONFLICT', 'SPEECH_UNSUPPORTED_CPU', 'NOT_IMPLEMENTED'];

export interface TranscriptionQueueImpl extends TranscriptionQueue {
  /** Re-evaluates every class now: views, volunteering timers, owner duties (tests, after changes). */
  evaluate(): Promise<void>;
  /** Resolves when no evaluation or job follow-up is running (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export function createTranscriptionQueue(ctx: AppContext, app: () => AppServices): TranscriptionQueueImpl {
  const { platform, clock, prefs } = ctx;
  const cloudState = () => ({ on: prefs.get('speech.cloud') === '1', model: prefs.get('speech.cloudModel'), auto: prefs.get('speech.cloudAuto') === '1' });
  const state = new Store<TranscriptionQueueState>({
    job: null, lectures: [], volunteer: asVolunteer(prefs.get('speech.volunteer')), volunteerEffective: 'off', cloud: cloudState(), volunteerNotice: false, notify: [],
  });
  const jobs = new Map<string, Job>();
  const failedAt = new Map<string, number>();
  const hashes = new Map<string, { size: number; mtimeMs: number; sha: Hex64 }>();
  const timers = new Map<string, { cancel: () => void; due: number }>();
  const since = new Map<string, number>();        // monotonic time the lecture became claimable here (or its winner went stale)
  const jitter = new Map<string, number>();
  const hadWinner = new Map<string, boolean>();
  const results = new Map<string, { result: TranscriptionResult; round: number; engine: Engine; modelId: ModelId | null }>();
  const notifyOn = new Set<string>();
  const offs: Array<() => void> = [];
  const classSubs = new Map<ClassId, () => void>();
  const work = new Set<Promise<unknown>>();
  let started = false;
  let disposed = false;
  let noticeRaised = false;
  let speechInfo: SpeechInfo | null = null;

  const track = <T>(p: Promise<T>): Promise<T> => {
    const q = p.finally(() => work.delete(q));
    work.add(q);
    q.catch(() => undefined);
    return p;
  };
  const log = (msg: string, e: unknown, data: object = {}) => ctx.log('warn', `transcription: ${msg}`, { ...data, error: toPlatformError(e).message });
  const notify = (k: Parameters<AppServices['notifications']['notify']>[0], id: string, vars: Record<string, string | number>, tag?: string) => {
    void Promise.resolve().then(() => app().notifications.notify(k, id, vars, tag)).catch(() => undefined);
  };
  const me = () => ctx.device.get()?.deviceId ?? '';
  const cls = (classId: ClassId): ClassServices => app().forClass(classId);
  const lecturesOf = (classId: ClassId) => cls(classId).lectures as LectureServiceImpl;

  // ── engines ──

  async function info(force = false): Promise<SpeechInfo | null> {
    const s = platform.speech;
    if (!s) return null;
    if (!speechInfo || force) {
      try {
        speechInfo = await s.info();
      } catch (e) {
        log('speech info failed', e);
      }
    }
    return speechInfo;
  }
  function localModel(i: SpeechInfo | null): { id: ModelId; speedRT: number | null } | null {
    if (!i || !i.cpuOk || !i.localWhisper) return null;
    const pref = prefs.get('speech.model');
    const active = (MODEL_IDS as readonly string[]).includes(pref) ? (pref as ModelId) : 'turbo';
    const ready = i.models.filter((m) => m.state === 'ready');
    const m = ready.find((x) => x.id === active) ?? ready[0];
    return m ? { id: m.id, speedRT: m.speedRT } : null;
  }
  const engineReady = (engine: Engine, i: SpeechInfo | null) => (engine === 'local' ? !!localModel(i) : !!platform.speech && cloudState().on);

  // ── eligibility ──

  async function localAudio(classId: ClassId, r: LectureRecord): Promise<EligibilityFacts['localAudio']> {
    const a = r.lecture.audio;
    if (!a) return 'missing';
    if (!a.shared) return r.lecture.recordedBy.deviceId === me() ? 'match' : 'missing';
    const entry = cls(classId).store.state.get().entry;
    if (r.audioSize === null) return entry.skipAudio ? 'skipped' : 'arriving';
    if (r.audioSize < a.size) return 'arriving';
    if (r.audioSize !== a.size) return 'mismatch';
    const stat = await platform.fs.stat(classId, r.audioPath).catch(() => null);
    if (!stat) return 'arriving';
    const k = `${classId}/${r.audioPath}`;
    const hit = hashes.get(k);
    let sha = hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs ? hit.sha : null;
    if (!sha) {
      try {
        sha = await platform.fs.hash(classId, r.audioPath);
        hashes.set(k, { size: stat.size, mtimeMs: stat.mtimeMs, sha });
      } catch {
        return 'arriving';
      }
    }
    return sha === a.sha256 ? 'match' : 'mismatch';
  }

  async function check(classId: ClassId, r: LectureRecord, opts: { automatic: boolean; newRound: boolean; engine: Engine }, i: SpeechInfo | null) {
    const a = r.lecture.audio;
    const round = r.round + (opts.newRound ? 1 : 0);
    const facts: EligibilityFacts = {
      lectureTrusted: true, newerFormat: r.lectureNewer, audio: a ? { shared: a.shared, size: a.size, sha256: a.sha256 } : null,
      iAmRecorder: r.lecture.recordedBy.deviceId === me(), duplicateOf: !!r.lecture.duplicateOf,
      localAudio: a ? await localAudio(classId, r) : 'missing', round,
      trustedTranscriptForRound: !opts.newRound && !!r.transcript && !!a && r.transcript.audioSha256 === a.sha256 && r.transcript.round >= round,
      anyTranscriptForAudio: !!a && !!r.onDisk && r.onDisk.audioSha256 === a.sha256,
      engineReady: engineReady(opts.engine, i), failedAtMs: failedAt.get(key(classId, r.id)) ?? null, nowMs: clock.now(),
    };
    return eligibility(facts, { automatic: opts.automatic });
  }

  // ── jobs ──

  function publishJob() {
    const running = [...jobs.values()].find((j) => !j.finishing) ?? [...jobs.values()][0] ?? null;
    state.update((s) => ({
      ...s,
      job: running
        ? {
            jobId: running.jobId, lectureId: running.lectureId, state: 'running', progress: running.progress, etaMs: running.etaMs, startedAt: running.startedAt, error: null,
            resultReady: running.finishing, classId: running.classId, title: running.title, phase: running.phase, engine: running.engine,
          }
        : null,
    }));
  }

  async function presence(classId: ClassId, activity: { lectureId: Ulid; progress: number; etaMs?: number } | null) {
    try {
      await cls(classId).presence.setActivity({ transcribing: activity ?? undefined });
    } catch (e) {
      log('presence not written', e);
    }
  }

  function endJob(k: string) {
    const j = jobs.get(k);
    if (!j) return;
    j.offLost();
    jobs.delete(k);
    publishJob();
    void presence(j.classId, null);
    void lecturesOf(j.classId).refresh().catch(() => undefined);
  }

  function onEvent(k: string) {
    return (e: TranscribeEvent) => {
      const j = jobs.get(k);
      if (!j) return;
      switch (e.type) {
        case 'phase':
          j.phase = e.phase;
          publishJob();
          break;
        case 'progress':
          j.progress = e.progress;
          j.etaMs = e.etaMs;
          publishJob();
          if (clock.now() - j.lastPresenceMs >= PRESENCE_EVERY_MS) {
            j.lastPresenceMs = clock.now();
            void presence(j.classId, { lectureId: j.lectureId, progress: e.progress, ...(e.etaMs !== null ? { etaMs: e.etaMs } : {}) });
          }
          break;
        case 'done':
          j.finishing = true;
          publishJob();
          void track(finish(k).catch((err: unknown) => log('could not publish the transcript', err, { lectureId: j.lectureId })));
          break;
        case 'failed': {
          // Rust wrote the claim `failed` with the code (architecture §5.4).
          failedAt.set(k, clock.now());
          endJob(k);
          const by = ctx.identity.get()?.deviceName ?? '';
          notify('transcript', 'notify.transcriptFailed', { lecture: j.title, device: by }, `transcribe-${j.lectureId}`);
          break;
        }
        case 'cancelled':
          endJob(k);
          break;
      }
    };
  }

  async function claimTemplate(classId: ClassId, lectureId: Ulid): Promise<{ path: ClassPath; file: ClaimFile } | null> {
    const path = `.tramado/claims/${lectureId}/${me()}.json`;
    const loaded = await cls(classId).store.readJson(path, parserFor('tramado.claim')).catch(() => null);
    return loaded ? { path, file: loaded.value } : null;
  }

  async function vocabulary(classId: ClassId): Promise<string | null> {
    try {
      const v = cls(classId).info.detail.get().meta.vocabulary;
      if (v) return [...v].slice(0, 500).join('');
    } catch {
      // the class service is not ready
    }
    const view = app().library.classes.get().find((c) => c.id === classId);
    return view?.vocabulary ? [...view.vocabulary].slice(0, 500).join('') : null;
  }

  async function startJob(classId: ClassId, r: LectureRecord, engine: Engine, round: number, resume: boolean): Promise<void> {
    const s = platform.speech;
    if (!s) throw new PlatformError('INVALID', 'transcription is not available in this build');
    const a = r.lecture.audio!;
    const k = key(classId, r.id);
    const i = await info();
    const model = engine === 'local' ? localModel(i) : null;
    const template = await claimTemplate(classId, r.id);
    const jobId = uuid(ctx.rand);
    const job: Job = {
      classId, lectureId: r.id, jobId, title: r.lecture.title, engine, modelId: model?.id ?? null, round, phase: null, progress: 0, etaMs: null,
      startedAt: instant(clock.now()), offLost: () => undefined, lastPresenceMs: clock.now(), finishing: false,
    };
    jobs.set(k, job);
    job.offLost = cls(classId).claims.onLost(r.id, () => void track(lost(k)));
    publishJob();
    void presence(classId, { lectureId: r.id, progress: 0 });
    const req: TranscribeRequest = {
      jobId, lectureId: r.id, source: a.shared ? { kind: 'class', classId, path: r.audioPath } : { kind: 'private', recordingId: r.id }, expectSha256: a.sha256,
      engine: engine === 'local' ? { kind: 'local', model: model?.id ?? 'turbo' } : { kind: 'cloud', model: prefs.get('speech.cloudModel') },
      language: r.lecture.language, channels: a.channels === 2 ? 'split' : 'mix', initialPrompt: await vocabulary(classId),
      claim: template ? { classId, path: template.path, file: template.file } : null, resume,
    };
    try {
      await s.transcribe.start(req, onEvent(k));
    } catch (e) {
      const code = toPlatformError(e).code;
      endJob(k);
      const claims = cls(classId).claims;
      if (RELEASE_CODES.includes(code)) await claims.setStatus(r.id, 'transcribe', { status: 'released' }).catch(() => undefined);
      else {
        failedAt.set(k, clock.now());
        await claims.setStatus(r.id, 'transcribe', { status: 'failed', error: code }).catch(() => undefined);
      }
      throw e;
    }
  }

  /** Our claim stopped winning (sync spec §14.5): abort, keep the partial result, delete the claim. */
  async function lost(k: string) {
    const j = jobs.get(k);
    if (!j || j.finishing) return;
    endJob(k);
    await platform.speech?.transcribe.cancel(j.jobId, true).catch((e: unknown) => log('cancel failed', e));
    await cls(j.classId).claims.remove(j.lectureId, 'transcribe').catch((e: unknown) => log('claim not removed', e));
  }

  /** A finished job: take the result, and publish it only while this device still wins (§14.5). */
  async function finish(k: string) {
    const j = jobs.get(k);
    const s = platform.speech;
    if (!j || !s) return;
    let result: TranscriptionResult;
    try {
      result = await s.transcribe.take(j.jobId);
    } catch (e) {
      endJob(k);
      throw e;
    }
    results.set(k, { result, round: j.round, engine: j.engine, modelId: j.modelId });
    const claims = cls(j.classId).claims;
    const w = claims.winner(j.lectureId, 'transcribe');
    if (!w || !w.mine) {
      // Done, but not the winner: never write transcript.* (the result stays in Rust for 7 days).
      endJob(k);
      results.delete(k);
      await claims.remove(j.lectureId, 'transcribe').catch(() => undefined);
      return;
    }
    const revision = await writeTranscript(j.classId, j.lectureId, result, j.round, j.modelId);
    await claims.setStatus(j.lectureId, 'transcribe', { status: 'done', finishedAt: instant(clock.now()), transcriptRevision: revision });
    endJob(k);
    if (notifyOn.delete(k)) {
      publishNotify();
      notify('transcript', 'notify.transcriptReady', { lecture: j.title }, `transcript-${j.lectureId}`);
    }
  }

  /** transcript.json, then .md, then .vtt, into the lecture's current directory (folder spec §8.8). */
  async function writeTranscript(classId: ClassId, lectureId: Ulid, result: TranscriptionResult, round: number, modelId: ModelId | null): Promise<number> {
    const lectures = lecturesOf(classId);
    await lectures.refresh();
    const r = lectures.records().get(lectureId);
    if (!r) throw new PlatformError('NOT_FOUND', 'the lecture is gone');
    const identity = ctx.identity.get();
    if (!identity) throw new PlatformError('INVALID', 'no identity yet');
    const t: TranscriptFile = fromResult(result, {
      lecture: r.lecture, round, writer: { deviceId: me(), memberId: identity.memberId, name: identity.name }, at: instant(clock.now()), rand: ctx.rand, modelId,
    });
    const store = cls(classId).store;
    const dir = store.state.get().index.lectures.get(lectureId)?.dir ?? r.dir;
    await store.writeJson(inLecture(dir, 'transcript.json'), t, { own: true });
    await store.writeText(inLecture(dir, 'transcript.md'), renderMarkdown(t, r.lecture), { own: true });
    await store.writeText(inLecture(dir, 'transcript.vtt'), renderVtt(t), { own: true });
    await lectures.refresh();
    return t.revision;
  }

  // ── claiming ──

  async function claimInternal(
    classId: ClassId, lectureId: Ulid, engine: Engine, opts: { automatic: boolean; supersedeStale: boolean; newRound: boolean },
  ): Promise<'won' | 'lost' | 'ineligible'> {
    const k = key(classId, lectureId);
    if (jobs.has(k)) return 'won';
    if (jobs.size > 0) {
      if (opts.automatic) return 'ineligible';
      throw new PlatformError('JOB_BUSY', 'this computer is already transcribing a lecture');
    }
    const lectures = lecturesOf(classId);
    await lectures.refresh();
    const r = lectures.records().get(lectureId);
    if (!r) return 'ineligible';
    const i = await info();
    const ok = await check(classId, r, { automatic: opts.automatic, newRound: opts.newRound, engine }, i);
    if (!ok.eligible) {
      setReason(classId, lectureId, ok.reason, r.lecture.title);
      return 'ineligible';
    }
    const claims = cls(classId).claims;
    const model = engine === 'local' ? localModel(i) : null;
    const outcome = await claims.tryClaim(lectureId, 'transcribe', {
      engine: engine === 'local' ? { kind: 'local', model: model?.id ?? 'turbo' } : { kind: 'cloud', model: prefs.get('speech.cloudModel') },
      audioSha256: r.lecture.audio!.sha256, supersedeStale: opts.supersedeStale, ...(opts.newRound ? { newRound: true } : {}),
    });
    if (outcome === 'lost') return 'lost';
    if (jobs.size > 0) {
      // Another claim of ours started meanwhile: one job at a time on this computer.
      await claims.setStatus(lectureId, 'transcribe', { status: 'released' }).catch(() => undefined);
      return 'lost';
    }
    await startJob(classId, r, engine, r.round + (opts.newRound ? 1 : 0), false);
    return 'won';
  }

  function setReason(classId: ClassId, lectureId: Ulid, reason: IneligibleReason | null, title = '') {
    state.update((s) => {
      const hit = s.lectures.some((l) => l.classId === classId && l.lectureId === lectureId);
      const lectures = hit
        ? s.lectures.map((l) => (l.classId === classId && l.lectureId === lectureId ? { ...l, eligible: reason === null, reason } : l))
        : [...s.lectures, { classId, lectureId, title, claim: null, eligible: reason === null, reason }];
      return { ...s, lectures };
    });
  }

  function bestEngine(i: SpeechInfo | null): Engine | null {
    if (engineReady('local', i)) return 'local';
    if (engineReady('cloud', i)) return 'cloud';
    return null;
  }

  // ── evaluation: views, volunteering, owner duties ──

  let evaluating: Promise<void> | null = null;
  let evalAgain = false;
  function evaluate(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (evaluating) {
      evalAgain = true;
      return evaluating;
    }
    evaluating = track((async () => {
      do {
        evalAgain = false;
        try {
          await evaluateAll();
        } catch (e) {
          log('evaluation failed', e);
        }
      } while (evalAgain && !disposed);
    })().finally(() => {
      evaluating = null;
    }));
    return evaluating;
  }

  async function evaluateAll() {
    const i = await info();
    const pref = asVolunteer(prefs.get('speech.volunteer'));
    const cloud = cloudState();
    const model = localModel(i);
    const effective = effectiveVolunteer(pref, { localModel: !!model, cloud: cloud.on, cloudAuto: cloud.auto });
    const classes = app().library.classes.get();
    const anyShared = classes.some((c) => c.shared && !c.archived);
    const notice = !!model && anyShared && pref !== 'off' && prefs.get('speech.volunteerAsked') !== '1';
    let power: PowerSource = 'unknown';
    try {
      power = (await platform.system.power()).source;
    } catch {
      power = 'unknown';
    }
    const delay = volunteerDelayMs({ volunteer: effective, power, localModel: model, cloud: cloud.on, cloudAuto: cloud.auto });
    const engine: Engine | null = model ? 'local' : cloud.on && cloud.auto ? 'cloud' : null;
    const views: TranscriptionQueueState['lectures'] = [];
    const seen = new Set<string>();
    for (const c of classes) {
      let services: ClassServices;
      try {
        services = cls(c.id);
      } catch {
        continue;
      }
      watchClass(c.id, services);
      const lectures = services.lectures as LectureServiceImpl;
      if (typeof lectures.records !== 'function') continue;
      for (const r of lectures.records().values()) {
        const k = key(c.id, r.id);
        seen.add(k);
        const winner = r.winner;
        await ownerDuties(c.id, r);
        const done = !!r.transcript && r.transcript.round >= r.round;
        const manual = await check(c.id, r, { automatic: false, newRound: false, engine: bestEngine(i) ?? 'local' }, i);
        if (!done) views.push({ classId: c.id, lectureId: r.id, title: r.lecture.title, claim: winner, eligible: manual.eligible, reason: manual.eligible ? null : manual.reason });
        // Volunteering (sync spec §14.3): only shared classes, never what the recorder kept for later.
        const live = !!winner && winner.status !== 'failed' && winner.status !== 'released';
        const staleClaims = r.claims.some((x) => (x.status === 'claimed' || x.status === 'working') && x.health === 'stale');
        if (live) {
          hadWinner.set(k, true);
          cancelTimer(k);
          continue;
        }
        if (hadWinner.get(k)) {
          // The winner went stale or released: every volunteer restarts its delay from now.
          hadWinner.set(k, false);
          since.delete(k);
          jitter.delete(k);
          cancelTimer(k);
        }
        const auto = engine ? await check(c.id, r, { automatic: true, newRound: false, engine }, i) : null;
        const recorderOptOut = r.priv.noAutoClaim === true && r.lecture.recordedBy.deviceId === me();
        const duplicate = lectures.list.get().find((v) => v.id === r.id)?.probableDuplicateOf ?? null;
        if (!c.shared || c.archived || delay === null || !engine || !auto?.eligible || recorderOptOut || duplicate) {
          cancelTimer(k);
          if (!auto?.eligible) since.delete(k);
        } else {
          if (!since.has(k)) since.set(k, clock.mono());
          if (!jitter.has(k)) jitter.set(k, jitterMs(ctx.rand));
          const due = since.get(k)! + delay + jitter.get(k)!;
          const cur = timers.get(k);
          if (!cur || cur.due !== due) {
            cur?.cancel();
            const lectureId = r.id;
            const classId = c.id;
            const cancel = clock.setTimeout(() => {
              timers.delete(k);
              void track(
                claimInternal(classId, lectureId, engine, { automatic: true, supersedeStale: staleClaims, newRound: false })
                  .then(() => evaluate())
                  .catch((e: unknown) => log('volunteer claim failed', e, { lectureId })),
              );
            }, Math.max(0, due - clock.mono()));
            timers.set(k, { cancel, due });
          }
        }
        await nudge(c.id, r, live);
      }
    }
    for (const k of [...timers.keys()]) if (!seen.has(k)) cancelTimer(k);
    state.update((s) => ({ ...s, lectures: views, volunteer: pref, volunteerEffective: effective, cloud, volunteerNotice: notice }));
    if (notice && !noticeRaised) {
      // Also as a system notification, once per session, for when the window is hidden (UX §5.22 `volunteerOn`).
      noticeRaised = true;
      notify('model', 'notify.volunteerOn', {}, 'volunteer-on');
    }
  }

  function cancelTimer(k: string) {
    timers.get(k)?.cancel();
    timers.delete(k);
  }

  /** "Nobody has transcribed it yet" for the recorder, once, 24 h after the recording ended (sync spec §14.3). */
  async function nudge(classId: ClassId, r: LectureRecord, live: boolean) {
    if (live || r.transcript || r.priv.nudgedAt || r.lecture.recordedBy.deviceId !== me() || !r.lecture.audio) return;
    const end = (parseRfc3339(r.lecture.startedAt) ?? 0) + r.lecture.durationMs;
    if (clock.now() - end < UNCLAIMED_NUDGE_MS) return;
    await updateLecturePrivate(platform, classId, r.id, (p) => ({ ...p, nudgedAt: instant(clock.now()) }));
    notify('transcript', 'notify.transcriptNobody', { lecture: r.lecture.title }, `nobody-${r.id}`);
  }

  /** §14.5 "after done": a done claim that does not win is deleted; a winner whose transcript is not its own rewrites it. */
  async function ownerDuties(classId: ClassId, r: LectureRecord) {
    const mine = r.claims.find((c) => c.mine && c.status === 'done');
    if (!mine) return;
    const k = key(classId, r.id);
    const claims = cls(classId).claims;
    if (!r.winner?.mine) {
      results.delete(k);
      await claims.remove(r.id, 'transcribe').catch((e: unknown) => log('done claim not removed', e));
      return;
    }
    if (!r.transcript || r.transcript.writer.deviceId === me() || r.transcript.round > r.round) return;
    // A partition where both finished: the winner's transcript replaces the other one, and conflict copies go.
    let cached = results.get(k);
    if (!cached && platform.speech) {
      const job = (await platform.speech.transcribe.jobs().catch(() => [])).find((j) => j.lectureId === r.id && j.state === 'done');
      if (job) {
        const result = await platform.speech.transcribe.take(job.jobId).catch(() => null);
        if (result) cached = { result, round: r.round, engine: 'local', modelId: null };
      }
    }
    if (!cached) return;
    await writeTranscript(classId, r.id, cached.result, cached.round, cached.modelId);
    const store = cls(classId).store;
    const dir = dirOf(r.item.manifest);
    for (const c of store.state.get().index.conflicts) {
      const name = baseName(c.path);
      const parsed = parseConflictName(name);
      if (dirOf(c.path) === dir && parsed && parsed.original.startsWith('transcript.')) await store.remove(c.path).catch(() => undefined);
    }
  }

  function watchClass(classId: ClassId, services: ClassServices) {
    if (classSubs.has(classId)) return;
    classSubs.set(classId, services.lectures.list.subscribe(() => void evaluate()));
  }

  function publishNotify() {
    state.update((s) => ({ ...s, notify: [...notifyOn] }));
  }

  // ── start-up: re-attach jobs, take finished results (sync spec §14.5 "on app start") ──

  async function resume() {
    const s = platform.speech;
    if (!s) return;
    const classes = app().library.classes.get();
    for (const c of classes) {
      if (c.shared) await platform.sync.waitCaughtUp(c.id, CAUGHT_UP_MS).catch(() => undefined);
      await lecturesOf(c.id).refresh().catch(() => undefined);
    }
    const running = await s.transcribe.jobs().catch(() => []);
    const findLecture = (lectureId: Ulid) => {
      for (const c of classes) {
        const r = lecturesOf(c.id).records().get(lectureId);
        if (r) return { classId: c.id, r };
      }
      return null;
    };
    const handled = new Set<string>();
    for (const j of running) {
      const hit = findLecture(j.lectureId);
      if (!hit) continue;
      const k = key(hit.classId, j.lectureId);
      handled.add(k);
      const claims = cls(hit.classId).claims;
      const winner = claims.winner(j.lectureId, 'transcribe');
      if (j.state === 'running') {
        if (!winner?.mine) {
          await s.transcribe.cancel(j.jobId, true).catch(() => undefined);
          await claims.remove(j.lectureId, 'transcribe').catch(() => undefined);
          continue;
        }
        const job: Job = {
          classId: hit.classId, lectureId: j.lectureId, jobId: j.jobId, title: hit.r.lecture.title, engine: 'local', modelId: null, round: hit.r.round,
          phase: null, progress: j.progress, etaMs: j.etaMs, startedAt: j.startedAt, offLost: () => undefined, lastPresenceMs: clock.now(), finishing: false,
        };
        jobs.set(k, job);
        job.offLost = claims.onLost(j.lectureId, () => void track(lost(k)));
        const summary = await s.transcribe.attach(j.jobId, onEvent(k)).catch(() => null);
        if (!summary) endJob(k);
        else publishJob();
      } else if (j.state === 'done' && j.resultReady) {
        if (winner?.mine && !(hit.r.transcript && hit.r.transcript.round >= hit.r.round && hit.r.transcript.writer.deviceId === me())) {
          const job: Job = {
            classId: hit.classId, lectureId: j.lectureId, jobId: j.jobId, title: hit.r.lecture.title, engine: 'local', modelId: null, round: hit.r.round,
            phase: null, progress: 1, etaMs: null, startedAt: j.startedAt, offLost: () => undefined, lastPresenceMs: clock.now(), finishing: true,
          };
          jobs.set(k, job);
          await track(finish(k).catch((e: unknown) => log('could not publish a finished result', e)));
        } else if (!winner?.mine) {
          await claims.remove(j.lectureId, 'transcribe').catch(() => undefined);
        }
      }
    }
    // A claim of ours still `working` with no job in Rust (it crashed before the job started): resume it.
    for (const c of classes) {
      for (const r of lecturesOf(c.id).records().values()) {
        const k = key(c.id, r.id);
        if (handled.has(k) || jobs.size > 0) continue;
        const w = r.winner;
        if (w?.mine && (w.status === 'working' || w.status === 'claimed') && r.lecture.audio) {
          const i = await info();
          const engine = bestEngine(i);
          if (!engine) continue;
          await startJob(c.id, r, engine, r.round, true).catch((e: unknown) => log('could not resume', e, { lectureId: r.id }));
        }
      }
    }
  }

  // ── the queue ──

  const queue: TranscriptionQueueImpl = {
    state,
    claim: (classId, lectureId, engine) => track(claimInternal(classId, lectureId, engine, { automatic: false, supersedeStale: false, newRound: false })),
    async takeOver(classId, lectureId) {
      const engine = bestEngine(await info());
      if (!engine) return 'ineligible';
      return track(claimInternal(classId, lectureId, engine, { automatic: false, supersedeStale: true, newRound: false }));
    },
    async release(classId, lectureId) {
      const k = key(classId, lectureId);
      const j = jobs.get(k);
      if (j) {
        endJob(k);
        await platform.speech?.transcribe.cancel(j.jobId, false).catch((e: unknown) => log('cancel failed', e));
      }
      await cls(classId).claims.setStatus(lectureId, 'transcribe', { status: 'released' });
      await evaluate();
    },
    async retranscribe(classId, lectureId) {
      const engine = bestEngine(await info());
      if (!engine) throw new PlatformError('MODEL_NOT_DOWNLOADED', 'no speech model on this computer and cloud transcription is off');
      await track(claimInternal(classId, lectureId, engine, { automatic: false, supersedeStale: true, newRound: true }));
    },
    async setVolunteer(v) {
      await prefs.set('speech.volunteer', v);
      await refreshMemberFiles();
      await evaluate();
    },
    async setCloud(on, model, auto) {
      await prefs.set('speech.cloud', on ? '1' : '0');
      await prefs.set('speech.cloudModel', model);
      await prefs.set('speech.cloudAuto', auto ? '1' : '0');
      await refreshMemberFiles();
      await evaluate();
    },
    async start() {
      if (started) return evaluate();
      started = true;
      offs.push(app().library.classes.subscribe(() => void evaluate()));
      offs.push(prefs.store.subscribe(() => {
        state.update((s) => ({ ...s, volunteer: asVolunteer(prefs.get('speech.volunteer')), cloud: cloudState() }));
        void evaluate();
      }));
      offs.push(app().models.models.subscribe(() => {
        void info(true).then(() => evaluate());
      }));
      try {
        await resume();
      } catch (e) {
        log('resume failed', e);
      }
      await evaluate();
    },
    async ackVolunteerNotice(turnOff) {
      await prefs.set('speech.volunteerAsked', '1');
      if (turnOff) await prefs.set('speech.volunteer', 'off');
      await refreshMemberFiles();
      await evaluate();
    },
    notifyWhenReady(classId, lectureId, on) {
      const k = key(classId, lectureId);
      if (on) notifyOn.add(k);
      else notifyOn.delete(k);
      publishNotify();
    },
    evaluate,
    async idle() {
      for (let n = 0; n < 20 && work.size; n++) await Promise.allSettled([...work]);
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      for (const off of classSubs.values()) off();
      for (const t of timers.values()) t.cancel();
      timers.clear();
    },
  };

  /** The member files report the effective volunteering policy (sync spec §14.3; ClassService, T-SYNC). */
  async function refreshMemberFiles() {
    for (const c of app().library.classes.get()) {
      if (!c.shared) continue;
      try {
        await cls(c.id).info.refreshOwnMemberFile();
      } catch (e) {
        log('member file not refreshed', e, { classId: c.id });
      }
    }
  }

  return queue;
}
