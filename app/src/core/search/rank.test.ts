import { describe, expect, it } from 'vitest';
import { rankPassages } from './rank';
import { stopwordsFor } from './stopwords';

const stop = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);

// Fictional class notes and readings.
const docs = [
  {
    id: 'aula1',
    text: [
      'Bom dia. Hoje falamos de movimentos sociais.',
      'Um movimento social é um esforço continuado de um grupo para mudar a sociedade.',
      'As hortas comunitárias de Lisboa começaram como um protesto pequeno.',
    ].join('\n'),
  },
  {
    id: 'leitura',
    text: [
      'Os partidos políticos disputam eleições; os movimentos sociais mobilizam pessoas fora delas.',
      'A diferença entre partido e movimento está na relação com o Estado.',
    ].join('\n'),
  },
  { id: 'outra', text: 'Receita de bolo de laranja.\nMisture a farinha com o açúcar.' },
];

describe('ranking passages for a question', () => {
  it('puts the paragraphs that answer first, matching word forms and accents', () => {
    const r = rankPassages(docs, 'Explique a diferença entre os movimentos sociais e os partidos políticos.', { stopwords: stop });
    expect(r[0]!.documentId).toBe('leitura');
    expect(r.slice(0, 2).every((p) => p.documentId === 'leitura')).toBe(true);
    expect(r.some((p) => p.documentId === 'outra')).toBe(false);
    // The one naming the difference itself comes first; the words found are marked in place.
    const first = r[0]!;
    expect(first.text).toMatch(/^A diferença entre partido e movimento/);
    expect(first.text).toBe(docs[1]!.text.slice(first.start, first.end));
    const marked = r.slice(0, 2).flatMap((p) => p.hits.map((h) => docs[1]!.text.slice(h.start, h.end).toLowerCase()));
    expect(marked).toEqual(expect.arrayContaining(['diferença', 'partido', 'movimento', 'partidos', 'políticos', 'movimentos', 'sociais']));
  });

  it('leaves out what the caller says, and nothing for a question of stop words', () => {
    const r = rankPassages(docs, 'movimento social', { stopwords: stop, exclude: (p) => p.documentId === 'leitura' });
    expect(r.map((p) => p.documentId)).toEqual(['aula1', 'aula1']);
    expect(rankPassages(docs, 'o que é a de', { stopwords: stop })).toEqual([]);
  });

  it('scores long paragraphs in windows', () => {
    const sentence = 'Esta frase fala de outra coisa qualquer. ';
    const long = sentence.repeat(40) + 'Aqui explica-se a fotossíntese das plantas. ' + sentence.repeat(40);
    const r = rankPassages([{ id: 'x', text: long }], 'fotossíntese', { stopwords: stop });
    expect(r).toHaveLength(1);
    expect(r[0]!.end - r[0]!.start).toBeLessThanOrEqual(600);
    expect(r[0]!.text).toContain('fotossíntese');
  });

  it('puts passages that are themselves questions after the ones that answer', () => {
    const talk = [
      { id: 'i', text: 'Interviewer: How do you feel about the neighbourhood?\nAna: I feel I belong to the neighbourhood now, thanks to the garden.' },
    ];
    const r = rankPassages(talk, 'Why do people feel they belong to the neighbourhood?', { stopwords: stop });
    expect(r.map((p) => p.text.slice(0, 4))).toEqual(['Ana:', 'Inte']);
  });
});
