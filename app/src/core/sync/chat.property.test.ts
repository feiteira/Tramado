// Property: the chat fold is independent of the order lines arrive in (sync spec §15, §24).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatHlc } from '../hlc';
import type { ChatLine } from '../model/files';
import { mulberry32 } from '../util/prng';
import { foldChat, type ChatSourceLine } from './chat';

const RUNS = Number(process.env.TRAMADO_PROPERTY_RUNS) || 50;
const DEVS = ['AAAAAAA', 'BBBBBBB', 'CCCCCCC'].map((c) => `${c}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`);
const PEOPLE = ['aaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaaaaaaaaaaaa'];  // devices 0 and 2: one person
const personAt = (d: string) => PEOPLE[DEVS.indexOf(d)] ?? null;
const ID = (n: number) => `01JBXA7D1W3Q8K5N2M9R${String(n).padStart(6, '0')}`;

function randomLines(seed: number): ChatSourceLine[] {
  const r = mulberry32(seed);
  const out: ChatSourceLine[] = [];
  const msgs: Array<{ deviceId: string; id: string }> = [];
  const seq = new Map<string, number>();
  const n = 5 + Math.floor(r() * 25);
  for (let i = 0; i < n; i++) {
    const dev = DEVS[Math.floor(r() * DEVS.length)]!;
    const s = seq.get(dev) ?? 0;
    seq.set(dev, s + 1);
    const hlc = formatHlc({ ms: 1000 + Math.floor(r() * 50), counter: Math.floor(r() * 3), device: dev.slice(0, 7).toLowerCase() });
    const base = { format: 'tramado.chat', version: 1, id: ID(i), hlc, ms: 0, memberId: r() < 0.1 ? PEOPLE[1]! : personAt(dev)! } as const;
    const k = r();
    let line: ChatLine;
    if (k < 0.5 || msgs.length === 0) {
      const replyTo = msgs.length && r() < 0.3 ? msgs[Math.floor(r() * msgs.length)] : undefined;
      line = { ...base, type: 'message', text: `m${i}`, ...(replyTo ? { replyTo } : {}) };
      msgs.push({ deviceId: dev, id: ID(i) });
    } else {
      const target = msgs[Math.floor(r() * msgs.length)]!;
      line = k < 0.75 ? { ...base, type: 'edit', target, text: `e${i}` } : k < 0.85 ? { ...base, type: 'delete', target }
        : { ...base, type: 'reaction', target, emoji: r() < 0.5 ? '👍' : '🎉', op: r() < 0.7 ? 'add' : 'remove' };
    }
    out.push({ deviceId: dev, line, seq: s });
  }
  return out;
}

describe('chat fold property', () => {
  it('is independent of arrival order (and of duplicates)', () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (seed, shuffleSeed) => {
      const lines = randomLines(seed);
      const r = mulberry32(shuffleSeed);
      const shuffled = [...lines, ...lines.filter(() => r() < 0.2)].sort(() => r() - 0.5);
      const a = foldChat(lines, { personAt });
      const b = foldChat(shuffled, { personAt });
      const view = (f: ReturnType<typeof foldChat>) => f.messages.map((m) => [m.key, m.text, m.deleted, m.edited, m.displayKey, JSON.stringify(m.reactions)]);
      expect(view(b)).toEqual(view(a));
      // a reply never shows above its parent
      const pos = new Map(a.messages.map((m, i) => [m.key, i]));
      for (const m of a.messages) if (m.replyTo) {
        const p = pos.get(`${m.replyTo.deviceId}:${m.replyTo.id}`);
        if (p !== undefined) expect(p).toBeLessThan(pos.get(m.key)!);
      }
    }), { numRuns: RUNS });
  });
});
