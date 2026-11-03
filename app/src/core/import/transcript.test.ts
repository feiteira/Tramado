import { describe, expect, it } from 'vitest';
import { canonicalize } from './text';
import { type Cue, type TranscriptResult, cleanSpeakerName, cuesToTranscript, looksLikeTranscript, parseTextTranscript, parseTimestamp, refineCueSpeakers } from './transcript';

/** Offsets must describe the final text exactly. */
function checkTranscript(r: TranscriptResult): void {
  expect(canonicalize(r.text)).toBe(r.text);
  let last = -1;
  for (const s of r.sync) {
    expect(s.pos).toBeGreaterThanOrEqual(last);
    expect(s.pos).toBeLessThanOrEqual(r.text.length);
    expect(Number.isInteger(s.ms) && s.ms >= 0).toBe(true);
    last = s.pos;
  }
  for (const sp of r.speakers) {
    for (const span of sp.spans) {
      expect(span.start).toBeLessThan(span.end);
      expect(span.end).toBeLessThanOrEqual(r.text.length);
      expect(r.text.slice(span.start - sp.name.length - 2, span.start)).toBe(`${sp.name}: `);
      expect(r.text.slice(span.start, span.end)).not.toContain('\n');
      expect(r.text[span.end] === undefined || r.text[span.end] === '\n').toBe(true);
    }
  }
}

const turns = (r: TranscriptResult | null) => r?.text.split('\n');
const msAt = (r: TranscriptResult, line: number) => {
  const pos = r.text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  return r.sync.find((s) => s.pos === pos)?.ms ?? null;
};

describe('parseTimestamp', () => {
  it('reads the common layouts', () => {
    expect(parseTimestamp('0:01')).toBe(1000);
    expect(parseTimestamp('12:34')).toBe(754_000);
    expect(parseTimestamp('75:12')).toBe(4_512_000); // Otter past the hour can write minutes
    expect(parseTimestamp('1:02:03')).toBe(3_723_000);
    expect(parseTimestamp('01:02:03.5')).toBe(3_723_500);
    expect(parseTimestamp('00:00:01,250')).toBe(1250);
    expect(parseTimestamp('[00:01:23]')).toBe(83_000);
    expect(parseTimestamp('(00:01:23)')).toBe(83_000);
    expect(parseTimestamp('00:01:23:12')).toBe(83_000); // frames dropped
  });

  it('rejects impossible values', () => {
    for (const s of ['', '1', '1:2', '00:60', '1:60:00', 'ab:cd', '12:34:56:78:90', '1.000']) expect(parseTimestamp(s)).toBeNull();
  });
});

describe('cleanSpeakerName', () => {
  it('trims, collapses spaces, removes bold and a trailing colon', () => {
    expect(cleanSpeakerName('  Ana   Sousa : ')).toBe('Ana Sousa');
    expect(cleanSpeakerName('**Entrevistador**')).toBe('Entrevistador');
    expect(cleanSpeakerName('Jose\u{301}')).toBe('José');
  });
});

describe('parseTextTranscript', () => {
  it('reads "[00:01:23] Name: text" with continuation lines and case variants', () => {
    const r = parseTextTranscript('Entrevista 7\n[00:00:05] Entrevistador: Como começou?\n[00:00:09] Inês: Em 2019.\nAinda me lembro.\n[00:01:30] Entrevistador: E hoje?\n[00:01:32] INÊS: Somos trinta.')!;
    expect(turns(r)).toEqual(['Entrevista 7', 'Entrevistador: Como começou?', 'Inês: Em 2019. Ainda me lembro.', 'Entrevistador: E hoje?', 'Inês: Somos trinta.']);
    expect(r.sync).toEqual([
      { pos: 13, ms: 5000 },
      { pos: 42, ms: 9000 },
      { pos: 74, ms: 90_000 },
      { pos: 97, ms: 92_000 },
    ]);
    expect(r.speakers.map((s) => [s.name, s.spans.length])).toEqual([
      ['Entrevistador', 2],
      ['Inês', 2],
    ]);
    checkTranscript(r);
  });

  it('reads "00:01:23 Name: text"', () => {
    const r = parseTextTranscript('00:00:01 Ana: Olá.\n00:00:04 - Rui: Bom dia.\n00:00:09 Ana: Vamos?')!;
    expect(turns(r)).toEqual(['Ana: Olá.', 'Rui: Bom dia.', 'Ana: Vamos?']);
    expect(msAt(r, 1)).toBe(4000);
    checkTranscript(r);
  });

  it('reads "Name (00:01:23): text" and "Name [00:01:23] text"', () => {
    const r = parseTextTranscript('Carmen (00:00:02): ¿Empezamos?\nJavier [00:00:05] Sí.\nCarmen (00:01:10): Bien.')!;
    expect(turns(r)).toEqual(['Carmen: ¿Empezamos?', 'Javier: Sí.', 'Carmen: Bien.']);
    expect(msAt(r, 2)).toBe(70_000);
    checkTranscript(r);
  });

  it('reads Otter/Teams headers ("Name  0:01" then the text)', () => {
    const r = parseTextTranscript('Reunião de equipa\nSpeaker 1  0:01\nOlá a todos.\nHoje falamos do plano.\nMarta Gil   1:02:15\nCombinado.\nSpeaker 1  1:02:20\nObrigado.')!;
    expect(turns(r)).toEqual(['Reunião de equipa', 'Speaker 1: Olá a todos. Hoje falamos do plano.', 'Marta Gil: Combinado.', 'Speaker 1: Obrigado.']);
    expect(msAt(r, 2)).toBe(3_735_000);
    checkTranscript(r);
  });

  it('reads "00:00:03 Name" headers and timestamps on their own line', () => {
    const r = parseTextTranscript('00:00:03 Ana Sousa\nPrimeira fala.\n00:00:09 Rui Lopes\nSegunda fala.\n00:00:20 Ana Sousa\nTerceira.')!;
    expect(turns(r)).toEqual(['Ana Sousa: Primeira fala.', 'Rui Lopes: Segunda fala.', 'Ana Sousa: Terceira.']);
    const s = parseTextTranscript('[00:00:01]\nAna: Olá.\n[00:00:05]\nRui: Olá, Ana.\n[00:00:09]\nAna: Tudo bem?\n[00:00:12]\nRui: Sim.', { force: true })!;
    expect(turns(s)).toEqual(['Ana: Olá.', 'Rui: Olá, Ana.', 'Ana: Tudo bem?', 'Rui: Sim.']);
    expect(s.sync.map((x) => x.ms)).toEqual([1000, 5000, 9000, 12_000]);
    checkTranscript(s);
  });

  it('reads speaker labels without timestamps (Interviewer:, I:, R:, P1:, bold)', () => {
    const text = 'Entrevista com P1\nData: 3 de março\n\nI: Pode descrever o seu dia?\nP1: Acordo cedo.\nDepois vou trabalhar.\nI: E à noite?\n**P1:** Descanso.\nCriança: Mãe!\nP1: Desculpe.';
    const r = parseTextTranscript(text)!;
    expect(turns(r)).toEqual([
      'Entrevista com P1',
      'Data: 3 de março',
      'I: Pode descrever o seu dia?',
      'P1: Acordo cedo. Depois vou trabalhar.',
      'I: E à noite?',
      'P1: Descanso.',
      'Criança: Mãe!',
      'P1: Desculpe.',
    ]);
    expect(r.sync).toEqual([]);
    expect(r.speakers.map((s) => s.name)).toEqual(['I', 'P1', 'Criança']);
    checkTranscript(r);
  });

  it('leaves field notes and ordinary prose alone', () => {
    const notes = 'Data: 12/03/2024\nLocal: Escola Básica\nNotas: chegámos às 10:30.\nA turma estava agitada.\nObservação: ninguém faltou.';
    expect(parseTextTranscript(notes)).toBeNull();
    expect(looksLikeTranscript('Ela disse: vamos embora.\nE fomos.\nNo fim: silêncio.')).toBe(false);
    expect(looksLikeTranscript('Reunião às 14:30 com a equipa.\nAgenda: orçamento.')).toBe(false);
    expect(parseTextTranscript('')).toBeNull();
  });

  it('parses anyway when forced, keeping plain lines', () => {
    const r = parseTextTranscript('Uma só linha sem falantes.', { force: true })!;
    expect(r).toEqual({ text: 'Uma só linha sem falantes.', sync: [], speakers: [] });
    expect(parseTextTranscript('Ana: olá', { force: true })!.text).toBe('Ana: olá');
  });

  it('merges case variants and applies renames', () => {
    const text = 'ENTREVISTADORA: a\nRui: b\nEntrevistadora: c\nrui: d\nEntrevistadora: e';
    const merged = parseTextTranscript(text)!;
    expect(merged.speakers.map((s) => s.name)).toEqual(['Entrevistadora', 'Rui']);
    expect(turns(merged)![0]).toBe('Entrevistadora: a');
    const separate = parseTextTranscript(text, { speakers: { mergeCase: false } })!;
    expect(separate.speakers.map((s) => s.name).sort()).toEqual(['ENTREVISTADORA', 'Entrevistadora', 'Rui', 'rui']);
    const renamed = parseTextTranscript(text, { speakers: { rename: { rui: 'Rui Lopes', ENTREVISTADORA: 'Marta' } } })!;
    expect(turns(renamed)).toEqual(['Marta: a', 'Rui Lopes: b', 'Marta: c', 'Rui Lopes: d', 'Marta: e']);
    checkTranscript(renamed);
  });

  it('keeps emoji and accents in names and offsets', () => {
    const r = parseTextTranscript('[00:00:01] Zoë: 😀 sim\n[00:00:02] João: não 🎉\n[00:00:03] Zoë: ok')!;
    expect(turns(r)).toEqual(['Zoë: 😀 sim', 'João: não 🎉', 'Zoë: ok']);
    checkTranscript(r);
  });

  it('handles a long transcript quickly', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i++) lines.push(`[${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}] ${i % 2 ? 'Rui' : 'Ana'}: Frase número ${i} com algum texto à volta.`);
    const t0 = performance.now();
    const r = parseTextTranscript(lines.join('\n'))!;
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(r.sync).toHaveLength(20_000);
    expect(r.speakers.map((s) => s.spans.length)).toEqual([10_000, 10_000]);
  });
});

const cue = (start: number, text: string, speaker: string | null = null, end = start + 1000): Cue => ({ start, end, speaker, text });

describe('cuesToTranscript', () => {
  it('merges consecutive cues of a speaker, with a sync point per turn and per cue', () => {
    const r = cuesToTranscript([cue(0, 'Olá.', 'Ana'), cue(1500, 'Tudo bem?', 'Ana'), cue(3000, 'Sim.', 'Rui'), cue(5000, 'Ótimo.', 'ana')]);
    expect(turns(r)).toEqual(['Ana: Olá. Tudo bem?', 'Rui: Sim.', 'Ana: Ótimo.']);
    expect(r.sync).toEqual([
      { pos: 0, ms: 0 },
      { pos: 10, ms: 1500 },
      { pos: 20, ms: 3000 },
      { pos: 30, ms: 5000 },
    ]);
    checkTranscript(r);
    expect(cuesToTranscript([cue(0, 'a', 'Ana'), cue(900, 'b', 'Ana')], { syncEveryCue: false }).sync).toEqual([{ pos: 0, ms: 0 }]);
  });

  it('groups cues without speakers by pauses', () => {
    const r = cuesToTranscript([cue(0, 'Era uma vez', null, 1000), cue(1100, 'uma aldeia.', null, 2000), cue(9000, 'Depois…', null, 9500)]);
    expect(turns(r)).toEqual(['Era uma vez uma aldeia.', 'Depois…']);
    expect(r.speakers).toEqual([]);
    checkTranscript(r);
  });

  it('drops repeated roll-up captions', () => {
    const r = cuesToTranscript([cue(0, 'bom dia'), cue(500, 'bom dia'), cue(900, 'bom dia\na todos'), cue(1500, 'a todos\nvamos começar'), cue(1900, 'vamos começar já')]);
    expect(r.text).toBe('bom dia a todos vamos começar já');
  });

  it('joins multi-line cues and ignores empty ones', () => {
    const r = cuesToTranscript([cue(0, 'linha um\nlinha dois', 'Ana'), cue(1000, '   ', 'Rui'), cue(2000, 'fim', 'Ana')]);
    expect(turns(r)).toEqual(['Ana: linha um linha dois fim']);
  });

  it('returns an empty transcript for no cues', () => {
    expect(cuesToTranscript([])).toEqual({ text: '', sync: [], speakers: [] });
  });
});

describe('refineCueSpeakers', () => {
  it('reads "Name: text" prefixes when enough cues use them, continuing unlabelled cues', () => {
    const cues = refineCueSpeakers([cue(0, 'Ana: Olá.'), cue(1, 'Rui: Olá.'), cue(2, 'continua o Rui'), cue(3, 'Ana: Certo.'), cue(4, 'Rui: Sim.')]);
    expect(cues.map((c) => [c.speaker, c.text])).toEqual([
      ['Ana', 'Olá.'],
      ['Rui', 'Olá.'],
      ['Rui', 'continua o Rui'],
      ['Ana', 'Certo.'],
      ['Rui', 'Sim.'],
    ]);
  });

  it('does not take a one-off "Note:" for a speaker', () => {
    const cues = refineCueSpeakers([cue(0, 'Nota: isto é um teste.'), cue(1, 'Era uma vez'), cue(2, 'uma aldeia'), cue(3, 'junto ao mar'), cue(4, 'e mais')]);
    expect(cues.every((c) => c.speaker === null)).toBe(true);
  });

  it('reads Teams-style name lines', () => {
    const cues = refineCueSpeakers([cue(0, 'Marta Gil\nOlá.'), cue(1, 'Tomás Reis\nBom dia.'), cue(2, 'Marta Gil\nVamos.'), cue(3, 'Tomás Reis\nSim.')]);
    expect(cues.map((c) => c.speaker)).toEqual(['Marta Gil', 'Tomás Reis', 'Marta Gil', 'Tomás Reis']);
    expect(cues[0]!.text).toBe('Olá.');
  });

  it('leaves two-line subtitles alone', () => {
    const cues = refineCueSpeakers([cue(0, 'Era uma vez\numa aldeia.'), cue(1, 'Ficava junto\nao mar azul.'), cue(2, 'Toda a gente\na conhecia.')]);
    expect(cues.every((c) => c.speaker === null)).toBe(true);
  });

  it('keeps speakers that cues already have', () => {
    const cues = [cue(0, 'Olá: tudo?', 'Ana')];
    expect(refineCueSpeakers(cues)).toBe(cues);
  });
});
