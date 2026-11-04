// Properties of class metadata (folder spec §8.2, §3.4): replicas that hold the same meta files converge to the same
// effective values and organisers whatever the order they read them in; a writer whose clock is 10 years ahead can
// always be overridden by the next ordinary write (override stamp).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatHlc, Hlc } from '../hlc';
import type { MetaFile } from '../model/files';
import { mulberry32 } from '../util/prng';
import { foldMeta, overrideStamp, replayOrganisers, type MetaInput } from './meta';

const RUNS = Number(process.env.TRAMADO_PROPERTY_RUNS) || 50;
const DEVS = ['AAAAAAA', 'BBBBBBB', 'CCCCCCC', 'DDDDDDD'].map((c) => `${c}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`);
const PEOPLE = ['aaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccc', 'dddddddddddddddddddddddddd'];
const personAt = (d: string) => PEOPLE[DEVS.indexOf(d)] ?? null;
const NAMES = ['Direito I', 'Direito II', 'DC I', 'Biologia'];
const TEN_YEARS = 10 * 365 * 86_400_000;

function randomMetas(seed: number): MetaInput[] {
  const r = mulberry32(seed);
  return DEVS.map((deviceId, i) => {
    const node = deviceId.slice(0, 7).toLowerCase();
    const skew = r() < 0.15 ? TEN_YEARS : Math.floor((r() - 0.5) * 1_200_000);
    const fields: MetaFile['fields'] = {};
    const ops: MetaFile['organiserOps'] = [];
    const stamp = () => formatHlc({ ms: 1_793_000_000_000 + skew + Math.floor(r() * 100_000), counter: Math.floor(r() * 4), device: node });
    if (r() < 0.8) fields.name = { value: NAMES[Math.floor(r() * NAMES.length)]!, hlc: stamp() };
    if (r() < 0.5) fields.askBeforeAdmit = { value: r() < 0.5, hlc: stamp() };
    if (r() < 0.5) fields.colour = { value: r() < 0.5 ? '#12a594' : '#3e63dd', hlc: stamp() };
    for (let k = 0; k < 3; k++) if (r() < 0.4) ops.push({ op: r() < 0.7 ? 'add' : 'remove', memberId: PEOPLE[Math.floor(r() * 4)]!, hlc: stamp() });
    return { deviceId, file: { format: 'tramado.meta', version: 1, deviceId, memberId: PEOPLE[i]!, fields, organiserOps: ops, hlc: stamp(), sig: { cert: '', value: '' } } };
  });
}

function evaluate(metas: MetaInput[], vacated: Set<string>) {
  const org = replayOrganisers(PEOPLE[0]!, metas, personAt, vacated);
  const f = foldMeta(metas, (d, h) => org.isOrganiserAt(personAt(d), h));
  return { values: f.values, hlcs: f.hlcs, organisers: [...org.organisers].sort() };
}

describe('meta properties', () => {
  it('converges whatever the order replicas read the files in', () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), fc.boolean(), (seed, order, vac) => {
      const metas = randomMetas(seed);
      const r = mulberry32(order);
      const shuffled = [...metas].sort(() => r() - 0.5);
      const vacated = new Set(vac ? [PEOPLE[0]!] : []);
      expect(evaluate(shuffled, vacated)).toEqual(evaluate(metas, vacated));
    }), { numRuns: RUNS });
  });

  it('an ordinary write after a +10 years writer still wins', () => {
    fc.assert(fc.property(fc.integer(), (seed) => {
      const metas = randomMetas(seed);
      const now = 1_793_000_100_000;
      const me = DEVS[3]!;
      const node = me.slice(0, 7).toLowerCase();
      const clock = new Hlc(node, () => now);
      const cur = foldMeta(metas, () => true);
      const stamp = overrideStamp(clock.tick(), cur.hlcs.name, node);
      const mine: MetaInput = { deviceId: me, file: { ...metas[3]!.file, fields: { ...metas[3]!.file.fields, name: { value: 'Mine', hlc: stamp } } } };
      const after = foldMeta([...metas.slice(0, 3), mine], () => true);
      expect(after.values.name).toBe('Mine');
      // the device's own clock was not dragged forward
      expect(clock.tick() < formatHlc({ ms: now + 1, counter: 0, device: node })).toBe(true);
    }), { numRuns: RUNS });
  });

  it('departure stamp: self-adds stamped before the organisers left never count; the first one after does, on every reader', () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (seed, order) => {
      const r = mulberry32(seed);
      const base = 1_793_000_000_000;
      const departure = formatHlc({ ms: base + 50_000, counter: 0, device: DEVS[0]!.slice(0, 7).toLowerCase() });
      // the creator (PEOPLE[0]) left: her device's meta was rewritten with the departure stamp
      const metas: MetaInput[] = [{ deviceId: DEVS[0]!, file: { format: 'tramado.meta', version: 1, deviceId: DEVS[0]!, memberId: PEOPLE[0]!, fields: {}, organiserOps: [], hlc: departure, sig: { cert: '', value: '' } } }];
      const adds: Array<{ who: string; hlc: string }> = [];
      for (let i = 1; i < 4; i++) {
        const node = DEVS[i]!.slice(0, 7).toLowerCase();
        const ops: MetaFile['organiserOps'] = [];
        for (let k = 0; k < 2; k++) if (r() < 0.6) {
          const hlc = formatHlc({ ms: base + Math.floor(r() * 100_000), counter: k, device: node });
          ops.push({ op: 'add', memberId: PEOPLE[i]!, hlc });
          adds.push({ who: PEOPLE[i]!, hlc });
        }
        metas.push({ deviceId: DEVS[i]!, file: { format: 'tramado.meta', version: 1, deviceId: DEVS[i]!, memberId: PEOPLE[i]!, fields: {}, organiserOps: ops, hlc: formatHlc({ ms: base, counter: 0, device: node }), sig: { cert: '', value: '' } } });
      }
      const after = adds.filter((a) => a.hlc > departure).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
      const expected = after.length ? [after[0]!.who] : [PEOPLE[0]!];
      const rr = mulberry32(order);
      for (const readerOrder of [metas, [...metas].sort(() => rr() - 0.5), [...metas].reverse()]) {
        // while the departure is unseen, only the creator organises
        expect([...replayOrganisers(PEOPLE[0]!, readerOrder, personAt, new Set()).organisers]).toEqual([PEOPLE[0]!]);
        const org = replayOrganisers(PEOPLE[0]!, readerOrder, personAt, new Set([PEOPLE[0]!]));
        expect([...org.organisers].sort()).toEqual(expected);
        for (const a of adds) if (a.hlc < departure && a.who !== expected[0]) expect(org.organisers.has(a.who)).toBe(false);
      }
    }), { numRuns: RUNS });
  });
});
