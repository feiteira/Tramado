import { describe, expect, it } from 'vitest';
import { itemIdOf } from '../core/model/derive';
import type { LectureFile, Segment, TranscriptEditLine, TranscriptFile } from '../core/model/files';
import { shortIdOf, type ClassId, type DeviceId, type Ulid } from '../core/model/ids';
import { sha256Hex } from '../core/util/sha256';
import { sha1Hex } from '../core/transcript/sha1';
import { createFakeSpeech, type FakeSpeech } from '../platform/memory/speech';
import type { MemoryPlatform } from '../platform/memory';
import type { ClassStoreImpl } from './classStore';
import { createServices } from './index';
import { FOLD_DEBOUNCE_MS, type LectureServiceImpl } from './lectures';
import { claimView, installClassFakes } from './testing/fakeClaims';
import { createTestContext } from './testing/context';

const BRUNO: DeviceId = 'TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT';
const BRUNO_MEMBER = 'b6xq2l4p7vjk3m5n2c7hzr4wte';
const START = 1_793_700_000_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
let nonceN = 0;
const nonce = () => `aaaaaaaaaaaaaaaaaaaaaaa${'bcdefghijklmnopqrstuvwxyz'[nonceN++ % 25]}${'bcd'[Math.floor(nonceN / 25) % 3]}a`;

async function setup(opts: { speech?: FakeSpeech; shared?: boolean } = {}) {
  const t = await createTestContext({ name: 'Ana Ribeiro', ...(opts.speech ? { speech: opts.speech } : {}) });
  const { ctx, platform, clock } = t;
  opts.speech?.bind(platform);
  const services = createServices(ctx);
  const classId = await services.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share: false });
  if (opts.shared) {
    await platform.sync.shareClass(classId, 'Direito Constitucional I');
    await services.library.load();
  }
  const cs = services.forClass(classId);
  cs.store.setDirs({ lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' });
  const me = { deviceId: platform.mem.deviceId, memberId: ctx.identity.get()!.memberId, name: 'Ana Ribeiro' };
  const fakes = installClassFakes(cs, { me, now: () => clock.now() });
  const lectures = cs.lectures as LectureServiceImpl;
  const settle = async () => {
    await (cs.store as ClassStoreImpl).idle();
    await lectures.refresh();
    await lectures.idle();
    await (cs.store as ClassStoreImpl).idle();
    await lectures.refresh();
    await lectures.idle();
  };
  await settle();
  return { ...t, services, classId, cs, me, fakes, lectures, settle };
}

const seg = (id: string, startMs: number, endMs: number, text: string, speaker = 'lecture'): Segment => ({ id, startMs, endMs, speaker, text });

interface LectureSpec {
  by?: { deviceId: DeviceId; memberId: string; name: string };
  startMs?: number; durationMs?: number; title?: string; dir: string;
  audio?: 'present' | 'missing' | 'private' | null;
  transcript?: { segments: Segment[]; writer?: { deviceId: DeviceId; memberId: string; name: string }; round?: number } | null;
}

/** Writes a lecture as its recorder's device would (mine through fs.write, a classmate's as Syncthing would). */
async function addLecture(platform: MemoryPlatform, classId: ClassId, me: { deviceId: DeviceId; memberId: string; name: string }, spec: LectureSpec) {
  const by = spec.by ?? me;
  const startMs = spec.startMs ?? START;
  const n = nonce();
  const id = itemIdOf(startMs, by.deviceId, n);
  const audio = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const lecture: LectureFile = {
    format: 'tramado.lecture', version: 1, id, idNonce: n, title: spec.title ?? 'Aula 6 — Restrições', startedAt: new Date(startMs).toISOString(),
    durationMs: spec.durationMs ?? 5_400_000, mode: 'room', language: 'pt-PT', recordedBy: by,
    audio: spec.audio === null ? null : { file: 'audio.webm', shared: spec.audio !== 'private', codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: audio.length, sha256: sha256Hex(audio) },
    channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [], updatedAt: new Date(startMs + 5_400_000).toISOString(), ...({ futureField: 'kept' } as object),
  };
  const put = async (path: string, bytes: Uint8Array, writer: DeviceId) => {
    if (writer === me.deviceId) await platform.fs.write(classId, path, bytes, { own: true });
    else platform.mem.applyRemote(classId, path, bytes, { modifiedBy: shortIdOf(writer), mtimeMs: startMs });
  };
  await put(`${spec.dir}/lecture.json`, enc.encode(JSON.stringify(lecture, null, 2) + '\n'), by.deviceId);
  if (spec.audio === undefined || spec.audio === 'present') await put(`${spec.dir}/audio.webm`, audio, by.deviceId);
  let transcript: TranscriptFile | null = null;
  if (spec.transcript) {
    const w = spec.transcript.writer ?? by;
    transcript = {
      format: 'tramado.transcript', version: 1, lectureId: id, round: spec.transcript.round ?? 1, revision: 1, audioSha256: lecture.audio?.sha256 ?? null, language: 'pt-PT',
      writer: { deviceId: w.deviceId, memberId: w.memberId }, transcribedBy: { ...w, at: new Date(startMs + 6_000_000).toISOString() },
      engine: { kind: 'local', name: 'whisper.cpp', version: '1.8.3', model: 'ggml-large-v3-turbo-q5_0', modelId: 'turbo' },
      speakers: [{ id: 'lecture', label: 'Professor' }], segments: spec.transcript.segments, folded: {}, updatedAt: new Date(startMs + 6_000_000).toISOString(),
    };
    await put(`${spec.dir}/transcript.json`, enc.encode(JSON.stringify(transcript)), w.deviceId);
  }
  return { id, lecture, transcript };
}

const SEGMENTS = [
  seg('s_aaaaa', 0, 4000, 'Bom dia a todos.'),
  seg('s_bbbbb', 4500, 9000, 'Hoje vamos ver o artigo 18.º, n.º 3, da Constituição.'),
  seg('s_ccccc', 30_000, 34_000, 'Isto costuma sair no exame, tomem nota.'),
];

const bruno = { deviceId: BRUNO, memberId: BRUNO_MEMBER, name: 'Bruno Costa' };
let lineN = 0;
const line = (lectureId: Ulid, ms: number, node: string, op: Partial<TranscriptEditLine>): TranscriptEditLine => ({
  format: 'tramado.transcript-edit', version: 1, id: `01JC1000000000000000000${String(lineN++).padStart(3, '0')}`, hlc: `${String(ms).padStart(15, '0')}-00000-${node}`, ms,
  memberId: BRUNO_MEMBER, lectureId, round: 1, baseRevision: 1, op: 'set_text', ...op,
});
const jsonl = (lines: unknown[]) => enc.encode(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l)) + '\n').join(''));

describe('LectureService: list and detail', () => {
  it('lists a transcribed lecture with its radar marks and opens it with transcript, references, audio and peaks', async () => {
    const speech = createFakeSpeech({ now: () => START });
    const { platform, classId, me, lectures, settle, cs } = await setup({ speech });
    const { id } = await addLecture(platform, classId, me, { dir: 'Aulas/2026-11-03 1015 Aula 6', transcript: { segments: SEGMENTS } });
    await settle();
    const [view] = lectures.list.get();
    expect(view).toMatchObject({
      id, classId, title: 'Aula 6 — Restrições', mode: 'room', language: 'pt-PT', audio: { present: true, arriving: false, skipped: false },
      transcription: { kind: 'done', engine: 'local', model: 'large-v3-turbo', revision: 1, pendingEdits: 0, by: { deviceId: me.deviceId, self: true } },
      autoExamMarks: 1, duplicateOf: null, probableDuplicateOf: null, newerFormat: false, untrustedTranscript: false,
    });
    const detail = lectures.open(id);
    await settle();
    const d = detail.get()!;
    expect(d.transcript!.segments.map((s) => s.id)).toEqual(['s_aaaaa', 's_bbbbb', 's_ccccc']);
    expect(d.autoMarkers).toEqual([{ segmentId: 's_ccccc', atMs: 30_000 }]);
    expect(d.references).toEqual([{ segmentId: 's_bbbbb', start: 17, end: 35, article: '18.º', code: null, target: null }]);
    expect(d.audioUrl).toMatch(/^blob:/);
    expect(d.peaks).toHaveLength(1200);
    expect(d).toMatchObject({ canEdit: true, isOwner: true, markers: [], aiNotes: { summary: null, terms: null } });
    // Auto marks can be removed privately.
    await lectures.markers.removeAuto(id, 30_000);
    await settle();
    expect(lectures.list.get()[0]!.autoExamMarks).toBe(0);
    expect(JSON.parse(dec.decode((await platform.privateFiles.read(classId, `lectures/${id}.json`))!)).removedAutoMarks).toEqual([30_000]);
    void cs;
  });

  it('shows the transcription state: arriving audio, a classmate transcribing, stale, failed, transcript only elsewhere, deleted audio', async () => {
    const { platform, classId, me, lectures, settle, fakes } = await setup({ shared: true });
    const a = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/a', audio: 'missing', startMs: START });
    const b = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/b', startMs: START + 86_400_000 * 2 });
    const c = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/c', audio: 'private', startMs: START + 86_400_000 * 4 });
    const d = await addLecture(platform, classId, me, { dir: 'Aulas/d', audio: null, startMs: START + 86_400_000 * 6 });
    await settle();
    const state = (id: Ulid) => lectures.list.get().find((v) => v.id === id)!.transcription;
    expect(state(a.id)).toEqual({ kind: 'waitingAudio', have: 0, size: 8 });
    expect(state(b.id)).toEqual({ kind: 'none' });
    expect(state(c.id)).toEqual({ kind: 'unavailable', reason: 'transcriptOnlyElsewhere' });
    expect(lectures.list.get().find((v) => v.id === c.id)!.audio).toBeNull();
    expect(state(d.id)).toEqual({ kind: 'none' });
    fakes.claims.setOthers(b.id, 'transcribe', [claimView(BRUNO, { who: 'Bruno', progress: 0.4, etaMs: 1_500_000, sinceMs: 30_000 })]);
    await settle();
    expect(state(b.id)).toMatchObject({ kind: 'claimed', percent: 40, etaMin: 25, quietMin: 0, health: 'healthy', by: { deviceId: BRUNO, self: false } });
    fakes.claims.setOthers(b.id, 'transcribe', [claimView(BRUNO, { health: 'stale', sinceMs: 14 * 60_000 })]);
    await settle();
    expect(state(b.id)).toMatchObject({ kind: 'claimed', health: 'stale', quietMin: 14 });
    fakes.claims.setOthers(b.id, 'transcribe', [claimView(BRUNO, { status: 'done', progress: 1 })]);
    await settle();
    expect(state(b.id)).toMatchObject({ kind: 'arriving', by: { deviceId: BRUNO } });
    fakes.claims.setOthers(b.id, 'transcribe', [claimView(BRUNO, { status: 'failed' })]);
    await settle();
    expect(state(b.id)).toMatchObject({ kind: 'failed', code: 'IO_ERROR' });
    // The recorder deletes the audio "for everyone": the transcript stays possible no more.
    const e = await addLecture(platform, classId, me, { dir: 'Aulas/e', startMs: START + 86_400_000 * 8 });
    await settle();
    await lectures.deleteAudio(e.id);
    await settle();
    expect(state(e.id)).toEqual({ kind: 'unavailable', reason: 'audioDeleted' });
    expect(await platform.fs.stat(classId, 'Aulas/e/audio.webm')).toBeNull();
    const lec = JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/e/lecture.json')));
    expect(lec).toMatchObject({ audio: null, futureField: 'kept' });
    expect(typeof lec.audioDeletedAt).toBe('string');
  });

  it('hints a probable duplicate of a lecture that is being transcribed or done', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const main = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/main', startMs: START, transcript: { segments: SEGMENTS } });
    const backup = await addLecture(platform, classId, me, { dir: 'Aulas/backup', startMs: START + 60_000, durationMs: 5_000_000 });
    const other = await addLecture(platform, classId, me, { dir: 'Aulas/other', startMs: START + 86_400_000 });
    await settle();
    const v = (id: Ulid) => lectures.list.get().find((x) => x.id === id)!;
    expect(v(backup.id).probableDuplicateOf).toBe(main.id);
    expect(v(other.id).probableDuplicateOf).toBeNull();
    expect(v(main.id).probableDuplicateOf).toBeNull();
    // Only the recorder can mark it.
    await lectures.markDuplicate(backup.id, main.id);
    await settle();
    expect(v(backup.id).duplicateOf).toBe(main.id);
    await expect(lectures.markDuplicate(main.id, backup.id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(lectures.rename(main.id, 'Mine now')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await lectures.rename(backup.id, '  Aula 6   (cópia) ');
    await settle();
    expect(v(backup.id).title).toBe('Aula 6 (cópia)');
  });

  it('keeps private markers and counts them', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const { id } = await addLecture(platform, classId, me, { dir: 'Aulas/x' });
    await settle();
    await lectures.markers.add(id, { atMs: 1000, rawMs: 4000, kind: 'exam', note: 'artigo 18' });
    await lectures.markers.add(id, { atMs: 500, rawMs: 3500, kind: 'important' });
    await settle();
    expect(lectures.list.get()[0]!.myMarkers).toEqual({ important: 1, confused: 0, exam: 1, todo: 0, note: 0 });
    const d = lectures.open(id);
    await settle();
    expect(d.get()!.markers.map((m) => [m.kind, m.atMs, m.note ?? null])).toEqual([['important', 500, null], ['exam', 1000, 'artigo 18']]);
    await lectures.markers.remove(id, d.get()!.markers[0]!.id);
    await settle();
    expect(d.get()!.markers.map((m) => m.kind)).toEqual(['exam']);
    const file = JSON.parse(dec.decode((await platform.privateFiles.read(classId, `markers/${id}.json`))!));
    expect(file).toMatchObject({ format: 'tramado.markers', version: 1, lectureId: id, deviceId: me.deviceId });
    await expect(lectures.markers.add(id, { atMs: -1, rawMs: 0, kind: 'exam' })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('exports the transcript through a save pick and leaves no temporary file', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const { id } = await addLecture(platform, classId, me, { dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await settle();
    for (const format of ['md', 'vtt', 'txt'] as const) {
      platform.mem.queueDialog({ picks: [{ name: `aula.${format}`, bytes: new Uint8Array() }] });
      const pick = (await platform.dialogs.save({ title: 'Export', defaultName: `aula.${format}`, filters: [] }))!;
      await lectures.exportTranscript(id, format, pick);
    }
    expect([...platform.mem.list(classId).keys()].filter((p) => p.startsWith('.tramado/tmp/'))).toEqual([]);
  });
});

describe('LectureService: corrections (folder spec §8.9, in 0.1)', () => {
  it('readers apply edit lines written by newer apps and by classmates', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const { id } = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await settle();
    platform.mem.applyRemote(classId, `.tramado/edits/${id}/${BRUNO}.jsonl`, jsonl([
      line(id, START + 1, 'tkbnv23', { segment: 's_aaaaa', base: sha1Hex('Bom dia a todos.'), text: 'Bom dia, turma.' }),
      line(id, START + 2, 'tkbnv23', { op: 'label_speaker', speakerId: 'lecture', label: 'Prof.ª Marta Reis' }),
      { ...line(id, START + 3, 'tkbnv23', { segment: 's_bbbbb', text: 'From a newer app.' }), version: 2 },
      'not json',
      line(id, START + 4, 'tkbnv23', { op: 'split', segment: 's_bbbbb', atChar: 15, atMs: 6000, newId: 's_ddddd' }),
    ]), { modifiedBy: shortIdOf(BRUNO), mtimeMs: START + 10 });
    await settle();
    const d = lectures.open(id);
    await settle();
    const t = d.get()!.transcript!;
    expect(t.segments.map((s) => s.text)).toEqual(['Bom dia, turma.', 'Hoje vamos ver', 'o artigo 18.º, n.º 3, da Constituição.', 'Isto costuma sair no exame, tomem nota.']);
    expect(t.speakers).toEqual([{ id: 'lecture', label: 'Prof.ª Marta Reis' }]);
    expect(t.unfolded).toBe(3);
    expect(t.correctedBy).toEqual({ s_aaaaa: ['TKBNV23'], s_bbbbb: ['TKBNV23'], s_ddddd: ['TKBNV23'] });
    expect(lectures.list.get()[0]!.transcription).toMatchObject({ kind: 'done', pendingEdits: 3 });
    // The references follow the corrected text.
    expect(d.get()!.references).toEqual([{ segmentId: 's_ddddd', start: 2, end: 20, article: '18.º', code: null, target: null }]);
  });

  it('the owner folds corrections 5 minutes after the last one, then rewrites .md and .vtt', async () => {
    const { platform, classId, me, lectures, settle, clock } = await setup();
    const { id } = await addLecture(platform, classId, me, { dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await settle();
    await lectures.edit.setText(id, 's_aaaaa', '  Bom dia,   turma. ');
    const newId = await lectures.edit.split(id, 's_bbbbb', 15);
    await lectures.edit.labelSpeaker(id, 'lecture', 'Prof.ª Reis');
    await settle();
    const log = dec.decode(await platform.fs.read(classId, `.tramado/edits/${id}/${me.deviceId}.jsonl`)).trim().split('\n').map((l) => JSON.parse(l));
    expect(log.map((l) => l.op)).toEqual(['set_text', 'split', 'label_speaker']);
    expect(log[0]).toMatchObject({ format: 'tramado.transcript-edit', version: 1, lectureId: id, round: 1, baseRevision: 1, segment: 's_aaaaa', base: sha1Hex('Bom dia a todos.'), text: 'Bom dia, turma.', memberId: me.memberId });
    expect(log[1]).toMatchObject({ newId, atChar: 15, segment: 's_bbbbb' });
    expect(newId).toMatch(/^s_[0-9A-Za-z]{5,8}$/);
    const d = lectures.open(id);
    await settle();
    expect(d.get()!.transcript!.segments[0]!.text).toBe('Bom dia, turma.');
    // Not folded yet: transcript.json still has revision 1.
    clock.advance(FOLD_DEBOUNCE_MS - 1000);
    await settle();
    expect(JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))).revision).toBe(1);
    // A new edit restarts the wait.
    await lectures.edit.setSpeaker(id, 's_ccccc', 'spk_1');
    await settle();
    clock.advance(2000);
    await settle();
    expect(JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))).revision).toBe(1);
    clock.advance(FOLD_DEBOUNCE_MS);
    await settle();
    const folded = JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))) as TranscriptFile;
    expect(folded.revision).toBe(2);
    expect(folded.folded[me.deviceId]).toBe(log.length ? JSON.parse(dec.decode(await platform.fs.read(classId, `.tramado/edits/${id}/${me.deviceId}.jsonl`)).trim().split('\n').pop()!).hlc : '');
    expect(folded.segments.map((s) => s.id)).toEqual(['s_aaaaa', 's_bbbbb', newId, 's_ccccc']);
    expect(folded.speakers).toEqual([{ id: 'lecture', label: 'Prof.ª Reis' }, { id: 'spk_1', label: 'Orador 1' }]);
    const md = dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.md'));
    expect(md).toContain('(revision 2)');
    expect(md).toContain('**[00:00:00] Prof.ª Reis:** Bom dia, turma.');
    expect(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.vtt'))).toContain(`${newId}\n00:00:`);
    expect(d.get()!.transcript!.unfolded).toBe(0);
    expect(lectures.list.get()[0]!.transcription).toMatchObject({ kind: 'done', revision: 2, pendingEdits: 0 });
    // Nothing left: no further fold.
    clock.advance(FOLD_DEBOUNCE_MS * 2);
    await settle();
    expect(JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))).revision).toBe(2);
  });

  it('merges, flags two corrections that met, and keeps one', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const { id } = await addLecture(platform, classId, me, { dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await settle();
    // Bruno corrected the first line from the original text; I correct it from the original too, later.
    platform.mem.applyRemote(classId, `.tramado/edits/${id}/${BRUNO}.jsonl`, jsonl([
      line(id, START + 1, 'tkbnv23', { segment: 's_aaaaa', base: sha1Hex('Bom dia a todos.'), text: 'Bom dia, pessoal.' }),
    ]), { modifiedBy: shortIdOf(BRUNO), mtimeMs: START });
    await settle();
    const d = lectures.open(id);
    await settle();
    // My editor still showed the old text (a stale view): the line names the old text as its base.
    await platform.fs.append(classId, `.tramado/edits/${id}/${me.deviceId}.jsonl`, enc.encode(JSON.stringify({
      ...line(id, START + 2, me.deviceId.slice(0, 7).toLowerCase(), { segment: 's_aaaaa', base: sha1Hex('Bom dia a todos.'), text: 'Bom dia a todas.' }), memberId: me.memberId,
    }) + '\n'), { own: true });
    await settle();
    expect(d.get()!.transcript!.concurrent).toEqual(['s_aaaaa']);
    await lectures.edit.keep(id, 's_aaaaa');
    await settle();
    expect(d.get()!.transcript!.concurrent).toEqual([]);
    expect(d.get()!.transcript!.segments[0]!.text).toBe('Bom dia a todas.');
    await lectures.edit.merge(id, 's_aaaaa');
    await settle();
    expect(d.get()!.transcript!.segments.map((s) => s.id)).toEqual(['s_aaaaa', 's_ccccc']);
    expect(d.get()!.transcript!.segments[0]!.merged).toEqual(['s_bbbbb']);
    // Edits through a merged-away id land on the segment that absorbed it.
    await lectures.edit.setText(id, 's_bbbbb', 'Tudo junto.');
    await settle();
    expect(d.get()!.transcript!.segments[0]!.text).toBe('Tudo junto.');
    await expect(lectures.edit.merge(id, 's_ccccc')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(lectures.edit.split(id, 's_ccccc', 0)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(lectures.edit.setText(id, 's_zzzzz', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(lectures.edit.setSpeaker(id, 's_ccccc', 'Teacher')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(lectures.edit.labelSpeaker(id, 'lecture', '   ')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('a device that is not the owner never folds, unless it takes the transcript over after winning a fold claim', async () => {
    const { platform, classId, me, lectures, settle, clock } = await setup();
    const { id } = await addLecture(platform, classId, me, { by: bruno, dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await settle();
    await lectures.edit.setText(id, 's_ccccc', 'Isto sai no exame.');
    await settle();
    clock.advance(FOLD_DEBOUNCE_MS * 2);
    await settle();
    expect(JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))).revision).toBe(1);
    expect(await lectures.fold(id)).toBeNull();
    const d = lectures.open(id);
    await settle();
    expect(d.get()).toMatchObject({ canEdit: true, isOwner: false });
    expect(await lectures.fold(id, { takeOver: true })).toBe(2);
    await settle();
    const t = JSON.parse(dec.decode(await platform.fs.read(classId, 'Aulas/x/transcript.json'))) as TranscriptFile;
    expect(t).toMatchObject({ revision: 2, writer: { deviceId: me.deviceId, memberId: me.memberId }, transcribedBy: { deviceId: BRUNO } });
    expect(t.segments[2]!.text).toBe('Isto sai no exame.');
    expect(d.get()!.isOwner).toBe(true);
  });

  it('refuses corrections to a transcript of a newer format', async () => {
    const { platform, classId, me, lectures, settle } = await setup();
    const { id, transcript } = await addLecture(platform, classId, me, { dir: 'Aulas/x', transcript: { segments: SEGMENTS } });
    await platform.fs.write(classId, 'Aulas/x/transcript.json', enc.encode(JSON.stringify({ ...transcript, version: 2 })), { own: true });
    await settle();
    expect(lectures.list.get()[0]!.newerFormat).toBe(true);
    await expect(lectures.edit.setText(id, 's_aaaaa', 'x')).rejects.toMatchObject({ code: 'NEWER_FORMAT' });
    const d = lectures.open(id);
    await settle();
    expect(d.get()!.canEdit).toBe(false);
    expect(d.get()!.transcript!.newer).toBe(true);
  });
});
