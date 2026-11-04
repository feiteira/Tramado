import { describe, expect, it } from 'vitest';
import { parseVtt } from '../import/vtt';
import { RE_SEGMENT_ID } from '../model/ids';
import { mulberry32 } from '../util/prng';
import { transcriptFromCues } from './fromCues';
import { renderVtt } from './render';

const ANA = { deviceId: 'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2', memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', name: 'Ana Ribeiro' };
const SHA = 'b'.repeat(64);
const lecture = {
  id: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', language: 'pt-PT' as const, recordedBy: ANA,
  audio: { file: 'audio.webm' as const, shared: true, codec: 'opus' as const, container: 'webm' as const, sampleRate: 16000 as const, channels: 1 as const, bitrate: 24000, size: 100, sha256: SHA },
};
const ctx = { lecture, writer: ANA, at: '2026-11-03T12:00:00.000Z', rand: mulberry32(3) };

describe('transcriptFromCues (UX §3.6.6, folder spec §8.8)', () => {
  it('turns subtitles into revision 1 of round 1, bound to the imported audio', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nBom dia a todos.\n\n00:00:04.000 --> 00:00:06.000\nHoje falamos de restrições.\n\nNOTE comentário\n\n00:00:10.000 --> 00:00:09.000\n   \n';
    const t = transcriptFromCues(parseVtt(vtt).cues, ctx)!;
    expect(t).toMatchObject({
      format: 'tramado.transcript', round: 1, revision: 1, audioSha256: SHA, language: 'pt-PT',
      engine: { kind: 'import', name: 'vtt' }, writer: { deviceId: ANA.deviceId, memberId: ANA.memberId }, speakers: [{ id: 'lecture', label: 'Professor' }],
    });
    expect(t.segments.map((s) => [s.startMs, s.endMs, s.speaker, s.text])).toEqual([[1000, 3500, 'lecture', 'Bom dia a todos.'], [4000, 6000, 'lecture', 'Hoje falamos de restrições.']]);
    expect(t.segments.every((s) => RE_SEGMENT_ID.test(s.id))).toBe(true);
    expect(renderVtt(t)).toContain('00:00:01.000 --> 00:00:03.500');
  });

  it('keeps the voices of the subtitles as speakers', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Marta Reis>Bom dia.</v>\n\n00:00:02.500 --> 00:00:03.000\n<v Bruno>Posso perguntar?</v>\n\n00:00:03.500 --> 00:00:05.000\n<v Marta Reis>Claro.</v>\n';
    const t = transcriptFromCues(parseVtt(vtt).cues, ctx)!;
    expect(t.speakers).toEqual([{ id: 'spk_1', label: 'Marta Reis' }, { id: 'spk_2', label: 'Bruno' }]);
    expect(t.segments.map((s) => s.speaker)).toEqual(['spk_1', 'spk_2', 'spk_1']);
  });

  it('has nothing to write for subtitles without text', () => {
    expect(transcriptFromCues([], ctx)).toBeNull();
    expect(transcriptFromCues([{ start: 0, end: 10, speaker: null, text: '  ' }], ctx)).toBeNull();
  });
});
