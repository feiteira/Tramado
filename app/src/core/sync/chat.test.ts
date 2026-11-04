import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { ChatLine } from '../model/files';
import { chatLineOk, chatMonthOf, chatTokens, foldChat, msgRefOf, notifiesMe, redactedLine, type ChatSourceLine } from './chat';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), A2 = D('C');
const h = (ms: number, n = 'aaaaaaa', c = 0) => formatHlc({ ms, counter: c, device: n });
const ANA = 'aaaaaaaaaaaaaaaaaaaaaaaaaa', BRUNO = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
const persons: Record<string, string> = { [A]: ANA, [A2]: ANA, [B]: BRUNO };
const ctx = { personAt: (d: string) => persons[d] ?? null };
let n = 0;
const id = () => `01JBXA7D1W3Q8K5N2M9R4T${String(++n).padStart(4, '0')}`;
const msg = (dev: string, text: string, hlc: string, over: Partial<ChatLine> = {}): ChatSourceLine => ({
  deviceId: dev, seq: n, line: { format: 'tramado.chat', version: 1, type: 'message', id: id(), hlc, ms: 0, memberId: persons[dev]!, text, ...over } as ChatLine,
});
const act = (dev: string, line: Partial<ChatLine> & { type: ChatLine['type'] }, hlc: string): ChatSourceLine => ({
  deviceId: dev, seq: n, line: { format: 'tramado.chat', version: 1, id: id(), hlc, ms: 0, memberId: persons[dev]!, ...line } as ChatLine,
});

describe('chat fold (folder spec §8.16)', () => {
  it('identity is (device, id): the same id in another file is another message', () => {
    const m1 = msg(A, 'olá', h(10));
    const m2: ChatSourceLine = { ...msg(B, 'outra', h(11)), line: { ...m1.line, memberId: BRUNO, text: 'outra' } as ChatLine, deviceId: B };
    const f = foldChat([m1, m2, m1], ctx);
    expect(f.messages.map((m) => m.key)).toEqual([`${A}:${m1.line.id}`, `${B}:${m1.line.id}`]);
  });

  it('attributes to the bound person; a forged memberId is unverified', () => {
    const forged = msg(B, 'sou a Ana', h(10), { memberId: ANA });
    const f = foldChat([forged], ctx);
    expect(f.messages[0]).toMatchObject({ author: BRUNO, unverified: true });
  });

  it('edits and deletes only from the same person; greatest edit wins; delete is final', () => {
    const m = msg(A, 'v1', h(10));
    const ref = { deviceId: A, id: m.line.id };
    const f = foldChat([
      m,
      act(B, { type: 'edit', target: ref, text: 'hacked' } as never, h(20, 'bbbbbbb')),
      act(A2, { type: 'edit', target: ref, text: 'v3' } as never, h(30, 'ccccccc')),   // Ana's other computer
      act(A, { type: 'edit', target: ref, text: 'v2' } as never, h(25)),
    ], ctx);
    expect(f.messages[0]).toMatchObject({ text: 'v3', edited: true, deleted: false });
    const g = foldChat([m, act(A, { type: 'delete', target: ref } as never, h(15)), act(A, { type: 'edit', target: ref, text: 'late' } as never, h(40))], ctx);
    expect(g.messages[0]).toMatchObject({ deleted: true, text: '' });
    const hdel = foldChat([m, act(B, { type: 'delete', target: ref } as never, h(15, 'bbbbbbb'))], ctx);
    expect(hdel.messages[0]!.deleted).toBe(false);
  });

  it('redacted lines are deleted; waiting targets are counted', () => {
    const m = msg(A, 'segredo', h(10));
    const f = foldChat([{ ...m, line: redactedLine(m.line) }], ctx);
    expect(f.messages[0]).toMatchObject({ deleted: true, text: '' });
    const w = foldChat([act(A, { type: 'edit', target: { deviceId: B, id: m.line.id }, text: 'x' } as never, h(20))], ctx);
    expect(w.waiting).toBe(1);
  });

  it('a reply never shows above its parent; reactions by greatest HLC', () => {
    const parent = msg(B, 'pergunta', h(100, 'bbbbbbb'));
    const reply = msg(A, 'resposta', h(50), { replyTo: { deviceId: B, id: parent.line.id } } as never);   // A's clock is slow
    const f = foldChat([reply, parent], ctx);
    expect(f.messages.map((m) => m.text)).toEqual(['pergunta', 'resposta']);
    const target = { deviceId: B, id: parent.line.id };
    const r = foldChat([parent, act(A, { type: 'reaction', target, emoji: '👍', op: 'add' } as never, h(10)), act(A, { type: 'reaction', target, emoji: '👍', op: 'remove' } as never, h(5))], ctx);
    expect(r.messages[0]!.reactions).toEqual({ '👍': [ANA] });
  });

  it('notifies on mentions and on @everyone from organisers only', () => {
    const m = foldChat([msg(B, `olá <@${ANA}> e <@everyone>`, h(10, 'bbbbbbb'))], ctx).messages[0]!;
    expect(m.mentions).toEqual([ANA, 'everyone']);
    expect(notifiesMe(m, ANA, () => false)).toBe('mention');
    const e = foldChat([msg(B, 'atenção <@everyone>', h(10, 'bbbbbbb'))], ctx).messages[0]!;
    expect(notifiesMe(e, ANA, () => false)).toBeNull();
    expect(notifiesMe(e, ANA, () => true)).toBe('everyone');
  });

  it('helpers', () => {
    expect(chatMonthOf(h(Date.UTC(2026, 10, 30, 23, 59)))).toBe('2026-11');
    expect(chatTokens('<@ai> e <@ai> <@k3q7mzx2v4hbtnw5r6yjc2aefg>')).toEqual(['ai', 'k3q7mzx2v4hbtnw5r6yjc2aefg']);
    expect(msgRefOf(`${A}:01JBXA7D1W3Q8K5N2M9R4T6Y0C`)).toEqual({ deviceId: A, id: '01JBXA7D1W3Q8K5N2M9R4T6Y0C' });
    expect(chatLineOk({ type: 'message', id: '01JBXA7D1W3Q8K5N2M9R4T6Y0C', hlc: h(1), ms: 1, memberId: 'x', text: 'a' })).toBe(true);
    expect(chatLineOk({ type: 'poll', id: '01JBXA7D1W3Q8K5N2M9R4T6Y0C', hlc: h(1), ms: 1, memberId: 'x' })).toBe(false);
  });
});
