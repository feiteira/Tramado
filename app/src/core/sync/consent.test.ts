import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { ConsentLine } from '../model/files';
import { activeConsents, consentLineOk, hasConsent, type ConsentSource } from './consent';

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
