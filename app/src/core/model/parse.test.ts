import { describe, expect, it } from 'vitest';
import { mergeUnknown, parseJsonl, parseRecord } from './parse';
import { isNewer, negotiate } from './formats';

const enc = (s: string) => new TextEncoder().encode(s);

describe('parse', () => {
  it('checks the envelope and reports unknown and newer records', () => {
    expect(parseRecord('tramado.class', { format: 'tramado.class', version: 1, classId: 'x' }).ok).toBe(true);
    expect(parseRecord('tramado.class', { format: 'tramado.meta', version: 1 }).ok).toBe(false);
    expect(parseRecord('tramado.class', { format: 'tramado.class', version: 0 }).ok).toBe(false);
    expect(parseRecord('tramado.class', null).ok).toBe(false);
    const newer = parseRecord('tramado.member', { format: 'tramado.member', version: 2, deviceId: 'D', future: 1 });
    expect(newer).toMatchObject({ ok: true, newer: true, unknown: ['future'] });
  });

  it('reads JSONL incrementally, skipping bad, long and half-written lines', () => {
    const text = '{"a":1}\nnot json\n[1]\n\n{"b":2}\n{"c":';
    const r = parseJsonl(enc(text));
    expect(r.lines.map((l) => l.value ?? l.error)).toEqual([{ a: 1 }, 'unparseable', 'unparseable', { b: 2 }]);
    expect(r.consumed).toBe(text.lastIndexOf('\n') + 1);
    const again = parseJsonl(enc(text + '3}\n'), r.consumed);
    expect(again.lines.map((l) => l.value)).toEqual([{ c: 3 }]);
    const long = parseJsonl(enc(JSON.stringify({ t: 'x'.repeat(70_000) }) + '\n{"ok":1}\n'));
    expect(long.lines.map((l) => l.error ?? 'ok')).toEqual(['too-long', 'ok']);
  });

  it('keeps unknown fields on rewrite', () => {
    const prev = { format: 'tramado.member', version: 1, name: 'A', fromTheFuture: { x: 1 } };
    expect(mergeUnknown(prev, { format: 'tramado.member', version: 1, name: 'B' })).toEqual({ format: 'tramado.member', version: 1, name: 'B', fromTheFuture: { x: 1 } });
  });

  it('negotiates versions (folder spec §7.2)', () => {
    expect(isNewer('tramado.chat', 2)).toBe(true);
    expect(isNewer('tramado.chat', 1)).toBe(false);
    expect(negotiate('tramado.chat', [{ 'tramado.chat': 3 }, undefined, { 'tramado.chat': 1 }])).toBe(1);
  });
});
