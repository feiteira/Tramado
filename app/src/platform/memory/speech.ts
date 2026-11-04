// createFakeSpeech() (architecture §10): the speech side of the memory platform, for Vitest and the browser
// demo (`speech=fake`, UX §7.2). Models go absent → downloading → verifying → ready through scripted
// ModelEvents; the recorder hands out synthetic levels, markers and FinishedRecordings; publish and import
// write a tiny valid WebM; transcription jobs report phases and progress and hand back a scripted
// TranscriptionResult; peaks are deterministic. Nothing moves by itself: `tick(ms)` advances recorder, meter,
// downloads, imports and jobs (the demo's `tick` hook; tests call it directly). Demo modes: `model=ready|
// missing|downloading`, `recording=1`; demo controls: claimTranscription, finishTranscription, tick.
import { PlatformError, type ErrorCode } from '../../core/errors';
import { newUlid } from '../../core/ids';
import { compactJson } from '../../core/json';
import type { ClaimFile, LectureFile } from '../../core/model/files';
import { shortIdOf, type ClassId, type ClassPath, type DeviceId, type Hex64, type MemberId, type Ulid } from '../../core/model/ids';
import { instant } from '../../core/model/time';
import { mulberry32 } from '../../core/util/prng';
import { sha256, sha256Hex } from '../../core/util/sha256';
import { fromResult } from '../../core/transcript/fromResult';
import { renderMarkdown, renderVtt } from '../../core/transcript/render';
import type {
  AudioDevices, FinishedRecording, ImportEvent, JobSummary, Marker, MarkerKind, MeterEvent, ModelEvent, ModelId, ModelState, Platform,
  PublishedAudio, PublishRequest, RecorderEvent, RecorderStartRequest, RecorderStatus, SpeechInfo, TrackLevel, TranscribeEvent,
  TranscribeRequest, TranscriptionResult,
} from '../types';
import type { MemoryPlatform } from './index';

type Speech = NonNullable<Platform['speech']>;

export interface FakeSpeechOptions {
  model?: 'ready' | 'missing' | 'downloading';
  recording?: boolean;
  /** Wall clock for startedAt / updatedAt (default Date.now). */
  now?: () => number;
  /** The CPU can run local models (default true). */
  cpuOk?: boolean;
  /** Fake milliseconds a transcription job takes (default 4 000: four 1 s ticks). */
  jobMs?: number;
  seed?: number;
}

/** The part of the memory platform the fake writes through (publish, import, Rust's claim heartbeats, demo peers). */
export type FakeSpeechHost = Pick<MemoryPlatform, 'fs'> & { mem: Pick<MemoryPlatform['mem'], 'applyRemote' | 'deviceId'> & Partial<Pick<MemoryPlatform['mem'], 'putRecording'>> };

/** The demo keys the controls resolve (a structural subset of demo/keys.ts DemoKeys). */
export interface FakeSpeechKeys {
  classes: Partial<Record<string, ClassId>>;
  lectures: Partial<Record<string, { classKey: string; lectureId: Ulid }>>;
  members: Partial<Record<string, { memberId: MemberId; deviceIds: DeviceId[] }>>;
}

/** DemoControls['speech'] (demo/controls.ts). */
export interface FakeSpeechControls {
  claimTranscription(lectureKey: string, memberKey: string, percent: number): Promise<void>;
  finishTranscription(lectureKey: string): Promise<void>;
  tick(ms: number): void;
}

type ResultScript = Omit<TranscriptionResult, 'lectureId'> | ((req: TranscribeRequest) => Omit<TranscriptionResult, 'lectureId'>);

export interface FakeSpeech extends Speech {
  /** Where publish, import and the demo controls write (call once the platform exists). */
  bind(host: FakeSpeechHost, opts?: { recordingClassId?: ClassId }): void;
  /** Advances everything that runs in "Rust" by `ms`. */
  tick(ms: number): void;
  /** The result a transcription of `lectureId` (or of any lecture, with '*') hands back. */
  script(lectureId: Ulid | '*', result: ResultScript): void;
  /** The next operation of that kind fails with `code`. */
  failNext(what: 'transcribe' | 'download' | 'import' | 'recorder' | 'publish', code: ErrorCode): void;
  controls(keys: FakeSpeechKeys): FakeSpeechControls;
  /** What was asked of the fake (tests). */
  requests: { transcribe: TranscribeRequest[]; publish: PublishRequest[]; cancel: Array<{ jobId: string; keepPartial: boolean }>; peaks: number };
  /** The bytes publish and import write as audio.webm. */
  readonly webm: Uint8Array;
}

// ── a tiny valid WebM: EBML header, Info, one Opus track, one cluster of 20 ms silent frames ──────

function vint(n: number): number[] {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out: number[] = [];
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0]! |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('too large');
}
const uint = (n: number) => {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return out;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const f64 = (x: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return [...b];
};
const el = (id: number[], body: number[]) => [...id, ...vint(body.length), ...body];

export function tinyWebm(frames = 50): Uint8Array {
  const opusHead = [...ascii('OpusHead'), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];   // v1, mono, pre-skip 312, 48 kHz
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [
    ...el([0x42, 0x86], uint(1)), ...el([0x42, 0xf7], uint(1)), ...el([0x42, 0xf2], uint(4)), ...el([0x42, 0xf3], uint(8)),
    ...el([0x42, 0x82], ascii('webm')), ...el([0x42, 0x87], uint(4)), ...el([0x42, 0x85], uint(2)),
  ]);
  const info = el([0x15, 0x49, 0xa9, 0x66], [
    ...el([0x2a, 0xd7, 0xb1], uint(1_000_000)), ...el([0x4d, 0x80], ascii('tramado-fake')), ...el([0x57, 0x41], ascii('tramado-fake')),
    ...el([0x44, 0x89], f64(frames * 20)),
  ]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], [
    ...el([0xd7], uint(1)), ...el([0x73, 0xc5], uint(1)), ...el([0x83], uint(2)), ...el([0x86], ascii('A_OPUS')),
    ...el([0x56, 0xaa], uint(6_500_000)), ...el([0x56, 0xbb], uint(80_000_000)), ...el([0x63, 0xa2], opusHead),
    ...el([0xe1], [...el([0xb5], f64(48_000)), ...el([0x9f], uint(1))]),
  ]));
  const blocks: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * 20;
    blocks.push(...el([0xa3], [0x81, (t >> 8) & 0xff, t & 0xff, 0x80, 0xf8, 0xff, 0xfe]));
  }
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], uint(0)), ...blocks]);
  const segment = el([0x18, 0x53, 0x80, 0x67], [...info, ...tracks, ...cluster]);
  return Uint8Array.from([...ebml, ...segment]);
}

// ── models ─────────────────────────────────────────────────────────────────────────────────────

const MB = 1_000_000;
const REGISTRY: Array<Pick<ModelState, 'id' | 'file' | 'size' | 'tier' | 'recommended'>> = [
  { id: 'turbo', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574 * MB, tier: 'default', recommended: true },
  { id: 'small', file: 'ggml-small-q5_1.bin', size: 190 * MB, tier: 'draft', recommended: false },
  { id: 'large-v3', file: 'ggml-large-v3-q5_0.bin', size: 1_080 * MB, tier: 'advanced', recommended: false },
];
const DOWNLOAD_BPS = 2.4 * MB;

const SAMPLE_TEXT: Record<'pt' | 'es' | 'en', string[]> = {
  pt: ['Bom dia a todos.', 'Hoje vamos ver o artigo 18.º da Constituição.', 'Isto costuma sair no exame, tomem nota.'],
  es: ['Buenos días a todos.', 'Hoy vemos el artículo 24 de la Constitución.', 'Esto entra seguro en el examen.'],
  en: ['Good morning, everyone.', 'Today we look at Article 8 ECHR.', 'This will come up on the exam.'],
};

interface FakeJob {
  summary: JobSummary; req: TranscribeRequest; onEvent: (e: TranscribeEvent) => void; elapsed: number; failWith: ErrorCode | null;
  result: TranscriptionResult | null; heartbeat: number;
}
interface FakeImport { recordingId: Ulid; req: Parameters<Speech['importAudio']>[0]; onEvent: (e: ImportEvent) => void; done: number; failWith: ErrorCode | null }

export function createFakeSpeech(opts: FakeSpeechOptions = {}): FakeSpeech {
  const now = opts.now ?? (() => Date.now());
  const rand = mulberry32(opts.seed ?? 0x5bee);
  const jobMs = opts.jobMs ?? 4_000;
  const webm = tinyWebm();
  const webmSha: Hex64 = sha256Hex(webm);
  let host: FakeSpeechHost | null = null;
  const failures = new Map<string, ErrorCode>();
  const scripts = new Map<string, ResultScript>();
  const privateAudio = new Map<Ulid, Uint8Array>();

  // models
  const models = new Map<ModelId, ModelState>(
    REGISTRY.map((m) => [m.id, { ...m, sha256: sha256Hex(m.file), state: 'absent', bytes: 0, error: null, speedRT: null }]),
  );
  const downloads = new Map<ModelId, { onEvent: (e: ModelEvent) => void; done: number; failWith: ErrorCode | null }>();
  if (opts.model === 'ready' || opts.model === undefined) models.set('turbo', { ...models.get('turbo')!, state: 'ready', bytes: 574 * MB, speedRT: 2.7 });
  if (opts.model === 'downloading') {
    models.set('turbo', { ...models.get('turbo')!, state: 'downloading', bytes: 212 * MB });
    downloads.set('turbo', { onEvent: () => undefined, done: 212 * MB, failWith: null });
  }

  // recorder and meter
  let rec: { req: RecorderStartRequest; status: RecorderStatus; startedAt: number; pauses: FinishedRecording['pauses']; markers: Marker[]; onEvent: (e: RecorderEvent) => void; pausedAt: number | null } | null = null;
  const pending: FinishedRecording[] = [];
  let meter: ((e: MeterEvent) => void) | null = null;
  let phase = 0;
  const level = (device: string): TrackLevel => {
    phase += 1;
    const peak = 0.25 + 0.2 * Math.abs(Math.sin(phase / 3));
    return { peak, rmsDb: Math.round(20 * Math.log10(peak) - 6), clipping: false, device, error: null, silentForMs: 0 };
  };
  const tracksFor = (mode: 'room' | 'online', includeMic: boolean) => ({
    mic: mode === 'room' || includeMic ? level('Built-in microphone') : null,
    system: mode === 'online' ? level('Speakers (monitor)') : null,
  });

  // jobs and imports
  const jobs = new Map<string, FakeJob>();
  const imports = new Map<Ulid, FakeImport>();

  const fail = (what: string) => {
    const c = failures.get(what);
    if (c) failures.delete(what);
    return c ?? null;
  };
  const needHost = () => {
    if (!host) throw new PlatformError('INVALID', 'the fake speech platform is not bound to a memory platform');
    return host;
  };

  function langOf(lang: string): 'pt' | 'es' | 'en' {
    const l = lang.toLowerCase();
    return l.startsWith('pt') ? 'pt' : l.startsWith('es') ? 'es' : 'en';
  }

  function defaultResult(req: TranscribeRequest): Omit<TranscriptionResult, 'lectureId'> {
    const lang = req.language === 'auto' ? 'pt' : langOf(req.language);
    const texts = SAMPLE_TEXT[lang];
    const engine: TranscriptionResult['engine'] = req.engine.kind === 'local'
      ? { kind: 'local', name: 'whisper.cpp', version: '1.8.3', model: REGISTRY.find((m) => m.id === req.engine.model)!.file.replace(/\.bin$/, ''), vad: 'silero-v5.1.2' }
      : { kind: 'cloud', name: 'openrouter', model: req.engine.model };
    const segs = texts.map((text, i) => ({ startMs: i * 5000 + 500, endMs: i * 5000 + 4500, text }));
    const tracks: TranscriptionResult['tracks'] = req.channels === 'split'
      ? [{ speaker: 'class', segments: segs }, { speaker: 'me', segments: [{ startMs: 15_500, endMs: 17_000, text: lang === 'pt' ? 'Pode repetir, por favor?' : lang === 'es' ? '¿Puede repetirlo, por favor?' : 'Could you repeat that, please?' }] }]
      : [{ speaker: 'lecture', segments: segs }];
    return { durationMs: 18_000, language: lang, engine, tracks };
  }

  function resultFor(req: TranscribeRequest): TranscriptionResult {
    const s = scripts.get(req.lectureId) ?? scripts.get('*');
    const r = s ? (typeof s === 'function' ? s(req) : s) : defaultResult(req);
    return { ...r, lectureId: req.lectureId };
  }

  async function writeClaim(job: FakeJob) {
    const c = job.req.claim;
    if (!host || !c) return;
    job.heartbeat += 1;
    const file: ClaimFile = { ...c.file, status: 'working', heartbeat: c.file.heartbeat + job.heartbeat, progress: Math.round(job.summary.progress * 100) / 100, updatedAt: instant(now()), ...(job.summary.etaMs !== null ? { etaMs: job.summary.etaMs } : {}) };
    await host.fs.write(c.classId, c.path, new TextEncoder().encode(compactJson(file)), { own: true }).catch(() => undefined);
  }

  function status(): RecorderStatus | null {
    return rec ? { ...rec.status, markers: rec.markers.length } : null;
  }

  function startRecording(req: RecorderStartRequest, onEvent: (e: RecorderEvent) => void, ms = 0) {
    rec = {
      req, startedAt: now() - ms, pauses: [], markers: [], onEvent, pausedAt: null,
      status: { recordingId: req.recordingId, classId: req.classId, state: 'recording', ms, tracks: tracksFor(req.mode, req.includeMic), bytesWritten: Math.round((ms * req.bitrate) / 8000), diskFree: 41_000 * MB, markers: 0 },
    };
  }

  function finished(r: NonNullable<typeof rec>, state: FinishedRecording['state']): FinishedRecording {
    const stereo = r.req.mode === 'online' && r.req.includeMic;
    return {
      recordingId: r.req.recordingId, classId: r.req.classId, title: r.req.title, mode: r.req.mode, language: r.req.language,
      startedAt: instant(r.startedAt), durationMs: r.status.ms, channels: stereo ? 2 : 1, bitrate: r.req.bitrate,
      speakers: stereo ? [{ index: 0, speaker: 'me' }, { index: 1, speaker: 'class' }] : [{ index: 0, speaker: 'lecture' }],
      pauses: r.pauses, markers: r.markers, state, recoveredLostMs: state === 'recovered' ? 1000 : null,
    };
  }

  const audioOf = (durationMs: number, channels: 1 | 2, bitrate: number, source: PublishedAudio['source']): PublishedAudio => ({
    source, size: webm.length, sha256: webmSha, durationMs, channels, bitrate, sampleRate: 16000,
  });

  function tick(ms: number) {
    if (ms <= 0) return;
    // recorder
    if (rec && rec.status.state === 'recording') {
      rec.status = { ...rec.status, ms: rec.status.ms + ms, bytesWritten: rec.status.bytesWritten + Math.round((ms * rec.req.bitrate) / 8000), tracks: tracksFor(rec.req.mode, rec.req.includeMic) };
      rec.onEvent({ type: 'status', status: status()! });
    }
    if (meter) meter({ type: 'level', mic: level('Built-in microphone'), system: null });
    // downloads
    for (const [id, d] of [...downloads]) {
      const m = models.get(id)!;
      if (d.failWith) {
        downloads.delete(id);
        models.set(id, { ...m, state: 'failed', error: d.failWith });
        d.onEvent({ type: 'failed', code: d.failWith, message: 'download failed (fake)' });
        continue;
      }
      d.done = Math.min(m.size, d.done + Math.round((DOWNLOAD_BPS * ms) / 1000));
      if (d.done < m.size) {
        models.set(id, { ...m, state: 'downloading', bytes: d.done });
        d.onEvent({ type: 'progress', done: d.done, total: m.size, bytesPerSec: DOWNLOAD_BPS });
      } else {
        downloads.delete(id);
        d.onEvent({ type: 'verifying' });
        const ready: ModelState = { ...m, state: 'ready', bytes: m.size, error: null };
        models.set(id, ready);
        d.onEvent({ type: 'done', model: ready });
      }
    }
    // imports
    for (const [id, imp] of [...imports]) {
      if (imp.failWith) {
        imports.delete(id);
        imp.onEvent({ type: 'failed', code: imp.failWith, message: 'import failed (fake)' });
        continue;
      }
      imp.done = Math.min(1, imp.done + ms / 2000);
      if (imp.done < 1) imp.onEvent({ type: 'progress', done: imp.done });
      else {
        imports.delete(id);
        const h = host;
        const path = `${imp.req.lectureDir}/audio.webm`;
        void (h ? h.fs.write(imp.req.classId, path, webm, { own: true }) : Promise.resolve()).then(() =>
          imp.onEvent({ type: 'done', audio: audioOf(60_000, 1, 24_000, { kind: 'class', classId: imp.req.classId, path }) }),
        );
      }
    }
    // transcription jobs
    for (const job of [...jobs.values()]) {
      if (job.summary.state !== 'running') continue;
      if (job.failWith) {
        job.summary = { ...job.summary, state: 'failed', error: job.failWith };
        job.onEvent({ type: 'failed', code: job.failWith, message: 'transcription failed (fake)' });
        continue;
      }
      if (job.elapsed === 0) job.onEvent({ type: 'phase', phase: job.req.engine.kind === 'cloud' ? 'uploading' : 'transcribing' });
      job.elapsed += ms;
      const progress = Math.min(1, job.elapsed / jobMs);
      const etaMs = progress >= 1 ? null : Math.round(jobMs - job.elapsed) * 400;
      job.summary = { ...job.summary, progress, etaMs };
      if (progress < 1) {
        job.onEvent({ type: 'progress', progress, etaMs });
        void writeClaim(job);
      } else {
        job.result = resultFor(job.req);
        job.summary = { ...job.summary, state: 'done', resultReady: true, etaMs: null };
        void writeClaim(job);
        job.onEvent({ type: 'done', summary: job.summary });
      }
    }
  }

  const fake: FakeSpeech = {
    webm,
    requests: { transcribe: [], publish: [], cancel: [], peaks: 0 },
    bind(h, o = {}) {
      host = h;
      if (opts.recording && o.recordingClassId && !rec) {
        // `recording=1`: a recording of the class at 00:41:12 (UX §7.2).
        startRecording(
          { recordingId: newUlid(now() - 2_472_000, rand), classId: o.recordingClassId, title: 'Aula 9', mode: 'room', includeMic: true, inputDeviceId: null, language: 'pt-PT', bitrate: 24000, markerOffsetMs: 3000 },
          () => undefined,
          2_472_000,
        );
      }
    },
    tick,
    script(lectureId, result) {
      scripts.set(lectureId, result);
    },
    failNext(what, code) {
      failures.set(what, code);
    },
    async info(): Promise<SpeechInfo> {
      return {
        cpuOk: opts.cpuOk ?? true, localWhisper: true, vad: true, engineVersion: 'whisper.cpp 1.8.3 (simulated)', defaultModel: 'turbo',
        models: [...models.values()], systemAudio: { supported: true, reason: null }, recorder: status(), jobs: await fake.transcribe.jobs(),
      };
    },
    async models() {
      return [...models.values()];
    },
    async downloadModel(id, onEvent) {
      const m = models.get(id);
      if (!m) throw new PlatformError('INVALID', `unknown model ${id}`);
      if (!(opts.cpuOk ?? true)) throw new PlatformError('SPEECH_UNSUPPORTED_CPU', 'this processor cannot run the speech model');
      if (downloads.size && !downloads.has(id)) throw new PlatformError('JOB_BUSY', 'another model is downloading');
      if (m.state === 'ready') {
        onEvent({ type: 'done', model: m });
        return;
      }
      const from = downloads.get(id)?.done ?? m.bytes;
      downloads.set(id, { onEvent, done: from, failWith: fail('download') });
      models.set(id, { ...m, state: 'downloading', error: null });
      onEvent({ type: 'started', total: m.size, resumedFrom: from });
    },
    async attachModel(id, onEvent) {
      const d = downloads.get(id);
      if (!d) return false;
      d.onEvent = onEvent;
      return true;
    },
    async cancelModel(id) {
      const d = downloads.get(id);
      if (!d) return;
      downloads.delete(id);
      models.set(id, { ...models.get(id)!, state: 'partial', bytes: d.done });
      d.onEvent({ type: 'cancelled' });
    },
    async deleteModel(id) {
      if ([...jobs.values()].some((j) => j.summary.state === 'running' && j.req.engine.kind === 'local' && j.req.engine.model === id)) throw new PlatformError('JOB_BUSY', 'the model is in use');
      const m = models.get(id);
      if (m) models.set(id, { ...m, state: 'absent', bytes: 0, error: null });
    },
    async importModel(id) {
      const m = models.get(id);
      if (!m) throw new PlatformError('INVALID', `unknown model ${id}`);
      const ready: ModelState = { ...m, state: 'ready', bytes: m.size, error: null };
      models.set(id, ready);
      return ready;
    },
    async devices(): Promise<AudioDevices> {
      return { inputs: [{ id: 'default', name: 'Built-in microphone', isDefault: true }, { id: 'usb', name: 'USB headset', isDefault: false }], systemAudio: { supported: true, reason: null } };
    },
    meter: {
      async start(req, onEvent) {
        if (rec) throw new PlatformError('JOB_BUSY', 'recording');
        meter = (e) => onEvent({ ...e, system: req.mode === 'online' ? level('Speakers (monitor)') : null });
        onEvent({ type: 'level', mic: level('Built-in microphone'), system: req.mode === 'online' ? level('Speakers (monitor)') : null });
      },
      async stop() {
        meter = null;
      },
    },
    recorder: {
      async start(req, onEvent) {
        const f = fail('recorder');
        if (f) throw new PlatformError(f, 'recorder failed (fake)');
        if (rec) throw new PlatformError('JOB_BUSY', 'already recording');
        meter = null;
        startRecording(req, onEvent);
        return status()!;
      },
      async attach(onEvent) {
        if (!rec) return null;
        rec.onEvent = onEvent;
        return status();
      },
      async pause() {
        if (!rec) throw new PlatformError('NOT_FOUND', 'not recording');
        if (rec.status.state === 'recording') {
          rec.pausedAt = now();
          rec.status = { ...rec.status, state: 'paused' };
        }
        return status()!;
      },
      async resume() {
        if (!rec) throw new PlatformError('NOT_FOUND', 'not recording');
        if (rec.status.state === 'paused') {
          rec.pauses.push({ atMs: rec.status.ms, wallFrom: instant(rec.pausedAt ?? now()), wallTo: instant(now()) });
          rec.pausedAt = null;
          rec.status = { ...rec.status, state: 'recording' };
        }
        return status()!;
      },
      async mark(kind: MarkerKind, note?: string) {
        if (!rec) throw new PlatformError('NOT_FOUND', 'not recording');
        const raw = rec.status.ms;
        const marker: Marker = { id: newUlid(now(), rand), atMs: Math.max(0, raw - rec.req.markerOffsetMs), rawMs: raw, kind, ...(note ? { note } : {}) };
        rec.markers.push(marker);
        rec.onEvent({ type: 'marker', marker });
        return marker;
      },
      async stop() {
        if (!rec) throw new PlatformError('NOT_FOUND', 'not recording');
        const r = rec;
        if (r.pausedAt !== null) r.pauses.push({ atMs: r.status.ms, wallFrom: instant(r.pausedAt), wallTo: instant(now()) });
        rec = null;
        const done = finished(r, 'stopped');
        pending.push(done);
        r.onEvent({ type: 'stopped', reason: 'user' });
        return done;
      },
      async pending() {
        return pending.map((p) => ({ ...p }));
      },
      async publish(req) {
        fake.requests.publish.push(req);
        const f = fail('publish');
        if (f) throw new PlatformError(f, 'publish failed (fake)');
        const i = pending.findIndex((p) => p.recordingId === req.recordingId);
        if (i < 0) throw new PlatformError('NOT_FOUND', 'no such recording');
        const r = pending[i]!;
        if (req.share === 'none') return audioOf(r.durationMs, r.channels, r.bitrate, { kind: 'private', recordingId: r.recordingId });
        let source: PublishedAudio['source'];
        if (req.share === 'audio+transcript') {
          const h = needHost();
          const path = `${req.lectureDir}/audio.webm`;
          if (await h.fs.stat(req.classId, path).catch(() => null)) throw new PlatformError('CONFLICT', `${path} exists`);
          await h.fs.write(req.classId, path, webm, { own: true });
          source = { kind: 'class', classId: req.classId, path };
        } else {
          privateAudio.set(r.recordingId, webm);
          host?.mem.putRecording?.(r.recordingId, webm);   // G1: media.url({ kind: 'private' }) serves it
          source = { kind: 'private', recordingId: r.recordingId };
        }
        pending.splice(i, 1);
        return audioOf(r.durationMs, r.channels, r.bitrate, source);
      },
      async discard(recordingId) {
        const i = pending.findIndex((p) => p.recordingId === recordingId);
        if (i >= 0) pending.splice(i, 1);
        privateAudio.delete(recordingId);
        host?.mem.putRecording?.(recordingId, null);
      },
    },
    async importAudio(req, onEvent) {
      const f = fail('import');
      if (f === 'SPEECH_UNSUPPORTED_AUDIO' || f === 'UNSUPPORTED_FILE') throw new PlatformError(f, 'this audio format is not supported (fake)');
      if (imports.size) throw new PlatformError('JOB_BUSY', 'an import is running');
      imports.set(req.recordingId, { recordingId: req.recordingId, req, onEvent, done: 0, failWith: f });
    },
    async attachImport(recordingId, onEvent) {
      const imp = imports.get(recordingId);
      if (!imp) return false;
      imp.onEvent = onEvent;
      return true;
    },
    transcribe: {
      async start(req, onEvent) {
        fake.requests.transcribe.push(req);
        if ([...jobs.values()].some((j) => j.summary.state === 'running')) throw new PlatformError('JOB_BUSY', 'a transcription is running');
        if (req.engine.kind === 'local') {
          if (!(opts.cpuOk ?? true)) throw new PlatformError('SPEECH_UNSUPPORTED_CPU', 'unsupported CPU');
          if (models.get(req.engine.model)?.state !== 'ready') throw new PlatformError('MODEL_NOT_DOWNLOADED', 'the model is not installed');
        }
        // The audio must be the one the lecture names (Rust checks the SHA-256 first).
        let bytes: Uint8Array | null = null;
        if (req.source.kind === 'private') bytes = privateAudio.get(req.source.recordingId) ?? null;
        else if (host) bytes = await host.fs.read(req.source.classId, req.source.path).catch(() => null);
        if (bytes && sha256Hex(bytes) !== req.expectSha256) throw new PlatformError('CONFLICT', 'the audio does not match its lecture');
        const summary: JobSummary = { jobId: req.jobId, lectureId: req.lectureId, state: 'running', progress: 0, etaMs: null, startedAt: instant(now()), error: null, resultReady: false };
        jobs.set(req.jobId, { summary, req, onEvent, elapsed: 0, failWith: fail('transcribe'), result: null, heartbeat: 0 });
        return req.jobId;
      },
      async attach(jobId, onEvent) {
        const j = jobs.get(jobId);
        if (!j) return null;
        j.onEvent = onEvent;
        return j.summary;
      },
      async cancel(jobId, keepPartial) {
        fake.requests.cancel.push({ jobId, keepPartial });
        const j = jobs.get(jobId);
        if (!j || j.summary.state !== 'running') return;
        j.summary = { ...j.summary, state: 'cancelled' };
        jobs.delete(jobId);
        j.onEvent({ type: 'cancelled' });
      },
      async jobs() {
        return [...jobs.values()].map((j) => j.summary);
      },
      async take(jobId) {
        const j = jobs.get(jobId);
        if (!j || !j.result) throw new PlatformError('NOT_FOUND', 'no finished result for this job');
        return j.result;
      },
    },
    async peaks(source, buckets) {
      fake.requests.peaks += 1;
      if (buckets < 100 || buckets > 4000) throw new PlatformError('INVALID', 'buckets must be 100–4000');
      const seed = sha256(source.kind === 'class' ? `${source.classId}/${source.path}` : source.recordingId);
      const r = mulberry32((seed[0]! << 24) | (seed[1]! << 16) | (seed[2]! << 8) | seed[3]!);
      const out: number[] = [];
      let v = 90;
      for (let i = 0; i < buckets; i++) {
        v = Math.max(8, Math.min(250, v + Math.round((r() - 0.5) * 60)));
        out.push(i % 97 < 3 ? 6 : v);
      }
      return out;
    },
    controls(keys) {
      const claimants = new Map<Ulid, { deviceId: DeviceId; memberId: MemberId; claimedAt: number; heartbeat: number }>();
      const resolve = (lectureKey: string) => {
        const l = keys.lectures[lectureKey];
        const classId = l ? keys.classes[l.classKey] : undefined;
        if (!l || !classId) throw new PlatformError('NOT_FOUND', `unknown lecture key ${lectureKey}`);
        return { classId, lectureId: l.lectureId };
      };
      const asPeer = (classId: ClassId, deviceId: DeviceId, path: ClassPath, text: string) => {
        const h = needHost();
        const bytes = new TextEncoder().encode(text);
        if (deviceId === h.mem.deviceId) return h.fs.write(classId, path, bytes, { own: true }).then(() => undefined);
        h.mem.applyRemote(classId, path, bytes, { modifiedBy: shortIdOf(deviceId), mtimeMs: now() });
        return Promise.resolve();
      };
      const findLecture = async (classId: ClassId, lectureId: Ulid): Promise<{ dir: ClassPath; lecture: LectureFile } | null> => {
        const h = needHost();
        for (const f of await h.fs.list(classId, '', { recursive: true, maxDepth: 6 })) {
          if (f.isDir || f.name !== 'lecture.json') continue;
          try {
            const l = JSON.parse(new TextDecoder().decode(await h.fs.read(classId, f.path))) as LectureFile;
            if (l.id === lectureId) return { dir: f.path.slice(0, Math.max(0, f.path.lastIndexOf('/'))), lecture: l };
          } catch {
            // not a lecture manifest
          }
        }
        return null;
      };
      const claimText = (lectureId: Ulid, c: { deviceId: DeviceId; memberId: MemberId; claimedAt: number; heartbeat: number }, status: ClaimFile['status'], extra: Partial<ClaimFile>) =>
        compactJson({
          format: 'tramado.claim', version: 1, kind: 'transcribe', lectureId, round: 1, deviceId: c.deviceId, memberId: c.memberId, claimedAt: c.claimedAt,
          status, heartbeat: c.heartbeat, updatedAt: instant(now()), audioSha256: null, engine: { kind: 'local', model: 'turbo' }, ...extra,
        } satisfies ClaimFile);
      return {
        async claimTranscription(lectureKey, memberKey, percent) {
          const { classId, lectureId } = resolve(lectureKey);
          const m = keys.members[memberKey];
          const deviceId = m?.deviceIds[0];
          if (!m || !deviceId) throw new PlatformError('NOT_FOUND', `unknown member key ${memberKey}`);
          const prev = claimants.get(lectureId);
          const c = { deviceId, memberId: m.memberId, claimedAt: prev?.deviceId === deviceId ? prev.claimedAt : now(), heartbeat: (prev?.deviceId === deviceId ? prev.heartbeat : 0) + 1 };
          claimants.set(lectureId, c);
          const p = Math.max(0, Math.min(100, percent)) / 100;
          await asPeer(classId, deviceId, `.tramado/claims/${lectureId}/${deviceId}.json`, claimText(lectureId, c, 'working', { progress: p, etaMs: Math.round((1 - p) * 40 * 60_000) }));
        },
        async finishTranscription(lectureKey) {
          const { classId, lectureId } = resolve(lectureKey);
          const h = needHost();
          const c = claimants.get(lectureId) ?? { deviceId: h.mem.deviceId, memberId: '', claimedAt: now(), heartbeat: 0 };
          const found = await findLecture(classId, lectureId);
          if (!found) throw new PlatformError('NOT_FOUND', 'the lecture is not in the class');
          const name = Object.entries(keys.members).find(([, v]) => v?.deviceIds.includes(c.deviceId))?.[0] ?? 'Ana';
          const req = { lectureId, language: found.lecture.language, channels: found.lecture.audio?.channels === 2 ? 'split' : 'mix', engine: { kind: 'local', model: 'turbo' } } as TranscribeRequest;
          const t = fromResult(resultFor(req), {
            lecture: found.lecture, round: 1, writer: { deviceId: c.deviceId, memberId: c.memberId, name: name.charAt(0).toUpperCase() + name.slice(1) },
            at: instant(now()), rand, modelId: 'turbo',
          });
          const prefix = found.dir ? `${found.dir}/` : '';
          await asPeer(classId, c.deviceId, `${prefix}transcript.json`, compactJson(t));
          await asPeer(classId, c.deviceId, `${prefix}transcript.md`, renderMarkdown(t, found.lecture));
          await asPeer(classId, c.deviceId, `${prefix}transcript.vtt`, renderVtt(t));
          c.heartbeat += 1;
          await asPeer(classId, c.deviceId, `.tramado/claims/${lectureId}/${c.deviceId}.json`, claimText(lectureId, c, 'done', { progress: 1, finishedAt: instant(now()), transcriptRevision: 1 }));
        },
        tick,
      };
    },
  };
  return fake;
}

/** The host a memory platform offers the fake (tests and demo/boot: `fake.bind(fakeSpeechHost(platform))`). */
export function fakeSpeechHost(platform: MemoryPlatform): FakeSpeechHost {
  return platform;
}
