import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng';
import { tolerantParse } from '../ai/tolerantJson';
import { checkPoints, cleanLabel, extractionPrompt, kindOf, normalizeExtraction, readExtraction, typedQuestions } from './extraction';
import { presplit } from './presplit';
import { LAB_EXAM, OCR_EXAM, OCR_ONE_STEP_JSON, modelOutput } from './fixtures.testutil';
import type { Question } from '../model/files';

const rows = (qs: Question[]) => qs.map((q) => [q.number, q.kind, q.points, q.parent ? qs.find((x) => x.id === q.parent)!.number : null]);
const EXPECTED_LAB = [
  ['1', 'short', 3, null], ['2', 'container', 5, null], ['2a', 'short', 2, '2'], ['2b', 'short', 3, '2'],
  ['3', 'case', 8, null], ['4', 'true_false', 2, null], ['5', 'multiple_choice', 2, null],
];

describe('extraction golden (openrouter-lab §5, critique R14)', () => {
  it('NVIDIA strict output with corrupted labels (", ") is repaired by the pre-split', () => {
    const model = readExtraction(tolerantParse(modelOutput('t5_super_strict')));
    expect(model.questions.some((q) => q.number === ', ' || q.number === ',')).toBe(true);   // the lab's corruption
    const qs = normalizeExtraction(model, presplit(LAB_EXAM), LAB_EXAM, { rand: mulberry32(1) });
    expect(rows(qs)).toEqual(EXPECTED_LAB);
    expect(qs[0]!.text).toBe('Distinga direitos, liberdades e garantias de direitos económicos, sociais e culturais.');
  });

  it('Gemma ignored the schema (its own groups/sub_questions shape): read, then reconciled', () => {
    const model = readExtraction(tolerantParse(modelOutput('t5_gemma26_strict')));
    expect(model.questions.length).toBeGreaterThanOrEqual(5);
    expect(rows(normalizeExtraction(model, presplit(LAB_EXAM), LAB_EXAM, { rand: mulberry32(2) }))).toEqual(EXPECTED_LAB);
  });

  it('the perfect prompt-only output normalises alone (no pre-split) to the same questions', () => {
    const model = readExtraction(tolerantParse(modelOutput('t5_ultra_prompt_only')));
    const qs = normalizeExtraction(model, { ...presplit(''), blocks: [] }, LAB_EXAM, { rand: mulberry32(3) });
    expect(rows(qs)).toEqual([['1', 'other', 3, null], ...EXPECTED_LAB.slice(1)]);   // "Distinta" (the model's typo) → "check the type"
    expect(qs[6]!.options.map((o) => o.text)).toEqual(['individual e concreto', 'geral e abstrato', 'retroativo']);
    expect(qs[0]!.text).toMatch(/^Distinta/);   // the model's typo stays when there is no pre-split to correct it
  });

  it('the one-step image → JSON that merged II.a–c is split again (critique V6)', () => {
    const model = readExtraction(tolerantParse(OCR_ONE_STEP_JSON));
    const qs = normalizeExtraction(model, presplit(OCR_EXAM), OCR_EXAM, { rand: mulberry32(4) });
    expect(rows(qs)).toEqual([
      ['I', 'case', 8, null], ['II', 'container', 6, null], ['II.a', 'short', null, 'II'], ['II.b', 'short', null, 'II'],
      ['II.c', 'short', null, 'II'], ['III', 'comment', 4, null],
    ]);
    expect(qs[1]!.choose).toBe(2);
    expect(new Set(qs.map((q) => q.id)).size).toBe(6);
    expect(qs.every((q) => /^q_[0-9A-Za-z]{7}$/.test(q.id))).toBe(true);
  });

  it('typed questions use the pre-split only; unstructured text is one question', () => {
    expect(typedQuestions(OCR_EXAM, mulberry32(5)).questions).toHaveLength(6);
    const one = typedQuestions('Explique a diferença entre dolo e negligência.', mulberry32(6)).questions;
    expect(rows(one)).toEqual([['1', 'short', null, null]]);
  });

  it('labels, kinds, points check and the prompt', () => {
    expect(cleanLabel(', ', '3. Um município aprova…')).toEqual({ number: '3', text: 'Um município aprova…' });
    expect(cleanLabel('2a', 'a) O que se entende…')).toEqual({ number: '2a', text: 'O que se entende…' });
    expect(kindOf('Calcule a média ponderada.', [], false)).toBe('calculation');
    expect(kindOf('Disserte sobre o Estado de direito.', [], false)).toBe('essay');
    expect(kindOf('Responda.', [], false)).toBe('other');
    const qs = normalizeExtraction(null, presplit(LAB_EXAM), LAB_EXAM, { rand: mulberry32(7) });
    expect(checkPoints(qs)).toEqual({ ok: true, total: 20, mismatches: [] });
    const msgs = extractionPrompt('pt', LAB_EXAM, presplit(LAB_EXAM).blocks);
    expect(String(msgs[0]!.content)).toContain('JSON Schema');
    expect(String(msgs[1]!.content)).toContain('2a, 2b');
    expect(readExtraction('nope').errors).toEqual(['not a JSON object']);
  });
});
