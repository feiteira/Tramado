import { describe, expect, it } from 'vitest';
import { dropEcho, spokenLanguage, transcriptFromSpeech } from './transcript';
import type { SpeechSegment, Transcription } from './types';
import { wavHeader, WAV_HEADER_BYTES } from './wav';

// What the engine made of a fictional two-track call (tools: flite voices), without headphones:
// the microphone track also heard the other side through the speakers.
const mic: SpeechSegment[] = [
  { start: 950, end: 5850, text: 'Thank you for joining me today. Could you tell me how you first got involved with the community garden?' },
  { start: 7380, end: 12540, text: 'Sure. I moved to the neighborhood three years ago, and a friend asked me to help with the tomatoes.' },
  { start: 13140, end: 15720, text: 'I did not know anything about gardening back then.' },
  { start: 17420, end: 19400, text: 'What made you stay after that first summer?' },
  { start: 21030, end: 27010, text: 'Mostly the people. We share meals on Sundays, and the older members teach the children how to plant seeds.' },
];
const system: SpeechSegment[] = [
  { start: 7690, end: 15700, text: 'I moved to the neighborhood three years ago, and a friend asked me to help with the tomatoes. I did not know anything about gardening back then,' },
  { start: 20910, end: 27070, text: 'mostly the people. We share meals on Sundays, and the older members teach the children how to plant seeds.' },
];
const call = (m: SpeechSegment[]): Transcription => ({
  tracks: [
    { segments: m, language: 'en' },
    { segments: system, language: 'en' },
  ],
  duration: 30_000,
  engine: 'test',
});

describe('a call recorded on two tracks', () => {
  it('drops what the microphone picked up from the speakers', () => {
    expect(dropEcho(mic, system).map((s) => s.start)).toEqual([950, 17420]);
  });

  it('keeps the researcher speaking over the other side', () => {
    const over = [{ start: 8000, end: 9000, text: 'Sorry, can you repeat where that was?' }];
    expect(dropEcho(over, system)).toEqual(over);
  });

  it('interleaves both sides into named turns with sync points', () => {
    const r = transcriptFromSpeech(call(mic), ['Ana', 'Participant']);
    expect(r.text.split('\n')).toEqual([
      'Ana: Thank you for joining me today. Could you tell me how you first got involved with the community garden?',
      'Participant: I moved to the neighborhood three years ago, and a friend asked me to help with the tomatoes. I did not know anything about gardening back then,',
      'Ana: What made you stay after that first summer?',
      'Participant: mostly the people. We share meals on Sundays, and the older members teach the children how to plant seeds.',
    ]);
    expect(r.sync.map((s) => s.ms)).toEqual([950, 7690, 17420, 20910]);
    expect(r.sync[1]!.pos).toBe(r.text.indexOf('Participant: I moved'));
    expect(r.speakers.map((s) => [s.name, s.spans.length])).toEqual([
      ['Ana', 2],
      ['Participant', 2],
    ]);
  });
});

describe('a recording on one track', () => {
  it('becomes paragraphs at the pauses, without speakers', () => {
    const r = transcriptFromSpeech(
      {
        tracks: [
          {
            segments: [
              { start: 0, end: 4000, text: 'First thought.' },
              { start: 4200, end: 8000, text: 'Still the first.' },
              { start: 12_000, end: 15_000, text: 'After a pause.' },
            ],
            language: 'pt',
          },
        ],
        duration: 15_000,
        engine: 'test',
      },
      [null],
    );
    expect(r.text).toBe('First thought. Still the first.\nAfter a pause.');
    expect(r.sync).toEqual([
      { pos: 0, ms: 0 },
      { pos: 15, ms: 4200 },
      { pos: 32, ms: 12_000 },
    ]);
    expect(r.speakers).toEqual([]);
  });

  it('tells the language most of it was heard in', () => {
    expect(spokenLanguage(call(mic))).toBe('en');
    expect(spokenLanguage({ tracks: [{ segments: [], language: null }], duration: 0, engine: '' })).toBeNull();
  });
});

describe('the WAV header', () => {
  it('describes 16-bit stereo at 16 kHz', () => {
    const h = wavHeader(64_000, 16_000, 2);
    const v = new DataView(h.buffer);
    expect(h.length).toBe(WAV_HEADER_BYTES);
    expect(String.fromCharCode(...h.subarray(0, 4), ...h.subarray(8, 12))).toBe('RIFFWAVE');
    expect(v.getUint32(4, true)).toBe(36 + 64_000);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(64_000);
    expect(v.getUint32(40, true)).toBe(64_000);
  });
});
