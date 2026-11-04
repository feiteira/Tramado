import { describe, expect, it } from 'vitest';
import { itemIdOf } from '../core/model/derive';
import type { LectureFile, TranscriptFile } from '../core/model/files';
import { shortIdOf, type ClassId, type DeviceId } from '../core/model/ids';
import { sha256Hex } from '../core/util/sha256';
import { createFakeSpeech, type FakeSpeech } from '../platform/memory/speech';
import type { MemoryPlatform } from '../platform/memory';
import type { Power } from '../platform/types';
import type { ClassStoreImpl } from './classStore';
import { createServices } from './index';
import type { LectureServiceImpl } from './lectures';
import { claimView, installClassFakes } from './testing/fakeClaims';
import { createTestContext } from './testing/context';
import type { TranscriptionQueueImpl } from './transcription';
import type { ClassServices } from './types/common';

const BRUNO: DeviceId = 'TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT';
const bruno = { deviceId: BRUNO, memberId: 'b6xq2l4p7vjk3m5n2c7hzr4wte', name: 'Bruno Costa' };
const START = 1_793_700_000_000;
const HOUR = 3_600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
let n = 0;
const nonce = () => `aaaaaaaaaaaaaaaaaaaaaaa${'bcdefghijklmnopqrstuvwxyz'[n++ % 25]}${'bcd'[Math.floor(n / 25) % 3]}a`;

async function setup(opts: { shared?: boolean; speech?: FakeSpeech; power?: Power; startMs?: number } = {}) {
  const speech = opts.speech ?? createFakeSpeech({ now: () => START });
  const t = await createTestContext({ name: 'Ana Ribeiro', speech, startMs: opts.startMs ?? START + 2 * HOUR, ...(opts.power ? { power: opts.power } : {}) });
  const { ctx, platform, clock } = t;
  speech.bind(platform);
  let services = createServices(ctx);
  const classId = await services.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share: false });
  if (opts.shared) {
    await platform.sync.shareClass(classId, 'Direito Constitucional I');
    await services.library.load();
  }
  const me = { deviceId: platform.mem.deviceId, memberId: ctx.identity.get()!.memberId, name: 'Ana Ribeiro' };
  const wire = (s: ReturnType<typeof createServices>) => {
    const cs = s.forClass(classId);
    cs.store.setDirs({ lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' });
    return { cs, fakes: installClassFakes(cs, { me, now: () => clock.now() }) };
  };
  let w = wire(services);
  const queue = () => services.transcription as TranscriptionQueueImpl;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await queue().idle();
      await (w.cs.store as ClassStoreImpl).idle();
      await (w.cs.lectures as LectureServiceImpl).refresh();
      await queue().evaluate();
      await queue().idle();
    }
  };
  const restart = async () => {
    queue().dispose();
    services.dispose();
    services = createServices(ctx);
    await services.library.load();
    w = wire(services);
    return w;
  };
  return {
    ...t, speech, classId, me, settle, restart,
    get services() { return services; }, get cs(): ClassServices { return w.cs; }, get fakes() { return w.fakes; }, get queue() { return queue(); },
  };
}

interface Spec { by?: typeof bruno; dir: string; startMs?: number; durationMs?: number; audio?: Uint8Array | null; sha?: string; transcript?: Partial<TranscriptFile> | null }

async function addLecture(platform: MemoryPlatform, classId: ClassId, me: typeof bruno, spec: Spec) {
  const by = spec.by ?? me;
  const startMs = spec.startMs ?? START;
  const nn = nonce();
  const id = itemIdOf(startMs, by.deviceId, nn);
  const audio = spec.audio === undefined ? new Uint8Array([7, 7, 7, 7]) : spec.audio;
  const lecture: LectureFile = {
    format: 'tramado.lecture', version: 1, id, idNonce: nn, title: `Aula ${n}`, startedAt: new Date(startMs).toISOString(), durationMs: spec.durationMs ?? 5_400_000,
    mode: 'room', language: 'pt-PT', recordedBy: by,
    audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: 4, sha256: spec.sha ?? sha256Hex(new Uint8Array([7, 7, 7, 7])) },
    channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [], updatedAt: new Date(startMs).toISOString(),
  };
  const put = (path: string, bytes: Uint8Array, writer: DeviceId) =>
    writer === me.deviceId ? platform.fs.write(classId, path, bytes, { own: true }) : Promise.resolve(platform.mem.applyRemote(classId, path, bytes, { modifiedBy: shortIdOf(writer), mtimeMs: startMs }));
  await put(`${spec.dir}/lecture.json`, enc.encode(JSON.stringify(lecture, null, 2)), by.deviceId);
  if (audio) await put(`${spec.dir}/audio.webm`, audio, by.deviceId);
  if (spec.transcript) {
    const t: TranscriptFile = {
      format: 'tramado.transcript', version: 1, lectureId: id, round: 1, revision: 1, audioSha256: lecture.audio!.sha256, language: 'pt-PT',
      writer: { deviceId: by.deviceId, memberId: by.memberId }, transcribedBy: { ...by, at: new Date(startMs).toISOString() }, engine: { kind: 'local', name: 'whisper.cpp' },
      speakers: [{ id: 'lecture', label: 'Professor' }], segments: [{ id: 's_aaaaa', startMs: 0, endMs: 1000, speaker: 'lecture', text: 'Olá.' }], folded: {},
      updatedAt: new Date(startMs).toISOString(), ...spec.transcript,
    };
    await put(`${spec.dir}/transcript.json`, enc.encode(JSON.stringify(t)), t.writer.deviceId);
  }
  return { id, lecture };
}

describe('TranscriptionQueue: eligibility (sync spec §14.2)', () => {
  it('refuses a lecture whose local audio does not match its SHA-256', async () => {
    const s = await setup();
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a', sha: 'f'.repeat(64) });
    await s.settle();
    expect(await s.queue.claim(s.classId, id, 'local')).toBe('ineligible');
    expect(s.fakes.claims.calls).toEqual([]);
    expect(s.queue.state.get().lectures.find((l) => l.lectureId === id)).toMatchObject({ eligible: false, reason: 'audioMismatch' });
  });

  it('refuses without an engine, and while the audio is still arriving', async () => {
    const s = await setup({ speech: createFakeSpeech({ now: () => START, model: 'missing' }) });
    const a = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    const b = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/b', audio: null, startMs: START + 86_400_000 });
    await s.settle();
    expect(await s.queue.claim(s.classId, a.id, 'local')).toBe('ineligible');
    expect(await s.queue.claim(s.classId, a.id, 'cloud')).toBe('ineligible');   // cloud is off
    await s.queue.setCloud(true, 'openai/whisper-large-v3-turbo', false);
    expect(await s.queue.claim(s.classId, b.id, 'cloud')).toBe('ineligible');
    const reasons = Object.fromEntries(s.queue.state.get().lectures.map((l) => [l.lectureId, l.reason]));
    expect(reasons[b.id]).toBe('audioArriving');
    expect(await s.queue.claim(s.classId, a.id, 'cloud')).toBe('won');
    expect(s.fakes.claims.calls[0]!.input.engine).toEqual({ kind: 'cloud', model: 'openai/whisper-large-v3-turbo' });
  });

  it('an untrusted transcript blocks automatic claims but not a manual one', async () => {
    const s = await setup({ shared: true });
    s.cs.store.setTrustGate({
      verify: async (path) => (path.endsWith('transcript.json') ? { kind: 'untrusted', reason: 'foreign-write' } : { kind: 'trusted' }),
      noteOwnWrite: () => undefined,
    });
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a', transcript: { writer: { deviceId: 'LGTQI2N-C7CZ54U-LP7HIBQ-VR4TCWO-YY67AJF-SXWTCG5-QLJA5Q4-X4KTTQO', memberId: 'c'.repeat(26) } } });
    await s.queue.start();
    await s.settle();
    expect((s.cs.lectures as LectureServiceImpl).list.get()[0]!.untrustedTranscript).toBe(true);
    s.clock.advance(10 * 60_000);
    await s.settle();
    expect(s.fakes.claims.calls).toEqual([]);
    expect(await s.queue.claim(s.classId, id, 'local')).toBe('won');
  });
});

describe('TranscriptionQueue: the job and its publication (sync spec §14.5)', () => {
  it('on a win runs the job, then writes transcript.json, .md, .vtt and only then the claim done', async () => {
    const s = await setup();
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    await s.settle();
    const writes: string[] = [];
    s.platform.mem.onWrite((c, path, bytes) => {
      if (c !== s.classId) return;
      const status = path.includes('/claims/') && bytes ? (JSON.parse(dec.decode(bytes)) as { status: string }).status : '';
      writes.push(`${path.slice(path.lastIndexOf('/') + 1)}${status ? `:${status}` : ''}`);
    });
    expect(await s.queue.claim(s.classId, id, 'local')).toBe('won');
    const req = s.speech.requests.transcribe[0]!;
    expect(req).toMatchObject({
      lectureId: id, source: { kind: 'class', classId: s.classId, path: 'Aulas/a/audio.webm' }, expectSha256: sha256Hex(new Uint8Array([7, 7, 7, 7])),
      engine: { kind: 'local', model: 'turbo' }, language: 'pt-PT', channels: 'mix', resume: false,
      claim: { classId: s.classId, path: `.tramado/claims/${id}/${s.me.deviceId}.json`, file: { status: 'working', lectureId: id, deviceId: s.me.deviceId } },
    });
    expect(s.queue.state.get().job).toMatchObject({ lectureId: id, classId: s.classId, state: 'running', engine: 'local' });
    expect(s.fakes.activities).toEqual([{ transcribing: { lectureId: id, progress: 0 } }]);
    writes.length = 0;
    for (let i = 0; i < 4; i++) s.speech.tick(1000);
    await s.settle();
    const after = writes.slice(writes.indexOf('transcript.json'));
    expect(after).toEqual(['transcript.json', 'transcript.md', 'transcript.vtt', `${s.me.deviceId}.json:done`]);
    const t = JSON.parse(dec.decode(await s.platform.fs.read(s.classId, 'Aulas/a/transcript.json'))) as TranscriptFile;
    expect(t).toMatchObject({ lectureId: id, round: 1, revision: 1, writer: { deviceId: s.me.deviceId, memberId: s.me.memberId }, audioSha256: req.expectSha256, engine: { kind: 'local', name: 'whisper.cpp', modelId: 'turbo' } });
    expect(t.segments.map((x) => x.text)).toEqual(['Bom dia a todos.', 'Hoje vamos ver o artigo 18.º da Constituição.', 'Isto costuma sair no exame, tomem nota.']);
    expect(s.fakes.claims.statuses.at(-1)).toMatchObject({ lectureId: id, kind: 'transcribe', patch: { status: 'done', transcriptRevision: 1 } });
    expect(s.queue.state.get().job).toBeNull();
    expect(s.fakes.activities.at(-1)).toEqual({ transcribing: undefined });
    expect((s.cs.lectures as LectureServiceImpl).list.get()[0]!.transcription).toMatchObject({ kind: 'done', by: { self: true } });
  });

  it('a lost claim cancels the job (keeping the partial) and deletes the claim', async () => {
    const s = await setup();
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    await s.settle();
    await s.queue.claim(s.classId, id, 'local');
    s.speech.tick(1000);
    s.fakes.claims.lose(id);
    await s.settle();
    expect(s.speech.requests.cancel).toEqual([{ jobId: s.speech.requests.transcribe[0]!.jobId, keepPartial: true }]);
    expect(s.fakes.claims.removed).toEqual([{ lectureId: id, kind: 'transcribe' }]);
    expect(s.queue.state.get().job).toBeNull();
    for (let i = 0; i < 5; i++) s.speech.tick(1000);
    await s.settle();
    expect(await s.platform.fs.stat(s.classId, 'Aulas/a/transcript.json')).toBeNull();
  });

  it('a finished job that is no longer the winner never writes transcript.*', async () => {
    const s = await setup({ shared: true });
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    await s.settle();
    await s.queue.claim(s.classId, id, 'local');
    // Bruno finished first in a partition: his done claim outranks mine.
    s.fakes.claims.setOthers(id, 'transcribe', [claimView(BRUNO, { status: 'done', progress: 1 })]);
    for (let i = 0; i < 4; i++) s.speech.tick(1000);
    await s.settle();
    expect(await s.platform.fs.stat(s.classId, 'Aulas/a/transcript.json')).toBeNull();
    expect(s.fakes.claims.removed).toContainEqual({ lectureId: id, kind: 'transcribe' });
    expect(s.fakes.claims.statuses.filter((x) => x.patch.status === 'done')).toEqual([]);
  });

  it('a failed job is not retried automatically for 24 h', async () => {
    const s = await setup({ shared: true });
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    await s.settle();
    s.speech.failNext('transcribe', 'MODEL_UNREADABLE');
    await s.queue.claim(s.classId, id, 'local');
    s.speech.tick(1000);
    await s.queue.start();
    await s.settle();
    expect(s.queue.state.get().job).toBeNull();
    // Rust wrote the claim `failed`; volunteering does not pick the lecture again within the cool-down.
    s.fakes.claims.setOthers(id, 'transcribe', []);
    await s.fakes.claims.setStatus(id, 'transcribe', { status: 'failed', error: 'MODEL_UNREADABLE' });
    s.clock.advance(30 * 60_000);
    await s.settle();
    expect(s.fakes.claims.calls).toHaveLength(1);
    // A manual retry is always allowed.
    expect(await s.queue.claim(s.classId, id, 'local')).toBe('won');
    expect(s.fakes.claims.calls).toHaveLength(2);
  });

  it('release stops the job and marks the claim released; re-transcribing is a new round', async () => {
    const s = await setup();
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a', transcript: {} });
    await s.settle();
    expect(await s.queue.claim(s.classId, id, 'local')).toBe('ineligible');   // already transcribed this round
    await s.queue.retranscribe(s.classId, id);
    expect(s.fakes.claims.calls.at(-1)!.input).toMatchObject({ newRound: true, supersedeStale: true });
    s.speech.tick(1000);
    await s.queue.release(s.classId, id);
    expect(s.speech.requests.cancel.at(-1)).toMatchObject({ keepPartial: false });
    expect(s.fakes.claims.statuses.at(-1)).toMatchObject({ patch: { status: 'released' } });
    await s.queue.retranscribe(s.classId, id);
    for (let i = 0; i < 4; i++) s.speech.tick(1000);
    await s.settle();
    const t = JSON.parse(dec.decode(await s.platform.fs.read(s.classId, 'Aulas/a/transcript.json'))) as TranscriptFile;
    expect(t).toMatchObject({ round: 3, revision: 1, writer: { deviceId: s.me.deviceId } });
  });

  it('after a restart re-attaches the running job, or publishes a result that finished meanwhile', async () => {
    const s = await setup();
    const a = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    await s.settle();
    await s.queue.claim(s.classId, a.id, 'local');
    s.speech.tick(1000);
    // The webview reloads: new services, the job keeps running in "Rust", the claim file is still ours.
    const w = await s.restart();
    await w.fakes.claims.restore(a.id, 'transcribe', 'working');
    await s.queue.start();
    expect(s.queue.state.get().job).toMatchObject({ lectureId: a.id, state: 'running' });
    for (let i = 0; i < 3; i++) s.speech.tick(1000);
    await s.settle();
    expect(JSON.parse(dec.decode(await s.platform.fs.read(s.classId, 'Aulas/a/transcript.json'))).lectureId).toBe(a.id);
    expect(w.fakes.claims.statuses.at(-1)).toMatchObject({ patch: { status: 'done' } });

    const b = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/b', startMs: START + 86_400_000 });
    await s.settle();
    await s.queue.claim(s.classId, b.id, 'local');
    const w2 = await s.restart();
    for (let i = 0; i < 4; i++) s.speech.tick(1000);   // finished while nobody listened
    await w2.fakes.claims.restore(b.id, 'transcribe', 'working');
    await s.queue.start();
    await s.settle();
    expect(JSON.parse(dec.decode(await s.platform.fs.read(s.classId, 'Aulas/b/transcript.json'))).lectureId).toBe(b.id);
  });
});

describe('TranscriptionQueue: volunteering (sync spec §14.3)', () => {
  it('claims an unclaimed lecture after the capability delay, skipping probable duplicates and the recorder’s own "not now"', async () => {
    const s = await setup({ shared: true, power: { source: 'ac', percent: null } });
    await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/main', startMs: START, transcript: {} });
    await addLecture(s.platform, s.classId, s.me, { dir: 'Aulas/backup', startMs: START + 60_000, durationMs: 5_000_000 });
    const mine = await addLecture(s.platform, s.classId, s.me, { dir: 'Aulas/mine', startMs: START + 2 * 86_400_000 });
    const other = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/other', startMs: START + 86_400_000 });
    await s.settle();
    await s.platform.privateFiles.write(s.classId, `lectures/${mine.id}.json`, enc.encode(JSON.stringify({ format: 'tramado.lecture-private', version: 1, summary: null, terms: null, removedAutoMarks: [], noAutoClaim: true })));
    await s.queue.start();
    await s.settle();
    expect(s.queue.state.get()).toMatchObject({ volunteer: 'plugged', volunteerEffective: 'plugged', volunteerNotice: true });
    s.clock.advance(59_000);
    await s.settle();
    expect(s.fakes.claims.calls).toEqual([]);
    s.clock.advance(16_000);
    await s.settle();
    expect(s.fakes.claims.calls.map((c) => c.lectureId)).toEqual([other.id]);
    expect(s.fakes.claims.calls[0]!.input).toMatchObject({ engine: { kind: 'local', model: 'turbo' }, supersedeStale: false });
    await s.queue.ackVolunteerNotice(false);
    expect(s.queue.state.get().volunteerNotice).toBe(false);
  });

  it('does not volunteer on battery with "plugged", nor without a model, nor in a class that is not shared', async () => {
    const battery = await setup({ shared: true, power: { source: 'battery', percent: 50 } });
    await addLecture(battery.platform, battery.classId, battery.me, { by: bruno, dir: 'Aulas/a' });
    await battery.queue.start();
    await battery.settle();
    battery.clock.advance(30 * 60_000);
    await battery.settle();
    expect(battery.fakes.claims.calls).toEqual([]);
    await battery.queue.setVolunteer('always');
    battery.clock.advance(11 * 60_000 + 15_000);
    await battery.settle();
    expect(battery.fakes.claims.calls).toHaveLength(1);

    const noModel = await setup({ shared: true, speech: createFakeSpeech({ now: () => START, model: 'missing' }) });
    await addLecture(noModel.platform, noModel.classId, noModel.me, { by: bruno, dir: 'Aulas/a' });
    await noModel.queue.start();
    await noModel.settle();
    expect(noModel.queue.state.get()).toMatchObject({ volunteer: 'plugged', volunteerEffective: 'off', volunteerNotice: false });
    noModel.clock.advance(30 * 60_000);
    await noModel.settle();
    expect(noModel.fakes.claims.calls).toEqual([]);

    const local = await setup();
    await addLecture(local.platform, local.classId, local.me, { by: bruno, dir: 'Aulas/a' });
    await local.queue.start();
    await local.settle();
    local.clock.advance(30 * 60_000);
    await local.settle();
    expect(local.fakes.claims.calls).toEqual([]);
  });

  it('takes over from a stale winner after its own delay, superseding it', async () => {
    const s = await setup({ shared: true });
    const { id } = await addLecture(s.platform, s.classId, s.me, { by: bruno, dir: 'Aulas/a' });
    s.fakes.claims.setOthers(id, 'transcribe', [claimView(BRUNO, { progress: 0.4 })]);
    await s.queue.start();
    await s.settle();
    s.clock.advance(5 * 60_000);
    await s.settle();
    expect(s.fakes.claims.calls).toEqual([]);
    s.fakes.claims.setOthers(id, 'transcribe', [claimView(BRUNO, { progress: 0.4, health: 'stale', sinceMs: 600_000 })]);
    await s.settle();
    s.clock.advance(75_000);
    await s.settle();
    expect(s.fakes.claims.calls.map((c) => [c.lectureId, c.input.supersedeStale])).toEqual([[id, true]]);
  });

  it('reminds the recorder once when nobody transcribed a lecture for 24 h', async () => {
    const s = await setup({ shared: true, speech: createFakeSpeech({ now: () => START, model: 'missing' }), startMs: START + 30 * HOUR });
    const { id } = await addLecture(s.platform, s.classId, s.me, { dir: 'Aulas/a', startMs: START });
    await s.queue.start();
    await s.settle();
    const priv = JSON.parse(dec.decode((await s.platform.privateFiles.read(s.classId, `lectures/${id}.json`))!));
    expect(typeof priv.nudgedAt).toBe('string');
  });

  it('the hourly check raises the 24 h reminder while nothing else changes (UI-LECTURES)', async () => {
    const s = await setup({ shared: true, speech: createFakeSpeech({ now: () => START, model: 'missing' }) });
    const { id } = await addLecture(s.platform, s.classId, s.me, { dir: 'Aulas/a', startMs: START, durationMs: HOUR });
    await s.queue.start();
    await s.settle();
    const nudged = async () => {
      const bytes = await s.platform.privateFiles.read(s.classId, `lectures/${id}.json`);
      return bytes ? JSON.parse(dec.decode(bytes)).nudgedAt ?? null : null;
    };
    // The recording ended at START + 1 h; the app started at START + 2 h. No file changes from here on.
    for (let h = 1; h <= 22; h++) {
      s.clock.advance(HOUR);
      await s.queue.idle();
    }
    expect(await nudged()).toBeNull();
    s.clock.advance(HOUR);   // START + 25 h: 24 h after the end
    await s.queue.idle();
    await s.settle();
    expect(typeof (await nudged())).toBe('string');
  });
});

