import { describe, expect, it } from 'vitest';
import { choiceOf, citationsFor, findMarkers, grounding, isInsufficient, parseCitations, plainWithFootnotes, sentences } from './citations';
import type { Citation } from '../model/files';

const base = (label: string): Omit<Citation, 'ref' | 'pin'> => ({
  source: { kind: 'document', path: 'Documentos/LF.pdf', sha256: 'a'.repeat(64) }, locator: { type: 'page', page: 9 }, quote: null, label,
});

describe('citations (folder spec §8.15, UX §4.1)', () => {
  it('parses single refs, lists and pin-points', () => {
    const m = findMarkers('A [S1]. B [S1, S4]. C [S4, n.º 3]. D [S2,S3, al. b)].');
    expect(m.map((x) => [x.refs, x.pin])).toEqual([[['S1'], null], [['S1', 'S4'], null], [['S4'], 'n.º 3'], [['S2', 'S3'], 'al. b)']]);
  });
  it('numbers chips 1..n by first appearance; the pin goes to the last ref of its marker', () => {
    const p = parseCitations('Primeiro [S3]. Depois [S1, S3, n.º 2]. Fim [S1].', new Set(['S1', 'S3']));
    expect(p.chips).toEqual([
      { n: 1, ref: 'S3', pin: 'n.º 2', hallucinated: false },
      { n: 2, ref: 'S1', pin: null, hallucinated: false },
    ]);
  });
  it('marks refs never sent as hallucinated; ignores [1]-style footnotes', () => {
    const p = parseCitations('Texto [S1] e [S9]; a nota [1] da lei.', new Set(['S1', 'S2']));
    expect(p.hallucinated).toEqual(['S9']);
    expect(p.chips.map((c) => c.ref)).toEqual(['S1', 'S9']);
  });
  it('stores one citation per valid ref with its first pin', () => {
    const table = new Map([['S1', base('LF · p. 9')], ['S2', base('Aula 6 · 41:12')]]);
    const cs = citationsFor('X [S2, 41:12]. Y [S1]. Z [S7].', table);
    expect(cs.map((c) => [c.ref, c.pin, c.label])).toEqual([['S2', '41:12', 'Aula 6 · 41:12'], ['S1', undefined, 'LF · p. 9']]);
  });
  it('splits sentences and attaches trailing markers', () => {
    const ss = sentences('Primeira frase. [S1]\n- item um [S2]\n#### Conclusão\nÚltima sem ponto');
    expect(ss.map((s) => s.text)).toEqual(['Primeira frase. [S1]', '- item um [S2]', 'Última sem ponto']);
  });
  it('measures grounding and the unverified parts when general knowledge is allowed', () => {
    const t = 'A lei restringe só nos casos previstos [S1]. O núcleo essencial fica intocado [S1, n.º 3].\n\nConhecimento geral: isto aplica-se também a regulamentos.';
    const g = grounding(t, new Set(['S1']), true);
    expect(g.grounded).toBeCloseTo(2 / 3);
    expect(g.unverified).toEqual(['Conhecimento geral: isto aplica-se também a regulamentos.']);
    expect(g.general[0]![0]).toBe(t.indexOf('Conhecimento geral'));
    expect(grounding(t, new Set(['S1']), false)).toMatchObject({ general: [], unverified: [] });
    expect(grounding('', new Set(), true).grounded).toBe(1);
  });
  it('detects "the materials don\'t cover this" in the three languages', () => {
    expect(isInsufficient('The materials do not cover the fee amount.')).toBe(true);
    expect(isInsufficient('Os materiais não cobrem o valor da taxa.')).toBe(true);
    expect(isInsufficient('Los materiales no cubren este punto.')).toBe(true);
    expect(isInsufficient('A lei é clara [S1].')).toBe(false);
  });
  it('reads the chosen option', () => {
    expect(choiceOf('Resposta: B\nPorque…')).toBe('B');
    expect(choiceOf('**Answer:** c')).toBe('C');
    expect(choiceOf('Respuesta: verdadero')).toBe('Verdadero');
    expect(choiceOf('Sem opção.')).toBeUndefined();
  });
  it('copies with footnotes', () => {
    const p = parseCitations('Isto [S2, n.º 1] e aquilo [S1].', new Set(['S1', 'S2']));
    expect(plainWithFootnotes('Isto [S2, n.º 1] e aquilo [S1].', p.chips, (r) => (r === 'S1' ? 'Aula 6, ▶ 41:12' : 'LF, p. 9'))).toBe('Isto [1, n.º 1] e aquilo [2].\n\n[1] LF, p. 9\n[2] Aula 6, ▶ 41:12');
  });
});
