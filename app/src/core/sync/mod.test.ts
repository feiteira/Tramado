import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { ModLine } from '../model/files';
import { foldMod, modLineOk } from './mod';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), C = D('C');
const h = (ms: number) => formatHlc({ ms, counter: 0, device: 'aaaaaaa' });
const persons: Record<string, string> = { [A]: 'ana', [B]: 'bruno', [C]: 'carla' };
const personAt = (d: string) => persons[d] ?? null;
const L = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
let n = 0;
const nid = () => `01JA0C2Y6R2W0G5QYV4X7K${String(++n).padStart(4, '0')}`;

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
