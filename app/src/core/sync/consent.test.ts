import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { AnnotationLine, ConsentLine, ModLine } from '../model/files';
import { activeConsents, consentLineOk, hasConsent, type ConsentSource } from './consent';
import { foldMod, modLineOk } from './mod';
import { annotationLineOk, foldAnnotations } from './annotations';
import { signRecord } from './sign';
import { verifySig } from '../model/sig';
import { testDevice } from './keys.testutil';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), C = D('C');
const h = (ms: number) => formatHlc({ ms, counter: 0, device: 'aaaaaaa' });
const persons: Record<string, string> = { [A]: 'ana', [B]: 'bruno', [C]: 'carla' };
const personAt = (d: string) => persons[d] ?? null;
const L = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
let n = 0;
const nid = () => `01JA0C2Y6R2W0G5QYV4X7K${String(++n).padStart(4, '0')}`;
const consent = (dev: string, over: Partial<ConsentLine>): ConsentSource => ({
  deviceId: dev, line: { format: 'tramado.consent', version: 1, id: nid(), hlc: h(10), ms: 0, memberId: persons[dev]!, kind: 'record', scope: 'class', textId: 'record.dialog.consent.v1', textLang: 'pt-PT', text: 'Confirmo.', sig: { cert: '', value: '' }, ...over },
});

describe('consent (folder spec §8.5)', () => {
  it('revocations by {deviceId, id} count from the same person or an organiser', () => {
    const rec = consent(A, { kind: 'record', scope: 'lecture', lectureId: L });
    const share = consent(A, { kind: 'share', share: 'audio+transcript' });
    const byBruno = consent(B, { kind: 'revoke', revokes: { deviceId: A, id: rec.line.id }, hlc: h(20) });
    let active = activeConsents([rec, share, byBruno], personAt, () => false);
    expect(active).toHaveLength(2);
    active = activeConsents([rec, share, byBruno], personAt, (m) => m === 'bruno');
    expect(active.map((a) => a.kind)).toEqual(['share']);
    const own = consent(A, { kind: 'revoke', revokes: { deviceId: A, id: share.line.id }, hlc: h(30) });
    expect(activeConsents([rec, share, own], personAt, () => false).map((a) => a.kind)).toEqual(['record']);
    expect(hasConsent(activeConsents([rec], personAt, () => false), 'record', L)).toBe(true);
    expect(hasConsent(activeConsents([rec], personAt, () => false), 'record', null)).toBe(false);
    expect(consentLineOk(rec.line)).toBe(true);
    expect(consentLineOk({ ...rec.line, kind: 'revoke' })).toBe(false);
  });
});

describe('moderation log (folder spec §8.18), read-only in 0.1', () => {
  const mod = (dev: string, over: Partial<ModLine>) => ({ deviceId: dev, line: { format: 'tramado.mod', version: 1, id: nid(), hlc: h(10), ms: 0, memberId: persons[dev]!, type: 'pin', sig: { cert: '', value: '' }, ...over } as ModLine });
  it('honours pins, unpins, hides and audio removal by the table', () => {
    const target = { deviceId: C, id: nid() };
    const s = foldMod([
      mod(B, { type: 'pin', target, hlc: h(1) }),
      mod(C, { type: 'unpin', target, hlc: h(2) }),           // not the pinner, not an organiser: ignored
      mod(C, { type: 'hide', target, hlc: h(3) }),            // suggestion only
      mod(A, { type: 'audio-removed', lectureId: L, hlc: h(4) }),
      mod(C, { type: 'audio-removed', lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH3K', hlc: h(5) }),   // carla is the recorder
    ], personAt, (m) => m === 'ana', (id) => (id === '01JBX4Q7Z5W8M2E3C9R6T0YH3K' ? 'carla' : 'bruno'));
    expect(s.pins).toHaveLength(1);
    expect(s.hidden).toHaveLength(0);
    expect(s.hideSuggestions).toHaveLength(1);
    expect([...s.audioRemoved].sort()).toEqual([L, '01JBX4Q7Z5W8M2E3C9R6T0YH3K']);
    expect(modLineOk(mod(A, {}).line)).toBe(true);
  });
});

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

describe('signRecord (folder spec §6.6)', () => {
  it('signs the canonical record without sig', async () => {
    const d = await testDevice();
    const cls = 'tramado-geznkyujw4ofedwinfcmzl2rim';
    const path = `.tramado/bans/${d.deviceId}.json`;
    const rec = { format: 'tramado.bans', version: 1, deviceId: d.deviceId, entries: [], sig: { cert: 'old', value: 'old' } };
    const signed = await signRecord((c, p, canonical) => d.sign(c, p, JSON.parse(new TextDecoder().decode(canonical))), cls, path, rec);
    expect(await verifySig(signed, cls, path, d.deviceId)).toBe(true);
  });
});
