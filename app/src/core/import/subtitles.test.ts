import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt';
import { decodeText } from './text';
import { cuesToTranscript } from './transcript';
import { cuePayload, parseCueTime, parseVtt } from './vtt';

const fixture = (name: string) => decodeText(new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url))));

describe('parseVtt', () => {
  it('reads voices, entities, header blocks, NOTE/STYLE and cues without identifiers', () => {
    const { cues, warnings } = parseVtt(fixture('interview.vtt'));
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { start: 1000, end: 4500, speaker: 'Entrevistadora', text: 'Bom dia. Pode apresentar-se?' },
      { start: 5000, end: 8000, speaker: 'Rui Lopes', text: 'Claro. Chamo-me Rui' },
      { start: 8000, end: 10_250, speaker: 'Rui Lopes', text: 'e trabalho numa escola & numa associação.' },
      { start: 62_500, end: 65_000, speaker: 'Entrevistadora', text: 'Obrigada!' },
    ]);
    const t = cuesToTranscript(cues);
    expect(t.text).toBe('Entrevistadora: Bom dia. Pode apresentar-se?\nRui Lopes: Claro. Chamo-me Rui e trabalho numa escola & numa associação.\nEntrevistadora: Obrigada!');
    expect(t.speakers.map((s) => [s.name, s.spans])).toEqual([
      ['Entrevistadora', [{ start: 16, end: 44 }, { start: 134, end: 143 }]],
      ['Rui Lopes', [{ start: 56, end: 117 }]],
    ]);
  });

  it('reads a Teams export (identifiers with slashes)', () => {
    expect(parseVtt(fixture('teams.vtt')).cues.map((c) => [c.start, c.speaker, c.text])).toEqual([
      [520, 'Marta Gil', 'Olá a todos, vamos começar.'],
      [3900, 'Tomás Reis', 'Perfeito.'],
    ]);
  });

  it('splits a cue with several voices and strips other markup', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:04.000\n<v Ana>Olá <i>Rui</i>!</v>\n<v Rui><c.yellow>Olá</c> <00:02.500>Ana &lt;3&gt;</v>\nainda o Rui\n';
    expect(parseVtt(vtt).cues).toEqual([
      { start: 1000, end: 4000, speaker: 'Ana', text: 'Olá Rui!' },
      { start: 1000, end: 4000, speaker: 'Rui', text: 'Olá Ana <3>\nainda o Rui' },
    ]);
  });

  it('reads Zoom-style "Name: text" prefixes', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nAna Sousa: Olá.\n\n2\n00:00:02.000 --> 00:00:03.000\nRui: Olá, Ana.\n\n3\n00:00:03.000 --> 00:00:04.000\nAna Sousa: Vamos.\n\n4\n00:00:04.000 --> 00:00:05.000\nRui: Sim.\n';
    expect(parseVtt(vtt).cues.map((c) => c.speaker)).toEqual(['Ana Sousa', 'Rui', 'Ana Sousa', 'Rui']);
  });

  it('skips cues with broken timing and counts them', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nbom\n\n00:00:xx.000 --> 00:00:03.000\nmau\n\nsó texto\nsem tempo\n\n00:00:61.000 --> 00:01:02.000\nsegundos impossíveis\n';
    const r = parseVtt(vtt);
    expect(r.cues.map((c) => c.text)).toEqual(['bom']);
    expect(r.warnings).toEqual(['transcript.cuesSkipped:3']);
  });

  it('tolerates CRLF, a BOM, a missing header and empty input', () => {
    expect(parseVtt('\u{feff}WEBVTT\r\n\r\n00:00.500 --> 00:01.000\r\nolá\r\n').cues).toEqual([{ start: 500, end: 1000, speaker: null, text: 'olá' }]);
    expect(parseVtt('00:00.500 --> 00:01.000\nsem cabeçalho').cues).toHaveLength(1);
    expect(parseVtt('')).toEqual({ cues: [], warnings: [] });
    expect(parseVtt('WEBVTT\n')).toEqual({ cues: [], warnings: [] });
  });
});

describe('parseCueTime', () => {
  it('reads hours optional, dot or comma', () => {
    expect(parseCueTime('01:02:03.004')).toBe(3_723_004);
    expect(parseCueTime('02:03.4')).toBe(123_400);
    expect(parseCueTime('00:00:01,5')).toBe(1500);
    expect(parseCueTime('100:00:00.000')).toBe(360_000_000);
    expect(parseCueTime('00:60.000')).toBeNull();
  });
});

describe('cuePayload', () => {
  it('drops empty pieces and direction marks', () => {
    expect(cuePayload(['<v Ana></v>', '\u{200e}olá'])).toEqual([{ speaker: 'Ana', text: 'olá' }]);
  });
});

describe('parseSrt', () => {
  it('reads a Zoom export with prefixes, a BOM, CRLF and italics', () => {
    const { cues } = parseSrt(fixture('zoom.srt'));
    expect(cues).toEqual([
      { start: 0, end: 2000, speaker: 'Carmen Ruiz', text: 'Hola, ¿me oye bien?' },
      { start: 2500, end: 4000, speaker: 'Carmen Ruiz', text: 'Perfecto.' },
      { start: 4100, end: 7900, speaker: 'Javier Ortega', text: 'Sí, la oigo. Empezamos cuando quiera.' },
    ]);
  });

  it('reads plain subtitles and removes ASS override tags', () => {
    const { cues } = parseSrt(fixture('subtitles.srt'));
    expect(cues.map((c) => [c.start, c.speaker, c.text])).toEqual([
      [1000, null, 'Era uma vez'],
      [2100, null, 'uma aldeia junto ao mar.'],
      [9000, null, 'Muito tempo depois...'],
    ]);
    expect(cuesToTranscript(cues).text).toBe('Era uma vez uma aldeia junto ao mar.\nMuito tempo depois...');
  });

  it('copes with missing blank lines, missing indices, dots and short fields', () => {
    const srt = '1\n0:00:01.5 --> 0:00:02,000\n<font color="red">um</font>\n2\n00:00:03,000 --> 00:00:04,000\ndois\n00:00:05,000 --> 00:00:06,000\ntrês\nainda três\n';
    expect(parseSrt(srt).cues.map((c) => [c.start, c.text])).toEqual([
      [1500, 'um'],
      [3000, 'dois'],
      [5000, 'três\nainda três'],
    ]);
  });

  it('counts text blocks without timing', () => {
    const r = parseSrt('1\nsem tempo\n\n2\n00:00:01,000 --> 00:00:02,000\ncom tempo\n');
    expect(r.cues.map((c) => c.text)).toEqual(['com tempo']);
    expect(r.warnings).toEqual(['transcript.cuesSkipped:1']);
  });

  it('handles empty input and a large file quickly', () => {
    expect(parseSrt('')).toEqual({ cues: [], warnings: [] });
    const blocks: string[] = [];
    const t = (ms: number) => `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
    for (let i = 0; i < 30_000; i++) blocks.push(`${i + 1}\n${t(i * 2000)} --> ${t(i * 2000 + 1500)}\n${i % 2 ? 'Rui' : 'Ana'}: frase ${i} com acentuação.\n`);
    const t0 = performance.now();
    const { cues } = parseSrt(blocks.join('\n'));
    const tr = cuesToTranscript(cues);
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(cues).toHaveLength(30_000);
    expect(tr.speakers.map((s) => s.spans.length)).toEqual([15_000, 15_000]);
  });
});
