import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { AnnotationLine } from '../model/files';
import { annotationLineOk, foldAnnotations } from './annotations';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), C = D('C');
const h = (ms: number) => formatHlc({ ms, counter: 0, device: 'aaaaaaa' });
const persons: Record<string, string> = { [A]: 'ana', [B]: 'bruno', [C]: 'carla' };
const personAt = (d: string) => persons[d] ?? null;
const L = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
let n = 0;
const nid = () => `01JA0C2Y6R2W0G5QYV4X7K${String(++n).padStart(4, '0')}`;

describe('annotations (folder spec §8.17)', () => {
  it('folds add/edit/delete with the author rule', () => {
    const add: AnnotationLine = { format: 'tramado.annotation', version: 1, type: 'add', id: nid(), annotationId: '', hlc: h(1), ms: 0, memberId: 'ana', kind: 'comment', target: { source: { kind: 'lecture', lectureId: L, audioSha256: null, transcriptRevision: 1 }, locator: { type: 'whole' }, quote: { exact: 'x', prefix: '', suffix: '' } }, body: 'v1' };
    add.annotationId = add.id;
    const edit = (dev: string, body: string, ms: number): AnnotationLine => ({ format: 'tramado.annotation', version: 1, type: 'edit', id: nid(), annotationId: add.id, hlc: h(ms), ms: 0, memberId: persons[dev]!, body });
    const out = foldAnnotations([{ deviceId: A, line: add, seq: 0 }, { deviceId: B, line: edit(B, 'hack', 5), seq: 0 }, { deviceId: A, line: edit(A, 'v2', 3), seq: 1 }], personAt);
    expect(out[0]).toMatchObject({ body: 'v2', edited: true, author: 'ana' });
    expect(annotationLineOk(add)).toBe(true);
    const del: AnnotationLine = { ...edit(A, '', 9), type: 'delete' };
    expect(foldAnnotations([{ deviceId: A, line: add, seq: 0 }, { deviceId: A, line: del, seq: 1 }], personAt)).toHaveLength(0);
  });
});
