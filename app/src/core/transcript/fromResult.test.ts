import { describe, expect, it } from 'vitest';
import { RE_SEGMENT_ID } from '../model/ids';
import type { LectureFile } from '../model/files';
import { mulberry32 } from '../util/prng';
import { fromResult, transcriptLanguage } from './fromResult';

const ANA = { deviceId: 'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2', memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', name: 'Ana Ribeiro' };
const SHA = 'a'.repeat(64);

const lecture = (over: Partial<LectureFile> = {}): Pick<LectureFile, 'id' | 'language' | 'channels' | 'audio' | 'recordedBy'> => ({
  id: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', language: 'pt-PT', channels: [{ index: 0, speaker: 'lecture' }],
  audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: 100, sha256: SHA },
  recordedBy: ANA, ...over,
});

const engine = { kind: 'local' as const, name: 'whisper.cpp', version: '1.8.3', model: 'ggml-large-v3-turbo-q5_0', vad: 'silero-v5.1.2' };

describe('fromResult (folder spec §8.8)', () => {
  it('builds revision 1 of the round, owned by the writer, bound to the audio', () => {
    const t = fromResult(
      {
        lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', durationMs: 30_000, language: 'pt', engine,
        tracks: [{ speaker: 'lecture', segments: [
          { startMs: 5000.4, endMs: 9000, text: '  O segundo   ponto. ' },
          { startMs: 0, endMs: 4000, text: 'Bom dia.', words: [{ startMs: 0, endMs: 600, text: ' Bom', p: 0.9 }, { startMs: 600, endMs: 1200, text: ' dia.', p: 1.4 }] },
          { startMs: 9500, endMs: 9600, text: '   ' },
        ] }],
      },
      { lecture: lecture(), round: 2, writer: ANA, at: '2026-11-03T12:00:00.000Z', rand: mulberry32(1), modelId: 'turbo' },
    );
    expect(t).toMatchObject({
      format: 'tramado.transcript', version: 1, lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', round: 2, revision: 1, audioSha256: SHA,
      language: 'pt-PT', writer: { deviceId: ANA.deviceId, memberId: ANA.memberId },
      transcribedBy: { ...ANA, at: '2026-11-03T12:00:00.000Z' },
      engine: { ...engine, modelId: 'turbo' }, speakers: [{ id: 'lecture', label: 'Professor' }], folded: {},
    });
    expect(t.segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([[0, 4000, 'Bom dia.'], [5000, 9000, 'O segundo ponto.']]);
    expect(t.segments[0]!.words).toEqual([{ startMs: 0, endMs: 600, text: 'Bom', p: 0.9 }, { startMs: 600, endMs: 1200, text: 'dia.', p: 1 }]);
    expect(t.segments.every((s) => RE_SEGMENT_ID.test(s.id))).toBe(true);
    expect(new Set(t.segments.map((s) => s.id)).size).toBe(2);
  });

  it('interleaves a split recording and drops the echo of the call on the microphone', () => {
    const t = fromResult(
      {
        lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', durationMs: 30_000, language: 'en', engine: { kind: 'cloud', name: 'openrouter', model: 'openai/whisper-large-v3-turbo' },
        tracks: [
          { speaker: 'me', segments: [
            { startMs: 900, endMs: 3000, text: 'Can you repeat the second condition?' },
            { startMs: 4100, endMs: 9000, text: 'The second condition is that the damage was caused by the act.' },   // heard through the speakers
          ] },
          { speaker: 'class', segments: [{ startMs: 4000, endMs: 9100, text: 'The second condition is that the damage was caused by the act.' }] },
        ],
      },
      { lecture: lecture({ language: 'auto', channels: [{ index: 0, speaker: 'me' }, { index: 1, speaker: 'class' }] }), round: 1, writer: ANA, at: '2026-11-03T12:00:00.000Z', rand: mulberry32(2), modelId: 'turbo' },
    );
    expect(t.segments.map((s) => [s.speaker, s.startMs])).toEqual([['me', 900], ['class', 4000]]);
    expect(t.speakers).toEqual([{ id: 'me', label: 'Ana Ribeiro' }, { id: 'class', label: 'Class' }]);
    expect(t.language).toBe('en');
    expect(t.engine).toEqual({ kind: 'cloud', name: 'openrouter', model: 'openai/whisper-large-v3-turbo' });   // no modelId for cloud
  });

  it('takes the lecture language when the engine heard the same one', () => {
    expect(transcriptLanguage('pt-PT', 'pt')).toBe('pt-PT');
    expect(transcriptLanguage('pt-PT', 'es')).toBe('es');
    expect(transcriptLanguage('auto', 'es')).toBe('es');
    expect(transcriptLanguage('auto', '')).toBe('en');
    expect(transcriptLanguage('es-ES', null)).toBe('es-ES');
  });
});
