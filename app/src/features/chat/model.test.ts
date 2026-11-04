// The chat tab's pure helpers (UX §3.10.2): visible lines, day separators, author groups, mentions, ↑ to edit, find.
import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from '../../services/types/viewModels';
import { chatRows, dayOf, excerpt, findMatches, isFailedAi, lastEditable, mentionsMe, sameGroup, visibleItems } from './model';
import { badgeOf } from './railBadge';

const msg = (id: string, at: string, over: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id, at, text: `text ${id}`, kind: 'message', author: { deviceId: 'DEV-A', deviceName: 'Laptop', memberId: 'ana', memberName: 'Ana Ribeiro', self: false },
  replyTo: null, attachments: [], mentions: [], edited: false, deleted: false, hiddenBy: null, pinned: false, delivery: 'sent', unverified: false, ...over,
});

describe('chat rows', () => {
  it('groups one author within 5 minutes and separates days', () => {
    const items = [
      msg('a', '2026-11-02T10:00:00Z'), msg('b', '2026-11-02T10:04:00Z'), msg('c', '2026-11-02T10:10:00Z'),
      msg('d', '2026-11-02T10:11:00Z', { author: { deviceId: 'DEV-B', deviceName: 'PC', memberId: 'bruno', memberName: 'Bruno', self: false } }),
      msg('e', '2026-11-03T09:00:00Z'),
    ];
    const rows = chatRows(items, 'Europe/Lisbon');
    expect(rows.map((r) => (r.kind === 'day' ? `day:${r.day}` : `${r.key}${r.first ? 'F' : ''}${r.last ? 'L' : ''}`))).toEqual([
      'day:2026-11-02', 'aF', 'bL', 'cFL', 'dFL', 'day:2026-11-03', 'eFL',
    ]);
    expect(sameGroup(items[0]!, { ...items[1]!, kind: 'ai' })).toBe(false);
    expect(dayOf('2026-11-02T23:30:00Z', 'Europe/Lisbon')).toBe('2026-11-02');
    expect(dayOf('2026-07-02T23:30:00Z', 'Europe/Lisbon')).toBe('2026-07-03');   // summer time
  });

  it('hides failed @AI lines, finds my last editable message and mentions of me', () => {
    const failed = msg('x', '2026-11-02T10:00:00Z', { kind: 'ai', text: '', ai: { insufficient: true } as never });
    expect(isFailedAi(failed)).toBe(true);
    expect(visibleItems([failed, msg('y', '2026-11-02T10:01:00Z')]).map((m) => m.id)).toEqual(['y']);
    const mine = { deviceId: 'ME', deviceName: 'L', memberId: 'me', memberName: 'Me', self: true };
    const items = [msg('1', '2026-11-02T10:00:00Z', { author: mine }), msg('2', '2026-11-02T10:01:00Z', { author: mine, deleted: true }), msg('3', '2026-11-02T10:02:00Z')];
    expect(lastEditable(items)?.id).toBe('1');
    expect(mentionsMe(msg('m', '2026-11-02T10:00:00Z', { mentions: [{ memberId: 'me', name: 'Me' }] }), 'me')).toBe(true);
    expect(mentionsMe(msg('m', '2026-11-02T10:00:00Z', { mentions: [{ memberId: 'everyone', name: 'everyone' }] }), 'me')).toBe(true);
    expect(mentionsMe(msg('m', '2026-11-02T10:00:00Z', { author: mine, mentions: [{ memberId: 'me', name: 'Me' }] }), 'me')).toBe(false);
  });

  it('finds messages ignoring accents and case, and makes excerpts without tokens', () => {
    const items = [msg('1', '2026-11-02T10:00:00Z', { text: 'Frequência mudou' }), msg('2', '2026-11-02T10:01:00Z', { text: 'nada' }), msg('3', '2026-11-02T10:02:00Z', { text: 'x', attachments: [{ relPath: 'a', name: 'Frequencia.pdf', size: 1, arrived: true }] })];
    expect(findMatches(items, 'frequencia')).toEqual(['1', '3']);
    expect(findMatches(items, '  ')).toEqual([]);
    expect(excerpt('<@ai> o que   disse <@abcdefghijklmnopqrstuvwxyz> sobre isto?', 30)).toBe('@AI o que disse @… sobre isto?');
    expect(excerpt('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('rail badge: mentions first, then unread, none when read', () => {
    expect(badgeOf({ unread: 3, mentions: 1 })).toEqual({ count: 1, tone: 'info' });
    expect(badgeOf({ unread: 3, mentions: 0 })).toEqual({ count: 3, tone: 'neutral' });
    expect(badgeOf({ unread: 0, mentions: 0 })).toBeNull();
    expect(badgeOf(null)).toBeNull();
  });
});
