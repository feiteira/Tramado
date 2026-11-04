import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { MetaFile } from '../model/files';
import { foldMeta, overrideStamp, replayOrganisers, validDirs, validValue, type MetaInput } from './meta';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), C = D('C');
const h = (ms: number, n = 'aaaaaaa', c = 0) => formatHlc({ ms, counter: c, device: n });
const meta = (deviceId: string, fields: MetaFile['fields'], ops: MetaFile['organiserOps'] = []): MetaInput => ({
  deviceId, file: { format: 'tramado.meta', version: 1, deviceId, memberId: 'x', fields, organiserOps: ops, hlc: h(1), sig: { cert: '', value: '' } },
});
const persons: Record<string, string> = { [A]: 'ana', [B]: 'bruno', [C]: 'carla' };
const personAt = (d: string) => persons[d] ?? null;

describe('meta validation (folder spec §8.2)', () => {
  it('checks lengths, NFC, controls and bidi overrides', () => {
    expect(validValue('name', 'Direito Constitucional I')).toBe(true);
    expect(validValue('name', '')).toBe(false);
    expect(validValue('name', 'x'.repeat(121))).toBe(false);
    expect(validValue('name', 'Evil‮name')).toBe(false);
    expect(validValue('name', 'tab\tname')).toBe(false);
    expect(validValue('name', 'Café')).toBe(false); // not NFC
    expect(validValue('shortName', 'DC I')).toBe(true);
    expect(validValue('shortName', 'x'.repeat(13))).toBe(false);
    expect(validValue('colour', '#12a594')).toBe(true);
    expect(validValue('colour', 'red')).toBe(false);
    expect(validValue('lecturer', null)).toBe(true);
    expect(validValue('term', 'x'.repeat(41))).toBe(false);
    expect(validValue('language', 'auto')).toBe(true);
    expect(validValue('language', 'pt-PT')).toBe(true);
    expect(validValue('askBeforeAdmit', 'yes')).toBe(false);
  });

  it('checks dirs', () => {
    const ok = { lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' };
    expect(validDirs(ok)).toBe(true);
    expect(validDirs({ ...ok, notes: 'aulas' })).toBe(false);              // two equal (case-insensitive)
    expect(validDirs({ ...ok, notes: '.hidden' })).toBe(false);
    expect(validDirs({ ...ok, notes: 'a/b' })).toBe(false);
    expect(validDirs({ ...ok, notes: 'bad:name' })).toBe(false);           // not sanitised
    expect(validDirs({ ...ok, fromChat: undefined })).toBe(false);
  });
});

describe('LWW fold', () => {
  it('takes the greatest valid register per field; ties by device ID', () => {
    const f = foldMeta([
      meta(A, { name: { value: 'Old', hlc: h(10) }, colour: { value: '#12a594', hlc: h(30) } }),
      meta(B, { name: { value: 'New', hlc: h(20, 'bbbbbbb') }, colour: { value: 'bad', hlc: h(40, 'bbbbbbb') } }),
      meta(C, { shortName: { value: 'X', hlc: h(5) } }),
      meta(A.replace(/^A/, 'Z'), { shortName: { value: 'Y', hlc: h(5) } }),
    ], () => true);
    expect(f.values.name).toBe('New');
    expect(f.values.colour).toBe('#12a594');        // the invalid newer register counts as absent
    expect(f.values.shortName).toBe('Y');           // equal stamps: the greater device ID wins
    expect(f.hlcs.name).toBe(h(20, 'bbbbbbb'));
  });

  it('askBeforeAdmit counts only from organisers at the register HLC', () => {
    const metas = [meta(A, {}, [{ op: 'add', memberId: 'ana', hlc: h(1) }]), meta(B, { askBeforeAdmit: { value: true, hlc: h(50, 'bbbbbbb') } })];
    const org = replayOrganisers('ana', metas, personAt, new Set());
    const f = foldMeta(metas, (d, hlc) => org.isOrganiserAt(personAt(d), hlc));
    expect(f.values.askBeforeAdmit).toBeUndefined();
    const metas2 = [meta(A, { askBeforeAdmit: { value: true, hlc: h(20) } }, [{ op: 'add', memberId: 'bruno', hlc: h(30) }]), meta(B, { askBeforeAdmit: { value: false, hlc: h(25, 'bbbbbbb') } })];
    const org2 = replayOrganisers('ana', metas2, personAt, new Set());
    // Bruno's register is stamped before he became an organiser: it does not count.
    expect(foldMeta(metas2, (d, x) => org2.isOrganiserAt(personAt(d), x)).values.askBeforeAdmit).toBe(true);
  });

  it('a register stamped 10 years ahead is overridden by the next ordinary write (§3.4)', () => {
    const tenYears = 10 * 365 * 86_400_000;
    const now = 1_793_721_438_157;
    const future = h(now + tenYears, 'bbbbbbb');
    const metas = [meta(B, { name: { value: 'Hijacked', hlc: future } })];
    const cur = foldMeta(metas, () => true);
    const stamp = overrideStamp(h(now, 'aaaaaaa'), cur.hlcs.name, 'aaaaaaa');
    expect(stamp > future).toBe(true);
    const after = foldMeta([...metas, meta(A, { name: { value: 'Mine', hlc: stamp } })], () => true);
    expect(after.values.name).toBe('Mine');
  });
});

describe('organiser replay (§8.2)', () => {
  it('starts with the creator and applies valid ops only', () => {
    const r = replayOrganisers('ana', [
      meta(B, {}, [{ op: 'add', memberId: 'bruno', hlc: h(5) }]),            // not an organiser: invalid
      meta(A, {}, [{ op: 'add', memberId: 'carla', hlc: h(10) }]),
      meta(C, {}, [{ op: 'remove', memberId: 'ana', hlc: h(20) }]),          // carla is an organiser now
    ], personAt, new Set());
    expect([...r.organisers].sort()).toEqual(['carla']);
    expect(r.isOrganiserAt('ana', h(15))).toBe(true);
    expect(r.isOrganiserAt('ana', h(25))).toBe(false);
    expect(r.isOrganiserAt('bruno', h(30))).toBe(false);
  });

  it('vacancy: anyone may become an organiser once every organiser left; departed organisers drop out', () => {
    const ops = [meta(B, {}, [{ op: 'add', memberId: 'bruno', hlc: h(40) }])];
    expect([...replayOrganisers('ana', ops, personAt, new Set()).organisers]).toEqual(['ana']);
    const r = replayOrganisers('ana', ops, personAt, new Set(['ana']));
    expect([...r.organisers]).toEqual(['bruno']);
    // monotonic: ana re-joins (no longer vacated in this reader's view? vacated never shrinks) and is not an organiser again
    const back = replayOrganisers('ana', [...ops, meta(C, {}, [{ op: 'add', memberId: 'carla', hlc: h(50) }])], personAt, new Set(['ana']));
    expect([...back.organisers]).toEqual(['bruno']);   // carla is not an organiser: bruno's step-in stays valid
  });

  it('is independent of the order of the input files', () => {
    const files = [
      meta(A, {}, [{ op: 'add', memberId: 'bruno', hlc: h(10) }, { op: 'remove', memberId: 'bruno', hlc: h(30) }]),
      meta(B, {}, [{ op: 'add', memberId: 'carla', hlc: h(20, 'bbbbbbb') }]),
    ];
    const a = replayOrganisers('ana', files, personAt, new Set());
    const b = replayOrganisers('ana', [...files].reverse(), personAt, new Set());
    expect([...a.organisers].sort()).toEqual([...b.organisers].sort());
    expect([...a.organisers].sort()).toEqual(['ana', 'carla']);
  });
});
