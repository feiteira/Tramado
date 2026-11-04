import { describe, expect, it } from 'vitest';
import { foldExamEdits, type EditFrom } from './fold';
import { sha1Hex } from './sha1';
import { expansionMessages, parseExpansion, queryFor, quickPlan } from './quick';
import type { ExamEditLine, ExamFile, Question } from '../model/files';

const DEV_A = 'AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA';
const DEV_B = 'BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB';
const q = (id: string, number: string, parent: string | null = null, kind: Question['kind'] = 'short'): Question => ({
  id, number, parent, group: null, kind, text: `Q ${number}`, points: 1, options: [], choose: null, source: null, answerKey: null,
});
const exam = (): ExamFile => ({
  format: 'tramado.exam', version: 1, id: '01JC1T9WQ2N8B5V3H7X4M6R0ZE', idNonce: 'z2k7m4q9x3v5bnw6r2yjc7hefa', title: 'T', type: 'final', status: 'paper',
  date: null, allDay: false, durationMin: null, room: null, weight: null, weightText: null, covers: [], coversText: null, rules: [], scale: null,
  files: [], importedBy: { memberId: 'm', deviceId: DEV_A, name: 'Ana' }, createdAt: '2026-11-02T20:01:13.004Z', extraction: null,
  questions: [q('q_aaaaaaa', '1'), q('q_bbbbbbb', '2', null, 'container'), q('q_ccccccc', '2a', 'q_bbbbbbb'), q('q_ddddddd', '3')],
  revision: 1, folded: {}, updatedAt: '2026-11-02T20:03:02.000Z',
});
let n = 0;
const line = (hlc: string, op: ExamEditLine['op'], extra: Partial<ExamEditLine>): ExamEditLine => ({
  format: 'tramado.exam-edit', version: 1, id: `01JC1T9WQ2N8B5V3H7X4M6R${String(n++).padStart(3, '0')}`, hlc, ms: 1, memberId: 'm', examId: exam().id, baseRevision: 1, op, ...extra,
});
const H = (ms: number, node = 'aaaaaaa') => `${String(ms).padStart(15, '0')}-00000-${node}`;

describe('exam-edit fold (folder spec §8.13)', () => {
  it('LWW per (question, field) and per exam field, by HLC regardless of arrival order', () => {
    const lines: EditFrom[] = [
      { deviceId: DEV_B, line: line(H(20, 'bbbbbbb'), 'set_question', { questionId: 'q_aaaaaaa', field: 'text', value: 'later' }) },
      { deviceId: DEV_A, line: line(H(10), 'set_question', { questionId: 'q_aaaaaaa', field: 'text', value: 'earlier' }) },
      { deviceId: DEV_A, line: line(H(11), 'set_exam', { field: 'title', value: 'Novo título' }) },
      { deviceId: DEV_A, line: line(H(12), 'set_exam', { field: 'idNonce', value: 'x' }) },
    ];
    const r = foldExamEdits(exam(), lines);
    expect(r.exam.questions[0]!.text).toBe('later');
    expect(r.exam.questions[0]!.fieldHlc).toEqual({ text: H(20, 'bbbbbbb') });
    expect(r.exam.title).toBe('Novo título');
    expect(r.exam.idNonce).toBe(exam().idNonce);
    expect(r.exam.folded).toEqual({ [DEV_A]: H(12), [DEV_B]: H(20, 'bbbbbbb') });
    expect(foldExamEdits(exam(), [...lines].reverse()).exam).toEqual(r.exam);
    // Folding again changes nothing.
    expect(foldExamEdits(r.exam, lines).changed).toBe(false);
  });

  it('delete is final (children too, and the id never comes back); add with a present id is ignored', () => {
    const lines: EditFrom[] = [
      { deviceId: DEV_A, line: line(H(10), 'delete_question', { questionId: 'q_bbbbbbb' }) },
      { deviceId: DEV_B, line: line(H(11, 'bbbbbbb'), 'set_question', { questionId: 'q_ccccccc', field: 'text', value: 'zombie' }) },
      { deviceId: DEV_B, line: line(H(12, 'bbbbbbb'), 'add_question', { question: q('q_bbbbbbb', '2'), after: null }) },
      { deviceId: DEV_B, line: line(H(13, 'bbbbbbb'), 'add_question', { question: q('q_aaaaaaa', 'dup'), after: null }) },
      { deviceId: DEV_B, line: line(H(14, 'bbbbbbb'), 'add_question', { question: q('q_eeeeeee', '1a'), after: 'q_aaaaaaa' }) },
      { deviceId: DEV_B, line: line(H(15, 'bbbbbbb'), 'add_question', { question: q('q_fffffff', '0'), after: null }) },
    ];
    const r = foldExamEdits(exam(), lines);
    expect(r.exam.questions.map((x) => x.id)).toEqual(['q_fffffff', 'q_aaaaaaa', 'q_eeeeeee', 'q_ddddddd']);
    expect(r.exam.questions[1]!.number).toBe('1');
  });

  it('skips lines already folded and lines of other exams', () => {
    const e = { ...exam(), folded: { [DEV_A]: H(50) } };
    const r = foldExamEdits(e, [
      { deviceId: DEV_A, line: line(H(40), 'set_exam', { field: 'title', value: 'old' }) },
      { deviceId: DEV_A, line: { ...line(H(60), 'set_exam', { field: 'title', value: 'other exam' }), examId: '01JC1T9WQ2N8B5V3H7X4M6R0ZF' } },
    ]);
    expect(r.changed).toBe(false);
  });
});

describe('quick answer plan (critique C17) and SHA-1', () => {
  it('plans 1 expansion + 1 per answerable question', () => {
    const qs = exam().questions;
    expect(quickPlan(qs)).toMatchObject({ requests: 4 });
    expect(quickPlan(qs).order.map((x) => x.number)).toEqual(['1', '2a', '3']);
    expect(quickPlan(qs, ['q_ddddddd']).requests).toBe(2);
    expect(quickPlan([]).requests).toBe(0);
  });
  it('parses the expansion JSON tolerantly and builds queries', () => {
    const ids = ['q_aaaaaaa', 'q_ddddddd'];
    expect(parseExpansion('```json\n{"queries": {"q_aaaaaaa": ["artigo 18.º", "restrições"], "q_zzz": ["x"], "q_ddddddd": "proporcionalidade, adequação"}}\n```', ids))
      .toEqual({ q_aaaaaaa: ['artigo 18.º', 'restrições'], q_ddddddd: ['proporcionalidade', 'adequação'] });
    expect(parseExpansion('nope', ids)).toEqual({});
    expect(queryFor(q('q_aaaaaaa', '1'), ['a', 'b'])).toBe('Q 1 a b');
    expect(String(expansionMessages('pt', exam().questions, 'português europeu')[1]!.content)).toContain('q_aaaaaaa: Q 1');
  });
  it('SHA-1 matches the FIPS vectors', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
    expect(sha1Hex('Distinga erro-vício de erro na declaração.')).toMatch(/^[0-9a-f]{40}$/);
  });
});
