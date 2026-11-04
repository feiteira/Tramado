import { describe, expect, it } from 'vitest';
import { itemIdMatches } from '../core/model/derive';
import type { LectureFile } from '../core/model/files';
import { sha256Hex } from '../core/util/sha256';
import { createFakeSpeech, type FakeSpeech } from '../platform/memory/speech';
import type { ClassStoreImpl } from './classStore';
import { createServices } from './index';
import type { LectureServiceImpl } from './lectures';
import type { RecordingServiceImpl } from './recording';
import { installClassFakes } from './testing/fakeClaims';
import { createTestContext } from './testing/context';
import type { ConsentInput } from './types/class';

const START = 1_793_700_000_000;
const dec = new TextDecoder();
const consent = (kind: 'record' | 'share'): ConsentInput => ({
  kind, scope: 'lecture', textId: kind === 'record' ? 'record.dialog.consent.v1' : 'record.dialog.consentShare.v1', textLang: 'pt-PT',
  text: kind === 'record' ? 'O professor autorizou a gravação desta aula.' : 'O professor autorizou a partilha com esta turma.', ...(kind === 'share' ? { share: 'audio+transcript' as const } : {}),
});

async function setup(opts: { shared?: boolean; speech?: FakeSpeech } = {}) {
  const speech = opts.speech ?? createFakeSpeech({ now: () => START });
  const t = await createTestContext({ name: 'Ana Ribeiro', speech, startMs: START });
  const { ctx, platform, clock } = t;
  const services = createServices(ctx);
  const classId = await services.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share: false });
  if (opts.shared) {
    await platform.sync.shareClass(classId, 'Direito Constitucional I');
    await services.library.load();
  }
  speech.bind(platform, { recordingClassId: classId });
  const cs = services.forClass(classId);
  cs.store.setDirs({ lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' });
  const me = { deviceId: platform.mem.deviceId, memberId: ctx.identity.get()!.memberId, name: 'Ana Ribeiro' };
  const fakes = installClassFakes(cs, { me, now: () => clock.now() });
  const lectures = cs.lectures as LectureServiceImpl;
  const recording = services.recording as RecordingServiceImpl;
  const settle = async () => {
    await recording.idle();
    await (cs.store as ClassStoreImpl).idle();
    await lectures.refresh();
    await lectures.idle();
  };
  const writes: string[] = [];
  platform.mem.onWrite((c, path, _b, kind) => {
    if (c === classId) writes.push(`${kind} ${path}`);
  });
  await settle();
  return { ...t, speech, services, classId, cs, me, fakes, lectures, recording, settle, writes };
}

const findLecture = (files: Map<string, { bytes: Uint8Array }>) => {
  const path = [...files.keys()].find((p) => p.endsWith('/lecture.json'))!;
  return { path, dir: path.slice(0, path.lastIndexOf('/')), lecture: JSON.parse(dec.decode(files.get(path)!.bytes)) as LectureFile };
};

describe('RecordingService', () => {
  it('writes the consent lines, then records, then publishes audio.webm and a lecture.json that matches it', async () => {
    const { speech, recording, classId, me, fakes, platform, settle, lectures, writes } = await setup({ shared: true });
    const consentAtStart: number[] = [];
    const start = speech.recorder.start.bind(speech.recorder);
    speech.recorder.start = async (req, onEvent) => {
      consentAtStart.push(fakes.consent.length);
      return start(req, onEvent);
    };
    await recording.start({ classId, title: 'Aula 9', mode: 'room', includeMic: false, inputDeviceId: null, language: 'pt-PT', consent: { record: consent('record'), share: consent('share'), remember: false } });
    const draftId = recording.state.get()!.status.recordingId;
    expect(fakes.consent.map((c) => [c.kind, c.scope, c.lectureId])).toEqual([['record', 'lecture', draftId], ['share', 'lecture', draftId]]);
    expect(consentAtStart).toEqual([2]);
    expect(fakes.activities).toEqual([{ recording: { draftId, startedAt: new Date(START).toISOString(), mode: 'room', title: 'Aula 9' } }]);
    speech.tick(60_000);
    await recording.mark('exam', 'artigo 18');
    speech.tick(30_000);
    expect(recording.state.get()).toMatchObject({ classId, title: 'Aula 9', status: { state: 'recording', ms: 90_000 }, markers: [{ kind: 'exam', atMs: 57_000, rawMs: 60_000, note: 'artigo 18' }] });
    await recording.pause();
    expect(recording.state.get()!.status.state).toBe('paused');
    await recording.resume();
    const rec = await recording.stop();
    expect(recording.state.get()).toBeNull();
    expect(fakes.activities.at(-1)).toEqual({ recording: undefined });
    expect(recording.pending.get().map((r) => r.recordingId)).toEqual([draftId]);

    writes.length = 0;
    const id = await recording.publish(rec, { title: 'Aula 9 — Direitos fundamentais', share: 'audio+transcript', transcribe: 'later' });
    await settle();
    expect(id).toBe(draftId);
    const files = platform.mem.list(classId);
    const { dir, lecture } = findLecture(files);
    expect(dir).toMatch(/^Aulas\/\d{4}-\d{2}-\d{2} \d{4} Aula 9 — Direitos fundamentais$/);
    const audio = files.get(`${dir}/audio.webm`)!.bytes;
    expect(writes.filter((w) => !w.includes('.tramado/'))).toEqual([`write ${dir}/audio.webm`, `write ${dir}/lecture.json`]);
    expect(lecture).toMatchObject({
      format: 'tramado.lecture', version: 1, id, title: 'Aula 9 — Direitos fundamentais', mode: 'room', language: 'pt-PT', durationMs: 90_000,
      recordedBy: me, channels: [{ index: 0, speaker: 'lecture' }],
      audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: audio.length, sha256: sha256Hex(audio) },
      consent: fakes.consent.map((c) => c.ref),
    });
    expect(lecture.pauses).toHaveLength(1);
    // G2: the recorder's UTC offset at startedAt (this computer's zone), for the local date of transcript.md.
    expect(lecture.utcOffsetMin).toBe(-new Date(START).getTimezoneOffset() || 0);
    expect(itemIdMatches(lecture.id, me.deviceId, lecture.idNonce)).toBe(true);
    expect(dec.decode(files.get(`${dir}/lecture.json`)!.bytes)).toMatch(/^\{\n {2}"format"/);   // a manifest is indented
    const markers = JSON.parse(dec.decode((await platform.privateFiles.read(classId, `markers/${id}.json`))!));
    expect(markers.markers).toEqual([expect.objectContaining({ kind: 'exam', atMs: 57_000, note: 'artigo 18' })]);
    expect(JSON.parse(dec.decode((await platform.privateFiles.read(classId, `lectures/${id}.json`))!)).noAutoClaim).toBe(true);
    expect(await platform.privateFiles.read(classId, `drafts/${id}.json`)).toBeNull();
    expect(recording.pending.get()).toEqual([]);
    expect(lectures.list.get().map((l) => [l.id, l.audio])).toEqual([[id, { present: true, arriving: false, skipped: false }]]);
    expect(fakes.claims.calls).toEqual([]);
  });

  it('keeps the audio on this computer for "transcript only"', async () => {
    const { speech, recording, classId, platform, settle, lectures } = await setup({ shared: true });
    await recording.start({ classId, title: 'Aula 10', mode: 'online', includeMic: true, inputDeviceId: null, language: 'pt-PT', consent: { record: consent('record'), share: { ...consent('share'), share: 'transcript-only' }, remember: false } });
    speech.tick(10_000);
    const rec = await recording.stop();
    expect(rec).toMatchObject({ channels: 2, bitrate: 32000, speakers: [{ index: 0, speaker: 'me' }, { index: 1, speaker: 'class' }] });
    const id = await recording.publish(rec, { title: 'Aula 10', share: 'transcript-only', transcribe: 'later' });
    await settle();
    const files = platform.mem.list(classId);
    const { dir, lecture } = findLecture(files);
    expect(files.has(`${dir}/audio.webm`)).toBe(false);
    expect(lecture.audio).toMatchObject({ shared: false, channels: 2, bitrate: 32000, size: speech.webm.length, sha256: sha256Hex(speech.webm) });
    expect(lecture.channels).toEqual([{ index: 0, speaker: 'me' }, { index: 1, speaker: 'class' }]);
    // The recorder still has the recording; everyone else sees "Recording only on Ana's computer".
    expect(lectures.list.get().find((l) => l.id === id)!.audio).toEqual({ present: true, arriving: false, skipped: false });
  });

  it('"Nothing yet" writes nothing to the class until a share mode is chosen later', async () => {
    const { speech, recording, classId, platform, settle, lectures, writes } = await setup({ shared: true });
    await recording.start({ classId, title: 'Aula 11', mode: 'room', includeMic: true, inputDeviceId: null, language: 'pt-PT', consent: { record: consent('record'), share: null, remember: false } });
    speech.tick(5_000);
    const rec = await recording.stop();
    writes.length = 0;
    const id = await recording.publish(rec, { title: 'Aula 11 — Revisões', share: 'none', transcribe: 'later' });
    await settle();
    expect(writes).toEqual([]);
    expect(recording.pending.get().map((r) => r.recordingId)).toEqual([id]);
    expect(lectures.list.get()).toEqual([]);
    await lectures.share(id, 'audio+transcript');
    await settle();
    const { lecture } = findLecture(platform.mem.list(classId));
    expect(lecture).toMatchObject({ id, title: 'Aula 11 — Revisões', audio: { shared: true } });
    expect(recording.pending.get()).toEqual([]);
    expect(lectures.list.get().map((l) => l.id)).toEqual([id]);
  });

  it('remembers consent for the class, and claims the transcription right away when asked to', async () => {
    const { speech, recording, classId, fakes, settle } = await setup({ shared: true });
    await recording.start({ classId, title: 'Aula 12', mode: 'room', includeMic: true, inputDeviceId: null, language: 'pt-PT', consent: { record: consent('record'), share: consent('share'), remember: true } });
    expect(fakes.consent.map((c) => [c.kind, c.scope, c.lectureId])).toEqual([['record', 'class', undefined], ['share', 'class', undefined]]);
    speech.tick(5_000);
    const rec = await recording.stop();
    const id = await recording.publish(rec, { title: 'Aula 12', share: 'audio+transcript', transcribe: 'here' });
    await settle();
    expect(fakes.claims.calls.map((c) => [c.lectureId, c.kind, c.input.engine])).toEqual([[id, 'transcribe', { kind: 'local', model: 'turbo' }]]);
  });

  it('cleans up when the recorder cannot start', async () => {
    const { speech, recording, classId, fakes, platform } = await setup();
    speech.failNext('recorder', 'SPEECH_NO_DEVICE');
    await expect(recording.start({ classId, title: 'Aula', mode: 'room', includeMic: true, inputDeviceId: null, language: 'pt-PT', consent: { record: consent('record'), share: null, remember: false } })).rejects.toMatchObject({ code: 'SPEECH_NO_DEVICE' });
    expect(recording.state.get()).toBeNull();
    expect(fakes.activities.at(-1)).toEqual({ recording: undefined });
    expect(await platform.privateFiles.list(classId, 'drafts')).toEqual([]);
  });

  it('imports an audio file as a lecture', async () => {
    const { speech, recording, classId, platform, settle, lectures } = await setup();
    platform.mem.queueDialog({ picks: [{ name: 'aula-zoom-14-out.m4a', bytes: new Uint8Array([1, 2, 3]) }] });
    const [pick] = await platform.dialogs.pickFiles({ title: 'Add a recording', filters: [], multiple: false });
    const done = recording.importAudio(classId, pick!, { title: 'Aula 5 — Wed 14 Oct', keepVideo: false, startedAt: '2026-10-14T09:00:00.000Z' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(recording.imports.get()).toMatchObject([{ classId, name: 'aula-zoom-14-out.m4a', title: 'Aula 5 — Wed 14 Oct', progress: 0 }]);
    speech.tick(1000);
    expect(recording.imports.get()[0]!.progress).toBe(0.5);
    speech.tick(1000);
    const id = await done;
    await settle();
    expect(recording.imports.get()).toEqual([]);
    const { lecture, dir } = findLecture(platform.mem.list(classId));
    expect(dir).toContain('Aula 5 — Wed 14 Oct');
    expect(lecture).toMatchObject({ id, mode: 'import', language: 'pt-PT', startedAt: '2026-10-14T09:00:00.000Z', import: { fileName: 'aula-zoom-14-out.m4a', mime: 'audio/mp4', hadVideo: false }, audio: { shared: true } });
    expect(lectures.list.get().map((l) => l.mode)).toEqual(['import']);
    // G2: an import also carries the offset at its startedAt (the file's date, in this computer's zone).
    expect(lecture.utcOffsetMin).toBe(-new Date('2026-10-14T09:00:00.000Z').getTimezoneOffset() || 0);
    // A file Rust cannot decode.
    speech.failNext('import', 'SPEECH_UNSUPPORTED_AUDIO');
    platform.mem.queueDialog({ picks: [{ name: 'aula.aac', bytes: new Uint8Array([1]) }] });
    const [bad] = await platform.dialogs.pickFiles({ title: 'Add', filters: [], multiple: false });
    await expect(recording.importAudio(classId, bad!, { title: 'x', keepVideo: false })).rejects.toMatchObject({ code: 'SPEECH_UNSUPPORTED_AUDIO' });
    expect(recording.imports.get()).toEqual([]);
  });

  it('recovers a recording still running in Rust after a reload, and lists interrupted ones', async () => {
    const speech = createFakeSpeech({ now: () => START, recording: true });
    const { recording, classId } = await setup({ speech });
    await recording.recover();
    expect(recording.state.get()).toMatchObject({ classId, status: { state: 'recording', ms: 2_472_000 } });
    speech.tick(1000);
    expect(recording.state.get()!.status.ms).toBe(2_473_000);
    const rec = await recording.stop();
    expect(recording.pending.get().map((r) => r.recordingId)).toEqual([rec.recordingId]);
    await recording.discard(rec.recordingId);
    expect(recording.pending.get()).toEqual([]);
  });

  it('runs the input meter outside a recording', async () => {
    const { speech, recording } = await setup();
    await recording.startMeter({ inputDeviceId: null, mode: 'room' });
    expect(recording.meter.get()!.mic!.peak).toBeGreaterThan(0);
    speech.tick(100);
    expect(recording.meter.get()!.system).toBeNull();
    await recording.stopMeter();
    expect(recording.meter.get()).toBeNull();
  });
});
