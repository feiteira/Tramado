import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LectureFile, Segment, TranscriptFile } from '../model/files';
import { hms, paragraphs, recorderDate, renderMarkdown, renderText, renderVtt, utcOffsetMinAt, vttEscape, vttTime } from './render';
import { engineLabel, fileLang, recordedByLabel, speakerLabel } from './labels';

const fixture = (name: string) => readFileSync(new URL(`../../../test-fixtures/tramado/transcripts/${name}`, import.meta.url), 'utf8');
const load = (dir: string) => ({
  lecture: JSON.parse(fixture(`${dir}/lecture.json`)) as LectureFile,
  transcript: JSON.parse(fixture(`${dir}/transcript.json`)) as TranscriptFile,
  md: fixture(`${dir}/transcript.md`),
  vtt: fixture(`${dir}/transcript.vtt`),
});

describe('transcript.md and transcript.vtt are byte-exact (folder spec §8.8)', () => {
  for (const dir of ['aula7-pt', 'lecture3-en']) {
    it(`renders ${dir}`, () => {
      const f = load(dir);
      expect(renderMarkdown(f.transcript, f.lecture)).toBe(f.md);
      expect(renderVtt(f.transcript)).toBe(f.vtt);
    });
  }

  it('does not depend on the order segments are stored in', () => {
    const f = load('aula7-pt');
    const shuffled = { ...f.transcript, segments: [...f.transcript.segments].reverse() };
    expect(renderMarkdown(shuffled, f.lecture)).toBe(f.md);
    expect(renderVtt(shuffled)).toBe(f.vtt);
  });

  it('writes labels in Spanish for a Spanish transcript, English otherwise', () => {
    const f = load('lecture3-en');
    const es = { ...f.transcript, language: 'es-ES', speakers: [{ id: 'lecture', label: 'Profesor' }] };
    expect(renderMarkdown(es, f.lecture)).toContain('· grabado por Sam Okafor ·');
    expect(renderMarkdown({ ...f.transcript, language: 'de' }, f.lecture)).toContain('· recorded by Sam Okafor ·');
    expect(renderMarkdown({ ...f.transcript, language: 'pt-BR' }, f.lecture)).toContain('· gravado por Sam Okafor ·');
  });

  it('keeps a cue on one line and escapes what WebVTT would misread', () => {
    expect(vttEscape('a --> b <i> & c')).toBe('a --&gt; b &lt;i&gt; &amp; c');
    const t = { segments: [{ id: 's_x1234', startMs: 0, endMs: 1000, speaker: 'lecture', text: 'one\ntwo' }], speakers: [{ id: 'lecture', label: 'Lecturer' }], language: 'en' };
    expect(renderVtt(t)).toBe('WEBVTT\n\ns_x1234\n00:00:00.000 --> 00:00:01.000\n<v Lecturer>one two\n');
    expect(renderVtt({ ...t, segments: [] })).toBe('WEBVTT\n');
  });

  it('dates transcript.md with the recorder\'s local date (utcOffsetMin), UTC when absent (G2)', () => {
    const f = load('aula7-pt');
    // 23:30 UTC on 2 Nov is already 3 Nov in Lisbon summer time (+60) and still 2 Nov in New York (−300).
    const late = { ...f.lecture, startedAt: '2026-11-02T23:30:00.000Z' };
    expect(renderMarkdown(f.transcript, late).split('\n')[3]).toMatch(/^\*2026-11-02 · /);
    expect(renderMarkdown(f.transcript, { ...late, utcOffsetMin: 60 }).split('\n')[3]).toMatch(/^\*2026-11-03 · /);
    expect(renderMarkdown(f.transcript, { ...late, utcOffsetMin: -300 }).split('\n')[3]).toMatch(/^\*2026-11-02 · /);
    expect(recorderDate({ startedAt: '2026-11-03T00:10:00.000Z', utcOffsetMin: -60 })).toBe('2026-11-02');
    expect(recorderDate({ startedAt: '2026-11-03T00:10:00.000Z', utcOffsetMin: 0 })).toBe('2026-11-03');
    // Out of range or not an integer: treated as absent.
    expect(recorderDate({ startedAt: '2026-11-02T23:30:00.000Z', utcOffsetMin: 15 * 60 })).toBe('2026-11-02');
    expect(recorderDate({ startedAt: '2026-11-02T23:30:00.000Z', utcOffsetMin: 60.5 })).toBe('2026-11-02');
    // The fixture (no offset) is unchanged.
    expect(renderMarkdown(f.transcript, f.lecture)).toBe(f.md);
  });

  it('measures a zone\'s UTC offset at an instant', () => {
    expect(utcOffsetMinAt(Date.parse('2026-07-01T12:00:00Z'), 'Europe/Lisbon')).toBe(60);
    expect(utcOffsetMinAt(Date.parse('2026-11-03T12:00:00Z'), 'Europe/Lisbon')).toBe(0);
    expect(utcOffsetMinAt(Date.parse('2026-11-03T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(utcOffsetMinAt(Date.parse('2026-11-03T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(utcOffsetMinAt(Date.parse('2026-11-03T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('formats times', () => {
    expect(hms(12_340)).toBe('00:00:12');
    expect(hms(3_725_999)).toBe('01:02:05');
    expect(vttTime(12_340)).toBe('00:00:12.340');
    expect(vttTime(86_399_999)).toBe('23:59:59.999');
  });

  it('exports plain text by paragraph', () => {
    const f = load('lecture3-en');
    expect(renderText(f.transcript, 'Lecture 3')).toBe('Lecture 3\n\n[00:00:00] Lecturer: Welcome back.\n\n[01:02:05] Lecturer: This will come up on the exam.\n');
  });
});

describe('paragraphs (same speaker, gap < 2 s, at most 60 s)', () => {
  const seg = (id: string, startMs: number, endMs: number, speaker = 'lecture'): Segment => ({ id, startMs, endMs, speaker, text: id });

  it('breaks at a 2 s gap, at a speaker change and past 60 s', () => {
    const p = paragraphs({
      segments: [
        seg('a', 0, 10_000), seg('b', 11_999, 20_000),        // gap 1.999 s: joins
        seg('c', 22_000, 30_000),                            // gap 2 s: new
        seg('d', 30_500, 40_000, 'me'),                      // speaker change
        seg('e', 40_100, 90_000, 'me'),                      // 59.5 s from d: joins
        seg('f', 90_100, 91_000, 'me'),                      // would make 60.5 s: new
        seg('g', 91_100, 200_000, 'me'),                     // longer than 60 s on its own: new
      ],
    });
    expect(p.map((x) => x.segments.map((s) => s.id).join(''))).toEqual(['ab', 'c', 'de', 'f', 'g']);
  });
});

describe('labels written into files', () => {
  it('follow the transcript language', () => {
    expect(fileLang('pt-PT')).toBe('pt');
    expect(fileLang('es')).toBe('es');
    expect(fileLang('fr')).toBe('en');
    expect(fileLang('auto')).toBe('en');
    expect(speakerLabel('lecture', 'pt-PT')).toBe('Professor');
    expect(speakerLabel('class', 'es-ES')).toBe('Clase');
    expect(speakerLabel('me', 'en', 'Ana Ribeiro')).toBe('Ana Ribeiro');
    expect(speakerLabel('me', 'pt', null)).toBe('Eu');
    expect(speakerLabel('spk_2', 'en')).toBe('Speaker 2');
    expect(recordedByLabel('es')).toBe('grabado por');
  });

  it('name the engine as people read it', () => {
    expect(engineLabel({ kind: 'local', name: 'whisper.cpp', model: 'ggml-small-q5_1' })).toBe('whisper.cpp small');
    expect(engineLabel({ kind: 'local', name: 'whisper.cpp', model: 'ggml-large-v3-q5_0' })).toBe('whisper.cpp large-v3');
    expect(engineLabel({ kind: 'cloud', name: 'openrouter', model: 'openai/whisper-large-v3-turbo' })).toBe('openrouter whisper-large-v3-turbo');
    expect(engineLabel({ kind: 'import', name: 'vtt' })).toBe('vtt');
  });
});
