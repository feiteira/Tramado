import { describe, expect, it } from 'vitest';
import { itemIdOf } from '../../core/model/derive';
import type { LectureFile, TranscriptFile } from '../../core/model/files';
import { classIdOf } from '../../core/model/derive';
import { createMemoryPlatform } from './index';
import { createFakeSpeech, fakeSpeechHost, tinyWebm } from './speech';

const enc = new TextEncoder();
const dec = new TextDecoder();
const BRUNO = 'TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT';

describe('createFakeSpeech', () => {
  it('writes a WebM that starts with the EBML magic and names the Opus codec', () => {
    const w = tinyWebm();
    expect([...w.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(dec.decode(w)).toContain('webm');
    expect(dec.decode(w)).toContain('A_OPUS');
    expect(dec.decode(w)).toContain('OpusHead');
  });

  it('gives deterministic peaks in range', async () => {
    const s = createFakeSpeech();
    const a = await s.peaks({ kind: 'private', recordingId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K' }, 1200);
    expect(a).toHaveLength(1200);
    expect(a.every((x) => x >= 0 && x <= 255)).toBe(true);
    expect(await s.peaks({ kind: 'private', recordingId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K' }, 1200)).toEqual(a);
    await expect(s.peaks({ kind: 'private', recordingId: 'x' }, 10)).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('demo controls write a classmate’s claim and finished transcript as that device', async () => {
    const platform = createMemoryPlatform({ clock: { now: () => 1_793_721_438_157 } });
    const classId = classIdOf(platform.mem.deviceId, 'q4m2zx7k3v5hbnw6r2yjc7aefg');
    await platform.classes.create({ classId, dirName: 'DC I' });
    const nonce = 'h7c2pq5x3m4kzw6n2v7bjr4yta';
    const lectureId = itemIdOf(1_793_700_000_000, platform.mem.deviceId, nonce);
    const lecture: Partial<LectureFile> = {
      format: 'tramado.lecture', version: 1, id: lectureId, idNonce: nonce, title: 'Aula 8', startedAt: '2026-11-03T10:00:00.000Z', durationMs: 4_680_000, mode: 'room', language: 'pt-PT',
      recordedBy: { memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', deviceId: platform.mem.deviceId, name: 'Carla' }, audio: null, channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [],
    };
    await platform.fs.write(classId, 'Aulas/Aula 8/lecture.json', enc.encode(JSON.stringify(lecture)), { own: true });
    const s = createFakeSpeech({ now: () => 1_793_721_438_157 });
    s.bind(fakeSpeechHost(platform));
    const c = s.controls({ classes: { law: classId }, lectures: { l8: { classKey: 'law', lectureId } }, members: { bruno: { memberId: 'b6xq2l4p7vjk3m5n2c7hzr4wte', deviceIds: [BRUNO] } } });
    await c.claimTranscription('l8', 'bruno', 40);
    const files = platform.mem.list(classId);
    const claim = files.get(`.tramado/claims/${lectureId}/${BRUNO}.json`)!;
    expect(claim.modifiedBy).toBe('TKBNV23');
    expect(JSON.parse(dec.decode(claim.bytes))).toMatchObject({ status: 'working', progress: 0.4, deviceId: BRUNO, heartbeat: 1 });
    await c.finishTranscription('l8');
    const after = platform.mem.list(classId);
    const t = JSON.parse(dec.decode(after.get('Aulas/Aula 8/transcript.json')!.bytes)) as TranscriptFile;
    expect(t).toMatchObject({ lectureId, round: 1, revision: 1, writer: { deviceId: BRUNO }, transcribedBy: { name: 'Bruno' } });
    expect(after.get('Aulas/Aula 8/transcript.md')!.modifiedBy).toBe('TKBNV23');
    expect(JSON.parse(dec.decode(after.get(`.tramado/claims/${lectureId}/${BRUNO}.json`)!.bytes))).toMatchObject({ status: 'done', transcriptRevision: 1, heartbeat: 2 });
    await expect(c.claimTranscription('nope', 'bruno', 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a transcription whose audio does not match, and one without a model', async () => {
    const platform = createMemoryPlatform();
    const classId = classIdOf(platform.mem.deviceId, 'q4m2zx7k3v5hbnw6r2yjc7aefg');
    await platform.classes.create({ classId, dirName: 'DC I' });
    await platform.fs.write(classId, 'Aulas/x/audio.webm', new Uint8Array([1, 2]), { own: true });
    const s = createFakeSpeech({ model: 'missing' });
    s.bind(platform);
    const req = {
      jobId: 'j1', lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', source: { kind: 'class' as const, classId, path: 'Aulas/x/audio.webm' }, expectSha256: '0'.repeat(64),
      engine: { kind: 'cloud' as const, model: 'openai/whisper-large-v3-turbo' }, language: 'pt-PT', channels: 'mix' as const, initialPrompt: null, claim: null, resume: false,
    };
    await expect(s.transcribe.start(req, () => undefined)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(s.transcribe.start({ ...req, engine: { kind: 'local', model: 'turbo' } }, () => undefined)).rejects.toMatchObject({ code: 'MODEL_NOT_DOWNLOADED' });
  });
});
