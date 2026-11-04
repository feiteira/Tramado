import { describe, expect, it } from 'vitest';
import { chooseOf, inlineOptions, presplit, stripPoints } from './presplit';
import { LAB_EXAM, OCR_EXAM, OCR_EXAM_SUPER } from './fixtures.testutil';

const shape = (t: string) => presplit(t).blocks.map((b) => [b.number, b.parent, b.points, b.choose, b.container]);

describe('pre-split golden (critique G10, V6: II.a–c split)', () => {
  it('splits the OCR\'d TGDC exam (dots, "No training" chain)', () => {
    const p = presplit(OCR_EXAM);
    expect(shape(OCR_EXAM)).toEqual([
      ['I', null, 8, null, false],
      ['II', null, 6, 2, true],
      ['II.a', 'II', null, null, false],
      ['II.b', 'II', null, null, false],
      ['II.c', 'II', null, null, false],
      ['III', null, 4, null, false],
    ]);
    expect(p.blocks[0]!.group).toBe('GRUPO I');
    expect(p.blocks[2]!.text).toBe('Distinga erro-vício de erro na declaração.');
    expect(p.blocks[0]!.text).toMatch(/^António, com 17 anos.*Quid iuris\?$/s);
    expect(p.rules).toEqual(['Permitida a consulta de legislação não anotada.']);
    expect(p.durationMin).toBe(120);
    expect(p.extraPoints).toEqual([{ label: 'Ponderação global da redação e sistematização', points: 2 }]);
    expect(p.unit).toBe('valores');
    expect(p.title).toBe('FACULDADE DE DIREITO — Teoria Geral do Direito Civil');
  });

  it('gives the same structure for the NVIDIA reading of the same photo', () => {
    expect(shape(OCR_EXAM_SUPER).map((r) => r[0])).toEqual(['I', 'II', 'II.a', 'II.b', 'II.c', 'III']);
  });

  it('splits the lab exam: numbered questions under group headings, 2a/2b, points, inline options', () => {
    const p = presplit(LAB_EXAM);
    expect(shape(LAB_EXAM)).toEqual([
      ['1', null, 3, null, false],
      ['2', null, 5, null, true],
      ['2a', '2', 2, null, false],
      ['2b', '2', 3, null, false],
      ['3', null, 8, null, false],
      ['4', null, 2, null, false],
      ['5', null, 2, null, false],
    ]);
    expect(p.blocks.map((b) => b.group)).toEqual(['GRUPO I', 'GRUPO I', 'GRUPO I', 'GRUPO I', 'GRUPO II', 'GRUPO II', 'GRUPO II']);
    expect(p.blocks[6]!.options).toEqual([{ key: 'A', text: 'individual e concreto' }, { key: 'B', text: 'geral e abstrato' }, { key: 'C', text: 'retroativo' }]);
    expect(p.blocks[6]!.text).toBe('Escolha a opção correta. A lei restritiva de direitos deve ter caráter:');
    expect(p.durationMin).toBe(90);
  });

  it('prefixes numbers that restart in each group; reads line options and English/Spanish forms', () => {
    const t = 'Exam — Biology 101\nGroup I\n1. Define osmosis. (2 points)\n2. Which is a lipid?\nA) Glucose\nB) Cholesterol\nC) Glycine\nGroup II\n1. Explain the cell cycle. — 4 points\n';
    const p = presplit(t);
    expect(p.blocks.map((b) => b.number)).toEqual(['I.1', 'I.2', 'II.1']);
    expect(p.blocks[1]!.options.map((o) => o.key)).toEqual(['A', 'B', 'C']);
    expect(p.blocks[2]!.points).toBe(4);
    const es = presplit('Examen parcial\nPregunta 1: Defina varianza. (1,5 puntos)\nPregunta 2: Conteste dos de las siguientes:\na) media\nb) moda\nc) mediana');
    expect(es.blocks.map((b) => [b.number, b.points, b.choose])).toEqual([['1', 1.5, null], ['2', null, 2], ['2a', null, null], ['2b', null, null], ['2c', null, null]]);
  });

  it('helpers: choose-N phrases, points, inline options', () => {
    expect(chooseOf('Responda a duas das três questões seguintes.')).toBe(2);
    expect(chooseOf('Answer two of the following')).toBe(2);
    expect(chooseOf('Conteste tres de las cuatro')).toBe(3);
    expect(chooseOf('Responda às seguintes alíneas')).toBeNull();
    expect(stripPoints('Distinga A de B. (3 valores)')).toEqual({ text: 'Distinga A de B.', points: 3, unit: 'valores' });
    expect(inlineOptions('Escolha: (A) um; (B) dois.').options).toHaveLength(2);
    expect(presplit('').blocks).toEqual([]);
  });
});
